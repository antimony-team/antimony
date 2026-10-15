#!/bin/sh
# Installs and starts Antimony on this machine with Docker Compose.
#
#   curl -fsSL https://antimony.run/deploy.sh | bash
#
# Settings, passed as environment variables (e.g. curl ... | SB_PORT=9000 bash):
#   ANTIMONY_DIR      where to install                                   (default: ./antimony)
#   SB_PORT           port of the web interface                          (default: 8080)
#   ANTIMONY_VERSION  release to install, e.g. 1.4.2, or dev for the     (default: latest)
#                     development version
#   ANTIMONY_YES      set to 1 to skip the confirmation
#
# Running it again in the same directory updates Antimony to the chosen version and restarts it.
# Your .env with its passwords and secrets, config.yml and kinds.conf.yml are kept.
#
# Everything runs inside main, so a partly downloaded script does nothing.

set -eu

REPO="https://github.com/antimony-team/antimony"

# Ports Antimony listens on with host networking besides the web port: interface, server, SSH server, PostgreSQL
OTHER_PORTS="8100 3000 6969 5432"

info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
fail() {
	printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
	exit 1
}

# Prints a random hex secret
secret() {
	if command -v openssl >/dev/null 2>&1; then
		openssl rand -hex 32
	else
		od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
	fi
}

check_requirements() {
	[ "$(uname -s)" = "Linux" ] || fail "Antimony runs labs with containerlab, which needs Linux."

	command -v docker >/dev/null 2>&1 ||
		fail "Docker isn't installed. Install Docker Engine first: https://docs.docker.com/engine/install/"

	docker compose version >/dev/null 2>&1 ||
		fail "The Docker Compose plugin isn't installed: https://docs.docker.com/compose/install/linux/"

	docker info >/dev/null 2>&1 ||
		fail "Can't reach Docker. Make sure it's running. If Docker needs sudo on this machine, run
the script with sudo, putting settings after it:

  curl -fsSL https://antimony.run/deploy.sh | sudo SB_PORT=... bash"

	command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1 ||
		fail "curl, tar and sha256sum are needed to download Antimony."
}

# Whether this machine already runs Antimony, which then holds its own ports
is_running() {
	[ -n "$(docker ps --quiet --filter label=com.docker.compose.project=antimony)" ]
}

# Stops before starting anything if another program holds one of Antimony's ports
check_ports() {
	if is_running; then
		return
	fi

	ports="$port $OTHER_PORTS"

	if ! command -v ss >/dev/null 2>&1; then
		warn "Can't check whether ports $ports are free (ss isn't installed)."
		return
	fi

	busy=""
	for used in $ports; do
		if [ -n "$(ss -Hltn "sport = :$used" 2>/dev/null)" ]; then
			# Name the container if it's one, otherwise the process if we're allowed to see it
			owner="$(docker ps --filter "publish=$used" --format 'container {{.Names}}' | head -n 1)"
			if [ -z "$owner" ]; then
				owner="$(ss -Hltnp "sport = :$used" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/process \1/p' | head -n 1)"
			fi
			busy="$busy
  $used  ${owner:-unknown process}"
		fi
	done

	if [ -n "$busy" ]; then
		fail "These ports are in use, but Antimony needs them:$busy
Stop whatever holds them and run this again."
	fi
}

# Says what the install does to this machine and asks before going ahead. With curl | sh the script
# itself is on stdin, so the answer is read from the terminal. Without a terminal it goes ahead.
confirm() {
	if [ -f "$dir/.env" ] || [ "${ANTIMONY_YES:-}" = "1" ]; then
		return
	fi

	cat <<NOTICE

Antimony will be installed into $dir. To run labs, it needs full access to this machine:

  - The server runs as a privileged root container with access to Docker, the host's
    processes and its network. Anyone who controls the server controls this machine.
  - Topologies and labs are stored in /srv/antimony, created as root.
  - It listens on all network interfaces on port $port (web interface, plain HTTP) and
    6969 (SSH for node shells, which doesn't authenticate clients).

Only install it on a machine you're prepared to give it, ideally a dedicated one, and
firewall port 6969 if it's reachable from untrusted networks. Logins travel unencrypted
over HTTP, so put a reverse proxy with HTTPS in front of it if you use it over a network.

NOTICE

	if ! (: </dev/tty) 2>/dev/null; then
		info "No terminal to ask, continuing."
		return
	fi

	printf 'Continue? [y/N] '
	read -r answer </dev/tty
	case "$answer" in
	[yY] | [yY][eE][sS]) ;;
	*) fail "Cancelled, nothing was changed." ;;
	esac
}

# Downloads the deployment archive of a release and its checksums from $1, checks the archive and unpacks it
# into $tmp
download_release() {
	curl -fsSL "$1/antimony-deployment.tar.gz" -o "$tmp/antimony-deployment.tar.gz" &&
		curl -fsSL "$1/SHA256SUMS" -o "$tmp/SHA256SUMS" || return 1

	(cd "$tmp" && grep ' antimony-deployment.tar.gz$' SHA256SUMS | sha256sum -c --quiet - >/dev/null 2>&1) ||
		fail "The downloaded deployment files don't match the checksum of the release. Try again, and report it if it keeps happening."

	tar -xzf "$tmp/antimony-deployment.tar.gz" -C "$tmp" --strip-components=1
}

# Downloads the deployment files of the chosen version into $dir: the archive of a release, whose
# compose file starts the images of that release, or the files of the development branch
download() {
	tmp="$(mktemp -d)"
	trap 'rm -rf "$tmp"' EXIT

	case "$version" in
	dev)
		info "Downloading the development version of Antimony"
		curl -fsSL "$REPO/archive/refs/heads/development.tar.gz" | tar -xz -C "$tmp" --strip-components=1 ||
			fail "Couldn't download the development version of Antimony."
		;;
	latest)
		info "Downloading the latest release of Antimony"
		download_release "$REPO/releases/latest/download" ||
			fail "Couldn't download the latest release of Antimony. If there's none yet, use ANTIMONY_VERSION=dev."
		;;
	*)
		info "Downloading Antimony $version"
		download_release "$REPO/releases/download/v$version" ||
			fail "Couldn't download Antimony $version. The versions are listed at $REPO/releases."
		;;
	esac

	mkdir -p "$dir"

	# The compose file and the database setup come with every version, the configuration is yours
	cp "$tmp/docker-compose.yml" "$tmp/.env.example" "$dir/"
	cp -r "$tmp/postgres" "$dir/"
	for file in config.yml kinds.conf.yml; do
		if [ ! -f "$dir/$file" ]; then
			cp "$tmp/$file" "$dir/"
		fi
	done
}

# Renames settings of older installs, so their passwords keep working
migrate_env() {
	if grep -q '^SB_NATIVE_' "$1"; then
		info "Renaming SB_NATIVE_USERNAME and SB_NATIVE_PASSWORD to SB_ADMIN_* in $1"
		sed -i 's/^SB_NATIVE_USERNAME=/SB_ADMIN_USERNAME=/; s/^SB_NATIVE_PASSWORD=/SB_ADMIN_PASSWORD=/' "$1"
	fi
}

# Only the development version is kept in .env, the compose file of a release knows its own version
save_version() {
	sed -i '/^ANTIMONY_VERSION=/d; /^ANTIMONY_BRANCH=/d' "$1"
	if [ "$version" = "dev" ]; then
		echo "ANTIMONY_VERSION=dev" >>"$1"
	fi
}

# Creates .env with random passwords on the first install
configure() {
	env_file="$dir/.env"

	if [ -f "$env_file" ]; then
		info "Keeping the existing $env_file"
		migrate_env "$env_file"
		save_version "$env_file"
		return
	fi

	if [ -d "$dir/.db" ]; then
		# The database already exists with the default passwords, new ones would lock the server out
		warn "Found a database but no .env, so Antimony keeps its default passwords (admin / admin)."
		warn "See https://antimony.run/docs/deployment/docker/ to set your own."
		admin_password="admin"
		return
	fi

	info "Generating passwords and secrets in $env_file"
	admin_password="$(secret | cut -c1-16)"

	# Only the owner may read the secrets
	(umask 077 && cat >"$env_file") <<EOF
# Created by deploy.sh. See .env.example for all settings.
SB_PORT=$port

SB_ADMIN_USERNAME=admin
SB_ADMIN_PASSWORD=$admin_password

SB_JWT_SECRET=$(secret)

POSTGRES_PASSWORD=$(secret)
SB_DATABASE_PASSWORD=$(secret)
EOF
	save_version "$env_file"
}

start() {
	info "Downloading the images and starting Antimony"
	(cd "$dir" && docker compose up -d --pull always)
}

# Prints a setting from an existing .env, if there is one
saved() {
	[ -f "$dir/.env" ] && sed -n "s/^$1=//p" "$dir/.env" | tail -n 1
}

main() {
	dir="${ANTIMONY_DIR:-$PWD/antimony}"
	# Environment variables win over the settings of an earlier install
	port="${SB_PORT:-$(saved SB_PORT || true)}"
	port="${port:-8080}"
	version="${ANTIMONY_VERSION:-$(saved ANTIMONY_VERSION || true)}"
	version="${version:-latest}"
	version="${version#v}"
	admin_password=""

	check_requirements
	check_ports
	confirm
	download
	configure
	start

	printf '\n\033[1;32mAntimony is running.\033[0m\n\n'
	printf '  Open      http://localhost:%s\n' "$port"
	if [ -n "$admin_password" ]; then
		printf '  Sign in   admin / %s\n' "$admin_password"
	else
		printf '  Sign in   with the credentials in %s/.env\n' "$dir"
	fi
	printf '  Files     %s\n\n' "$dir"
}

main "$@"

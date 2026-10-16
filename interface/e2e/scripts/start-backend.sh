#!/usr/bin/env bash
#
# Starts the Antimony server for the e2e tests. Playwright runs this via `webServer` in playwright.config.ts
# and stops it with SIGTERM when the run is over.
#
# The server runs with the dummy deployment provider (nothing is deployed), a fresh SQLite database and
# development mode, which enables the endpoint the fixtures use to create test users. The configuration
# comes from e2e/backend/.
#
# Without SB_E2E_BACKEND_IMAGE, the server is built from a local checkout of antimony-server and run
# directly, so no image has to be built or downloaded. With it, the image is run in Docker, like in CI.
#
# Environment:
#   SB_E2E_BACKEND_IMAGE  Image to run, e.g. ghcr.io/antimony-team/antimony-server:dev or a local
#                         antimony-server:dev. Not set: build and run the local checkout.
#   SB_E2E_SERVER_DIR     The local antimony-server checkout (default: next to this repository, as
#                         antimony-server or antimony-backend)

set -euo pipefail

e2e_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$e2e_dir/.tmp/backend"
log_file="$work_dir/server.log"
container="antimony-e2e-backend"

# The same for both ways of running it. The desktop token lets the tests sign in like Antimony Desktop.
server_env=(
  SB_ADMIN_USERNAME=admin
  SB_ADMIN_PASSWORD=admin
  SB_DESKTOP_TOKEN=antimony-e2e-desktop
  SB_JWT_SECRET=antimony-e2e
  SB_LOG_LEVEL=info
)
server_args=(-config=./config.yml -sqlite=true -dev)

# A fresh working directory every run, so every run starts with an empty database
rm -rf "$work_dir"
mkdir -p "$work_dir"

if [[ -z "${SB_E2E_BACKEND_IMAGE:-}" ]]; then
  server_dir="${SB_E2E_SERVER_DIR:-}"
  if [[ -z "$server_dir" ]]; then
    for candidate in "$e2e_dir/../../antimony-server" "$e2e_dir/../../antimony-backend"; do
      if [[ -f "$candidate/src/go.mod" ]]; then
        server_dir="$candidate"
        break
      fi
    done
  fi
  if [[ -z "$server_dir" || ! -f "$server_dir/src/go.mod" ]]; then
    echo "No antimony-server checkout found next to this repository. Set SB_E2E_SERVER_DIR to it, or" >&2
    echo "SB_E2E_BACKEND_IMAGE to an image to run instead." >&2
    exit 1
  fi
  server_dir="$(cd "$server_dir" && pwd)"

  echo "Building the server from $server_dir (log: $log_file)"
  (cd "$server_dir/src" && go build -o "$work_dir/antimony-server" .)

  # The config is written for the container, where the server has to listen on all interfaces. Run
  # directly, it only listens on this machine.
  sed -e 's/host: 0\.0\.0\.0/host: 127.0.0.1/' -e 's/sshHost: 0\.0\.0\.0/sshHost: 127.0.0.1/' \
    "$e2e_dir/backend/config.yml" >"$work_dir/config.yml"
  cp "$e2e_dir/backend/kinds.conf.yml" "$work_dir/"
  ln -s "$server_dir/data" "$work_dir/data"

  cd "$work_dir"
  exec env "${server_env[@]}" ./antimony-server "${server_args[@]}" >"$log_file" 2>&1
fi

image="$SB_E2E_BACKEND_IMAGE"

# Also done by e2e/scripts/cleanup.sh before Playwright starts; this covers running the script directly.
docker rm --force "$container" >/dev/null 2>&1 || true

# A local image (no registry in the name) is never pulled. Images from a registry are always pulled, so a
# moving tag like :dev is never stale.
pull="always"
if [[ "$image" != */* ]]; then
  pull="never"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "The image '$image' does not exist. Build it in the antimony-server repository:" >&2
    echo "  docker build -t $image ." >&2
    exit 1
  fi
fi

echo "Starting the server from $image (log: $log_file)"

docker_env=()
for variable in "${server_env[@]}"; do
  docker_env+=(--env "$variable")
done

# --init forwards SIGTERM to the server, and --rm removes the container with all its state.
exec docker run --rm --init --pull "$pull" \
  --name "$container" \
  --publish 127.0.0.1:3200:3200 \
  --publish 127.0.0.1:6200:6200 \
  --volume "$e2e_dir/backend/config.yml:/app/config.yml:ro" \
  --volume "$e2e_dir/backend/kinds.conf.yml:/app/kinds.conf.yml:ro" \
  "${docker_env[@]}" \
  "$image" "${server_args[@]}" >"$log_file" 2>&1

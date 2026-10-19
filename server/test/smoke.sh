#!/usr/bin/env bash
# Starts the built server with the dummy provider and checks that it answers, logs in and reads from its database.
# Usage: smoke.sh <build directory>
set -euo pipefail

cd "$1"
cp ../test/config-smoke.test.yml ./config-smoke.yml

export SB_JWT_SECRET=smoke
export SB_ADMIN_USERNAME=admin
export SB_ADMIN_PASSWORD=admin

if curl -s http://127.0.0.1:3999 >/dev/null; then
	echo "Another server already listens on port 3999"
	exit 1
fi

./antimony-server -config=./config-smoke.yml -sqlite >server.log 2>&1 &
server=$!
trap 'status=$?; kill "$server" 2>/dev/null || true; if [ "$status" -ne 0 ]; then cat server.log; fi' EXIT

for _ in $(seq 1 60); do
	if curl -sf http://127.0.0.1:3999/users/login/auth-config >/dev/null; then
		break
	fi
	if ! kill -0 "$server" 2>/dev/null; then
		echo "The server exited during startup"
		cat server.log
		exit 1
	fi
	sleep 0.5
done

curl -sf http://127.0.0.1:3999/users/login/auth-config

cookies=$(mktemp)
curl -sf -c "$cookies" -H 'Content-Type: application/json' \
	-d '{"username":"admin","password":"admin"}' http://127.0.0.1:3999/users/login/native
curl -sf -b "$cookies" http://127.0.0.1:3999/server-config >/dev/null

echo
echo "The server started and answered"

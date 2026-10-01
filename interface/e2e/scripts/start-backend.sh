#!/usr/bin/env bash
#
# Starts the Antimony backend for the e2e tests from a Docker image. Playwright runs this via
# `webServer` in playwright.config.ts and stops it with SIGTERM when the run is over.
#
# The backend runs with the dummy deployment provider (nothing is deployed), a fresh SQLite database
# inside the container and development mode, which enables the endpoint the fixtures use to create
# test users. The configuration comes from e2e/backend/.
#
# Environment:
#   SB_E2E_BACKEND_IMAGE  Image to run (default: antimony-backend:dev, a locally built image).
#                         CI uses ghcr.io/antimony-team/antimony-backend:dev.

set -euo pipefail

e2e_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${SB_E2E_BACKEND_IMAGE:-antimony-backend:dev}"
container="antimony-e2e-backend"
log_file="$e2e_dir/.tmp/backend/server.log"

# Also done by e2e/scripts/cleanup.sh before Playwright starts; this covers running the script directly.
docker rm --force "$container" >/dev/null 2>&1 || true

# A local image (no registry in the name) is never pulled, so explain how to build it. Images from a
# registry are always pulled, so a moving tag like :dev is never stale.
pull="always"
if [[ "$image" != */* ]]; then
  pull="never"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "The backend image '$image' does not exist. Build it in the antimony-backend repository:" >&2
    echo "  docker build -t $image ." >&2
    exit 1
  fi
fi

mkdir -p "$(dirname "$log_file")"
echo "Starting the backend from $image (log: $log_file)"

# --init forwards SIGTERM to the backend, and --rm removes the container with all its state.
exec docker run --rm --init --pull "$pull" \
  --name "$container" \
  --publish 127.0.0.1:3100:3100 \
  --publish 127.0.0.1:6100:6100 \
  --volume "$e2e_dir/backend/config.yml:/app/config.yml:ro" \
  --volume "$e2e_dir/backend/kinds.conf.yml:/app/kinds.conf.yml:ro" \
  --env SB_NATIVE_USERNAME=admin \
  --env SB_NATIVE_PASSWORD=admin \
  --env SB_JWT_SECRET=antimony-e2e \
  --env SB_LOG_LEVEL=info \
  "$image" -config=./config.yml -sqlite=true -dev >"$log_file" 2>&1

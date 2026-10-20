#!/usr/bin/env bash
#
# Stops a server left behind by an e2e run that was killed hard (e.g. Ctrl+C twice). Normally Playwright
# stops it at the end of the run. It has to run before Playwright starts, which refuses to start if the
# server port is still taken.
#
# With SB_E2E_PROVIDER=containerlab, it also destroys the labs such a run left running. Their names start
# with the name the fixtures give topologies, topology-<8 hex digits>-.

docker rm --force antimony-e2e-backend >/dev/null 2>&1 || true
pkill -f "e2e/.tmp/backend/antimony-server" >/dev/null 2>&1 || true

if [[ "${SB_E2E_PROVIDER:-dummy}" == containerlab ]] && sudo -n true 2>/dev/null; then
  sudo -n pkill -f "e2e/.tmp/backend/antimony-server" >/dev/null 2>&1 || true

  labs="$(sudo -n containerlab inspect --all --format json 2>/dev/null |
    grep -oE '"lab_name": *"topology-[0-9a-f]{8}-[0-9a-f]+"' | sed -E 's/.*"(topology-[^"]+)"/\1/' | sort -u)"
  for lab in $labs; do
    echo "Destroying the lab $lab left by an earlier run"
    sudo -n containerlab destroy --name "$lab" --cleanup >/dev/null 2>&1 || true
  done
fi

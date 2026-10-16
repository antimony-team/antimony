#!/usr/bin/env bash
#
# Stops a server left behind by an e2e run that was killed hard (e.g. Ctrl+C twice). Normally Playwright
# stops it at the end of the run. It has to run before Playwright starts, which refuses to start if the
# server port is still taken.

docker rm --force antimony-e2e-backend >/dev/null 2>&1 || true
pkill -f "e2e/.tmp/backend/antimony-server" >/dev/null 2>&1 || true

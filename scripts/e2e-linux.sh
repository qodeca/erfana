#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# Run the Playwright Electron suite headless on Linux (xvfb) inside Docker.
#   npm run test:e2e:linux [-- <playwright args>]
# Without a --project argument it runs --project=electron.
#
# The repo is bind-mounted read-write, but node_modules and out/ live in named Docker
# volumes so the host's macOS copies are never overwritten. The npm download cache has
# a volume too. Reports land in .local/e2e-linux/ (git-ignored), written by the
# container as the host user.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR=".local/e2e-linux"

hash_text() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi
}

# One volume set (and image tag) per checkout, so worktrees do not share node_modules.
KEY="$(printf '%s' "$ROOT" | hash_text | cut -c1-8)"
if [ -z "$KEY" ]; then
  echo "Could not derive a checkout key (no sha256sum or shasum)." >&2
  exit 2
fi
IMAGE="${ERFANA_E2E_LINUX_IMAGE:-erfana-e2e-linux}:$KEY"
NM_VOLUME="erfana-e2e-node-modules-$KEY"
OUT_VOLUME="erfana-e2e-out-$KEY"
NPM_VOLUME="erfana-e2e-npm-cache-$KEY"
CONTAINER_HOME=/tmp/home

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and retry." >&2
  exit 2
fi

# Default to the functional project, as `npm run test:e2e` does.
args=("$@")
has_project=0
for arg in "${args[@]+"${args[@]}"}"; do
  case "$arg" in --project|--project=*) has_project=1 ;; esac
done
if [ "$has_project" -eq 0 ]; then args=("--project=electron" "${args[@]+"${args[@]}"}"); fi

docker build -t "$IMAGE" -f "$ROOT/e2e/docker/Dockerfile" "$ROOT/e2e/docker" || exit 1

# Fresh report folder every run; volumes are created root-owned, so hand them to the host user.
mkdir -p "$ROOT/$REPORT_DIR"
find "$ROOT/$REPORT_DIR" -mindepth 1 -delete
docker run --rm --user 0 \
  -v "$NM_VOLUME":/work/node_modules -v "$OUT_VOLUME":/work/out -v "$NPM_VOLUME":"$CONTAINER_HOME/.npm" \
  "$IMAGE" chown "$(id -u):$(id -g)" /work/node_modules /work/out "$CONTAINER_HOME/.npm" || exit 1

lock_before="$(hash_text < "$ROOT/package-lock.json")"

# --init reaps the zombie processes Electron leaves; /dev/shm is enlarged for Chromium.
docker run --rm \
  --init \
  --shm-size=1g \
  --user "$(id -u):$(id -g)" \
  -e HOME="$CONTAINER_HOME" \
  -e ERFANA_E2E_LINUX_CONTAINER=1 \
  -e CI="${CI:-}" \
  -e REPORT_DIR="$REPORT_DIR" \
  -v "$ROOT":/work \
  -v "$NM_VOLUME":/work/node_modules \
  -v "$OUT_VOLUME":/work/out \
  -v "$NPM_VOLUME":"$CONTAINER_HOME/.npm" \
  "$IMAGE" bash /work/e2e/docker/run-suite.sh "${args[@]}"
status=$?

# npm ci must never rewrite the lock. Keep the suite's own exit code when it failed.
if [ "$lock_before" != "$(hash_text < "$ROOT/package-lock.json")" ]; then
  echo "package-lock.json changed during the run" >&2
  if [ "$status" -eq 0 ]; then status=3; fi
fi
echo "Reports: $ROOT/$REPORT_DIR"
exit "$status"

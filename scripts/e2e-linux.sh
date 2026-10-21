#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# Run the Playwright Electron suite headless on Linux (xvfb) inside Docker.
#   npm run test:e2e:linux [-- <playwright args>]
#
# The repo is bind-mounted read-write, but node_modules and out/ live in named Docker
# volumes so the host's macOS copies are never overwritten. Reports land in
# .local/e2e-linux/ (git-ignored).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${ERFANA_E2E_LINUX_IMAGE:-erfana-e2e-linux}"
# One volume set per checkout, so worktrees do not share node_modules.
KEY="$(printf '%s' "$ROOT" | shasum | cut -c1-8)"
NM_VOLUME="erfana-e2e-node-modules-$KEY"
OUT_VOLUME="erfana-e2e-out-$KEY"
REPORT_DIR=".local/e2e-linux"

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and retry." >&2
  exit 2
fi

docker build -t "$IMAGE" -f "$ROOT/e2e/docker/Dockerfile" "$ROOT/e2e/docker" || exit 1

mkdir -p "$ROOT/$REPORT_DIR"

# Playwright args are passed through verbatim as "$@" of the inner bash.
docker run --rm \
  --init \
  --ipc=host \
  --shm-size=1g \
  -e ERFANA_E2E_LINUX_CONTAINER=1 \
  -e CI="${CI:-}" \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -e REPORT_DIR="$REPORT_DIR" \
  -v "$ROOT":/work \
  -v "$NM_VOLUME":/work/node_modules \
  -v "$OUT_VOLUME":/work/out \
  "$IMAGE" bash -c '
    set -u
    status=0
    lock_before="$(sha256sum package-lock.json)"
    npm ci --no-audit --no-fund || status=$?
    if [ $status -eq 0 ] && [ "$lock_before" != "$(sha256sum package-lock.json)" ]; then
      echo "package-lock.json changed during npm ci" >&2
      status=3
    fi
    if [ $status -eq 0 ]; then npx electron-vite build || status=$?; fi
    if [ $status -eq 0 ]; then xvfb-run -a --server-args="-screen 0 1920x1080x24" bash e2e/docker/run-under-xvfb.sh npx playwright test "$@" || status=$?; fi
    mkdir -p "$REPORT_DIR"
    [ -d playwright-report ] && cp -R playwright-report "$REPORT_DIR/"
    [ -d test-results ] && cp -R test-results "$REPORT_DIR/"
    chown -R "$HOST_UID:$HOST_GID" "$REPORT_DIR" playwright-report test-results .e2e-temp 2>/dev/null
    exit $status
  ' bash "$@"
status=$?
# Second guard on the host (a worktree .git is not visible inside the container).
git -C "$ROOT" diff --exit-code --stat package-lock.json || status=3
echo "Reports: $ROOT/$REPORT_DIR"
exit $status

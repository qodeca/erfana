#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# Runs inside the e2e container (started by scripts/e2e-linux.sh): npm ci, build,
# then Playwright under xvfb. "$@" are the Playwright arguments.
# Reads REPORT_DIR (relative to /work) from the environment.
set -u
cd /work

status=0
npm ci --no-audit --no-fund || status=$?
if [ "$status" -eq 0 ]; then npx electron-vite build || status=$?; fi
if [ "$status" -eq 0 ]; then
  PLAYWRIGHT_HTML_REPORT="/work/$REPORT_DIR/playwright-report" \
    xvfb-run -a --server-args="-screen 0 1920x1080x24" \
    bash e2e/docker/run-under-xvfb.sh \
    npx playwright test --output="/work/$REPORT_DIR/test-results" "$@" || status=$?
fi
exit "$status"

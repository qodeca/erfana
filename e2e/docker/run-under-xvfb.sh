#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# Runs "$@" on the virtual X screen xvfb-run provides, with a window manager up
# first (see the Dockerfile for why). Used as: xvfb-run -a bash run-under-xvfb.sh <cmd...>
openbox >/dev/null 2>&1 &
wm_pid=$!
# Wait (bounded) for the window manager to take over the screen.
wm_up=0
for _ in $(seq 1 50); do
  if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; then wm_up=1; break; fi
  sleep 0.1
done
if [ "$wm_up" -ne 1 ]; then
  echo "warning: openbox did not start within 5 s; focus and maximize tests may fail" >&2
fi
"$@"
status=$?
kill "$wm_pid" 2>/dev/null
exit $status

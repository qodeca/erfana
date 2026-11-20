#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# Run the Playwright Electron suite in a macOS virtual machine (Tart) on this Mac.
#   npm run test:e2e:macos-vm [-- <playwright args>]
# Without a --project argument it runs --project=electron --project=timing --project=perf,
# as `npm run test:e2e` does.
#
# Why a VM: the focus tests (needsOsFocus, @os-focus) need Erfana to be the OS key window,
# and macOS gives that to no window while the screen is locked. The VM has its own
# display, logs in automatically and has no screen lock, so the whole macOS suite runs
# while this Mac is locked or in use. Linux runs the same suite in Docker
# (`npm run test:e2e:linux`); this script is the macOS equivalent.
#
# Nothing on this Mac is shared into the VM. The script streams in only the files git
# does not ignore (so `signing-secrets.local`, `.env` and other ignored files never reach
# it), and streams the reports back into .local/e2e-macos-vm/ (git-ignored).
# node_modules and out/ stay in the VM between runs; `npm ci` runs again only when
# package-lock.json changes.
#
# Needs: Apple Silicon, Tart (docs/testing/e2e-testing.md § macOS VM). The first run
# creates the VM from the Cirrus Labs base image (about 33 GB, once).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM="${ERFANA_E2E_VM:-erfana-e2e}"
IMAGE="${ERFANA_E2E_VM_IMAGE:-ghcr.io/cirruslabs/macos-tahoe-base:latest}"
REPORT_DIR=".local/e2e-macos-vm"
GUEST=/Users/admin/erfana

if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo "test:e2e:macos-vm needs macOS on Apple Silicon (Tart uses Apple's Virtualization framework)." >&2
  exit 2
fi
if ! command -v tart >/dev/null 2>&1; then
  echo "Tart is not installed. See docs/testing/e2e-testing.md § macOS VM (Tart)." >&2
  exit 2
fi

if ! tart get "$VM" >/dev/null 2>&1; then
  echo "Creating the VM '$VM' from $IMAGE (one-time download, about 33 GB)." >&2
  tart clone "$IMAGE" "$VM" || exit 1
  # 1920x1200: some tests widen the window to 1800 px.
  tart set "$VM" --cpu 6 --memory 16384 --disk-size 90 --display 1920x1200 || exit 1
fi

# Start the VM headless when it is not running; stop it at the end only if we started it.
started=0
if ! tart exec "$VM" true >/dev/null 2>&1; then
  mkdir -p "$ROOT/.local"
  tart run --no-graphics --no-audio "$VM" >"$ROOT/.local/e2e-macos-vm.vm.log" 2>&1 &
  started=1
  for _ in $(seq 1 60); do
    tart exec "$VM" true >/dev/null 2>&1 && break
    sleep 3
  done
  if ! tart exec "$VM" true >/dev/null 2>&1; then
    echo "The VM '$VM' did not answer within 3 minutes (see .local/e2e-macos-vm.vm.log)." >&2
    exit 2
  fi
fi
stop_vm() { if [ "$started" -eq 1 ]; then tart stop "$VM" >/dev/null 2>&1; fi; }
trap stop_vm EXIT

# Node: the official nodejs.org build of the .nvmrc major, as nvm and CI use. The image's
# Homebrew node links a separate libnode.dylib, and the shell-guard tests (025-AC-077) run
# a copy of the node binary under another name, which then cannot load it.
want_node="$(tr -d '[:space:]' < "$ROOT/.nvmrc")"
NODE_HOME=/Users/admin/.erfana-node
tart exec "$VM" /bin/bash -c "
  set -euo pipefail
  if [ -x '$NODE_HOME/bin/node' ] && [ \"\$('$NODE_HOME/bin/node' -p 'process.versions.node.split(\".\")[0]')\" = '$want_node' ]; then exit 0; fi
  base=https://nodejs.org/dist/latest-v$want_node.x
  line=\$(curl -fsSL \"\$base/SHASUMS256.txt\" | grep -E ' node-v[0-9.]+-darwin-arm64\\.tar\\.gz\$')
  sum=\${line%% *}; file=\${line##* }
  echo \"Installing \$file in the VM\" >&2
  tmp=\$(mktemp -d)
  curl -fsSL -o \"\$tmp/\$file\" \"\$base/\$file\"
  [ \"\$(shasum -a 256 \"\$tmp/\$file\" | cut -c1-64)\" = \"\$sum\" ] || { echo \"SHA-256 mismatch for \$file\" >&2; exit 1; }
  mkdir -p '$NODE_HOME'
  tar -xzf \"\$tmp/\$file\" -C '$NODE_HOME' --strip-components 1
" || exit 1
GUEST_PATH="$NODE_HOME/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Copy the checkout in: every file git tracks or would add (ignored files stay here).
# The old copy is cleared first, except node_modules and out/, so deleted files go too.
tart exec "$VM" /bin/sh -c "mkdir -p '$GUEST' && find '$GUEST' -mindepth 1 -maxdepth 1 ! -name node_modules ! -name out ! -name .lock-hash -exec rm -rf {} +" || exit 1
(cd "$ROOT" && git ls-files -z --cached --others --exclude-standard \
  | while IFS= read -r -d '' f; do [ -f "$f" ] && printf '%s\0' "$f"; done \
  | tar --null -T - -cf -) \
  | tart exec -i "$VM" tar -xf - -C "$GUEST" || exit 1

args=("$@")
has_project=0
for arg in "${args[@]+"${args[@]}"}"; do
  case "$arg" in --project|--project=*) has_project=1 ;; esac
done
if [ "$has_project" -eq 0 ]; then args=("--project=electron" "--project=timing" "--project=perf" "${args[@]+"${args[@]}"}"); fi
quoted="$(printf '%q ' "${args[@]}")"

# In the VM: npm ci when the lock changed, the e2e build, then Playwright.
tart exec "$VM" /bin/bash -c "
  export PATH='$GUEST_PATH'
  cd '$GUEST' || exit 1
  echo \"node \$(node -v), npm \$(npm -v)\"
  hash=\$(shasum -a 256 package-lock.json | cut -c1-64)
  if [ ! -d node_modules ] || [ \"\$(cat .lock-hash 2>/dev/null)\" != \"\$hash\" ]; then
    npm ci --no-audit --no-fund || exit 1
    echo \"\$hash\" > .lock-hash
  fi
  rm -rf test-results playwright-report
  npm run build:e2e || exit 1
  CI='${CI:-}' ERFANA_E2E_MACOS_VM=1 PLAYWRIGHT_HTML_REPORT=playwright-report npx playwright test --output=test-results $quoted
"
status=$?

# Reports back to this Mac.
mkdir -p "$ROOT/$REPORT_DIR"
find "$ROOT/$REPORT_DIR" -mindepth 1 -delete
tart exec "$VM" /bin/sh -c "cd '$GUEST' && tar -cf - \$(ls -d test-results playwright-report 2>/dev/null)" \
  | tar -xf - -C "$ROOT/$REPORT_DIR"
echo "Reports: $ROOT/$REPORT_DIR"
exit "$status"

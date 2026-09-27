// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Native-module smoke test, run by `.github/workflows/windows-native-smoke.yml` (#178).
 *
 * Proves that node-pty was rebuilt by `electron-builder install-app-deps`
 * (@electron/rebuild) for Electron's ABI, and that it loads and spawns a pty
 * under Electron. Run it with the Electron binary, not system Node:
 *
 *   ELECTRON_RUN_AS_NODE=1 "$(node -p "require('electron')")" scripts/native-smoke.cjs
 *
 * Optional: NATIVE_SMOKE_REBUILT_AFTER=<unix seconds> also requires the
 * binary to be newer than that moment, i.e. built in this run.
 *
 * A bare "it spawns" check is not enough: node-pty ships N-API prebuilds
 * (prebuilds/<platform>-<arch>/) and falls back to them when build/Release is
 * absent, so a pty spawns even when no rebuild ran. The provenance checks
 * below are what fail when the rebuild is skipped.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { setTimeout, clearTimeout } = require('timers')

const MARKER = 'erfana-native-smoke-ok'
const SPAWN_TIMEOUT_MS = 30000

function fail(message) {
  console.error(`native-smoke: FAIL - ${message}`)
  process.exit(1)
}

if (!process.versions.electron) {
  fail('not running under Electron; run the Electron binary with ELECTRON_RUN_AS_NODE=1')
}
console.log(
  `native-smoke: electron ${process.versions.electron}, ABI ${process.versions.modules}, ` +
    `${process.platform}-${process.arch}`
)

// Resolve from the working directory: CI runs this trusted copy (the
// workflow's own commit) from inside the tested ref's checkout, so node-pty
// comes from the tested tree and the checker does not.
const ptyRoot = path.dirname(require.resolve('node-pty/package.json', { paths: [process.cwd()] }))
const releaseDir = path.join(ptyRoot, 'build', 'Release')
// On Windows node-pty uses ConPTY (conpty.node); elsewhere pty.node.
const nativeName = process.platform === 'win32' ? 'conpty' : 'pty'
const binary = path.join(releaseDir, `${nativeName}.node`)

if (!fs.existsSync(binary)) {
  fail(`${binary} is missing; node-pty was not built from source, so it would load its bundled prebuild`)
}

// @electron/rebuild writes `<arch>--<ABI>` here after a successful build.
const metaPath = path.join(releaseDir, '.forge-meta')
if (!fs.existsSync(metaPath)) {
  fail(`${metaPath} is missing; build/Release was not produced by @electron/rebuild`)
}
const meta = fs.readFileSync(metaPath, 'utf8').trim()
const expectedMeta = `${process.arch}--${process.versions.modules}`
if (meta !== expectedMeta) {
  fail(`.forge-meta is "${meta}", expected "${expectedMeta}" (this Electron's arch and ABI)`)
}

const mtimeSeconds = Math.floor(fs.statSync(binary).mtimeMs / 1000)
const rebuiltAfter = process.env.NATIVE_SMOKE_REBUILT_AFTER
if (rebuiltAfter) {
  if (!/^\d+$/.test(rebuiltAfter)) fail('NATIVE_SMOKE_REBUILT_AFTER must be unix seconds')
  if (mtimeSeconds < Number(rebuiltAfter)) {
    fail(`${binary} was built at ${mtimeSeconds}, before this run's rebuild started (${rebuiltAfter})`)
  }
  console.log(`native-smoke: ${nativeName}.node built at ${mtimeSeconds}, after ${rebuiltAfter}`)
} else {
  console.log('native-smoke: NATIVE_SMOKE_REBUILT_AFTER unset; freshness not checked')
}
console.log(`native-smoke: .forge-meta ${meta} matches this Electron`)

// Confirm node-pty's own loader resolves to the rebuilt binary, not a prebuild.
const loaded = require(path.join(ptyRoot, 'lib', 'utils')).loadNativeModule(nativeName)
if (!loaded.dir.replace(/\\/g, '/').includes('build/Release')) {
  fail(`node-pty loaded ${nativeName}.node from ${loaded.dir}, not build/Release`)
}
console.log(`native-smoke: node-pty loaded ${nativeName}.node from build/Release under Electron`)

const pty = require(ptyRoot)
const [file, args] =
  process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/c', `echo ${MARKER}`]]
    : ['/bin/sh', ['-c', `echo ${MARKER}`]]

let output = ''
const term = pty.spawn(file, args, {
  name: 'xterm',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env
})
const timer = setTimeout(() => {
  fail(`pty did not exit within ${SPAWN_TIMEOUT_MS} ms; output so far: ${JSON.stringify(output)}`)
}, SPAWN_TIMEOUT_MS)

term.onData((data) => {
  output += data
})
term.onExit(({ exitCode }) => {
  clearTimeout(timer)
  if (exitCode !== 0) fail(`pty shell exited ${exitCode}; output: ${JSON.stringify(output)}`)
  if (!output.includes(MARKER)) fail(`pty output lacks the marker; output: ${JSON.stringify(output)}`)
  console.log(`native-smoke: PASS - ${file} spawned in a pty under Electron and printed the marker`)
  // ConPTY can keep handles open after exit; do not wait for the loop to drain.
  process.exit(0)
})

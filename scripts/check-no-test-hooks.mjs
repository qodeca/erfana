// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Fails when a build carries the main-process test hooks (spec 025 solution
// design § 12, T3).
//
// The hooks are compiled in only by `electron-vite build --mode e2e`; every
// other build inlines `__ERFANA_TEST_HOOKS__` as `false` and the bundler drops
// them. Every hook module carries SENTINEL (src/main/testHooks/index.ts), so
// finding that string in a production build means the hooks shipped.
//
// Usage: node scripts/check-no-test-hooks.mjs [path ...]
//   Each path is a build folder (default `out`, searched recursively, source
//   maps included), an extracted app.asar folder, or a file such as a packed
//   `app.asar` – asar stores files uncompressed, so a byte search finds the
//   sentinel inside it. Symlinks are not followed.
//
// Exit codes: 0 – no sentinel; 1 – sentinel found; 2 – a path is missing or
// holds no files, which is never a pass.
import { Buffer } from 'node:buffer'
import { closeSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The string every test-hook module carries. Keep in step with src/main/testHooks/index.ts. */
export const SENTINEL = 'ERFANA_BROWSER_TEST_HOOK_SENTINEL'

export const DEFAULT_PATHS = ['out']

const CHUNK_BYTES = 1024 * 1024

/**
 * True when `file` contains `needle`. Reads in chunks that overlap by one byte
 * less than the needle, so a match across a chunk boundary is found and a
 * packed app.asar is never read into memory whole.
 */
export function fileContains(file, needle) {
  const overlap = needle.length - 1
  const buf = Buffer.alloc(CHUNK_BYTES + overlap)
  const fd = openSync(file, 'r')
  try {
    let carried = 0
    let position = 0
    for (;;) {
      const read = readSync(fd, buf, carried, CHUNK_BYTES, position)
      if (read === 0) return false
      const filled = carried + read
      if (buf.subarray(0, filled).indexOf(needle) !== -1) return true
      position += read
      carried = Math.min(overlap, filled)
      buf.copy(buf, 0, filled - carried, filled)
    }
  } finally {
    closeSync(fd)
  }
}

/** Every regular file under `target` (or `target` itself), symlinks skipped. */
export function listFiles(target) {
  const stat = lstatSync(target)
  if (stat.isFile()) return [target]
  if (!stat.isDirectory()) return []
  return readdirSync(target, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => listFiles(path.join(target, entry.name)))
}

/**
 * Searches every file under `targets` for `sentinel`.
 * @returns {{ scanned: number, missing: string[], empty: string[], found: string[] }}
 */
export function scan(targets, sentinel = SENTINEL) {
  const needle = Buffer.from(sentinel, 'utf8')
  const result = { scanned: 0, missing: [], empty: [], found: [] }
  for (const target of targets) {
    let files
    try {
      files = listFiles(target)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      result.missing.push(target)
      continue
    }
    if (files.length === 0) result.empty.push(target)
    result.scanned += files.length
    result.found.push(...files.filter(file => fileContains(file, needle)))
  }
  return result
}

/**
 * Runs the check on `args` (default {@link DEFAULT_PATHS}), each resolved
 * against `cwd`. Returns the exit code.
 */
export function main(args = process.argv.slice(2), { log = console, cwd = process.cwd(), sentinel = SENTINEL } = {}) {
  const targets = (args.length > 0 ? args : DEFAULT_PATHS).map(target => path.resolve(cwd, target))
  const { scanned, missing, empty, found } = scan(targets, sentinel)
  if (missing.length > 0 || empty.length > 0) {
    for (const target of missing) log.error(`check-no-test-hooks: ${target} does not exist`)
    for (const target of empty) log.error(`check-no-test-hooks: ${target} holds no files`)
    log.error('Build first (npx electron-vite build), then point the check at its output.')
    return 2
  }
  if (found.length > 0) {
    log.error(`Test-hook sentinel ${sentinel} found in ${found.length} file(s):`)
    for (const file of found) log.error(`  ${file}`)
    log.error(
      'The test hooks reached a production build. Build without `--mode e2e`, and keep every ' +
        'hook behind the dynamic import in src/main/testHooks/loadTestHooks.ts.'
    )
    return 1
  }
  log.log(`No test-hook sentinel in ${scanned} file(s) under ${targets.join(', ')}.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Fails when a JS/TS source file under scripts/, src/ or e2e/ starts with `#!` (#151).
//
// `.gitattributes` pins only `*.sh` to LF, so a Windows checkout gives these
// files CRLF. Vite then cannot strip a `#!/usr/bin/env node\r` line, and any
// test that imports the file fails to load with `SyntaxError: Invalid or
// unexpected token`. Only the advisory `Windows checks` job saw that (#146,
// #150); this runs inside `npm run lint`, so the required `Lint` job fails on
// every platform instead.
//
// Every script here is run as `node scripts/<name>` (package.json, .mcp.json),
// so none needs a shebang. The file content is contributor-controlled, so the
// check reads it defensively: only git-tracked paths (no directory walk, no
// recursion), symlinks are skipped rather than followed out of the repository,
// and at most HEAD_BYTES bytes of each file are read. There is no regex.
import { Buffer } from 'node:buffer'
import { closeSync, lstatSync, openSync, readSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOTS = ['scripts', 'src', 'e2e']
export const EXTS = ['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.cts', '.mts']

// Files that may keep a shebang, each with the reason. Add one only when the
// file is executed directly (`./scripts/x.mjs`) AND no test imports it.
export const ALLOWED = new Map([
  // (none today)
])

const HEAD_BYTES = 5
const BOM = [0xef, 0xbb, 0xbf]

/** True when the buffer starts with `#!`, optionally after a UTF-8 BOM. */
export function startsWithShebang(head) {
  const offset = BOM.every((b, i) => head[i] === b) ? BOM.length : 0
  return head[offset] === 0x23 && head[offset + 1] === 0x21
}

function readHead(file) {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, n)
  } finally {
    closeSync(fd)
  }
}

/** Git-tracked candidate files under ROOTS, repository-relative with `/`. */
export function trackedCandidates(root) {
  return execFileSync('git', ['ls-files', '-z', '--', ...ROOTS], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => EXTS.includes(path.posix.extname(f)))
}

/** Candidate files that start with `#!` and are not on the allow-list. */
export function findShebangs(root, files, allowed = ALLOWED) {
  return files.filter((f) => {
    if (allowed.has(f)) return false
    const abs = path.join(root, f)
    let stat
    try {
      stat = lstatSync(abs)
    } catch {
      return false // tracked but deleted in the working tree
    }
    if (!stat.isFile()) return false // a symlink is never followed
    return startsWithShebang(readHead(abs))
  })
}

export function main(root = process.cwd(), allowed = ALLOWED, log = console) {
  const files = trackedCandidates(root)
  const bad = findShebangs(root, files, allowed)
  if (bad.length) {
    log.error(`Shebang (#!) at the top of ${bad.length} file(s):`)
    for (const f of bad) log.error(`  ${f}`)
    log.error(
      'Run the file as `node <file>` and delete the first line. A CRLF checkout on Windows ' +
        'breaks the shebang when a test imports the file (#151). If the file must be executable, ' +
        'add it with a reason to ALLOWED in scripts/check-shebangs.mjs.',
    )
    return 1
  }
  log.log(`No shebang in ${files.length} script and source files.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root)
}

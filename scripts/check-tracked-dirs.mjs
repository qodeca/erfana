// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Fails when a tracked file under a guarded root folder is missing from the
// working tree (#486).
//
// `.vale/` and `.codex/` were once deleted from this checkout by the app's own
// project-tree Delete command, and nothing noticed until a tool that needs them
// broke. They are dot-folders, so a file listing hides them. This runs inside
// `npm run lint`, so a missing folder fails the lint run that follows the loss.
//
// Only git is asked – no directory walk. When git itself is unavailable the
// check cannot decide, so it warns and passes rather than block an unrelated
// lint run.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const GUARDED = ['.vale', '.codex']

/** Tracked files under `dirs` that are deleted in the working tree, repository-relative with `/`. */
export function deletedTracked(root, dirs = GUARDED) {
  return execFileSync('git', ['ls-files', '--deleted', '-z', '--', ...dirs], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter(Boolean)
}

export function main(root = process.cwd(), dirs = GUARDED, log = console) {
  let missing
  try {
    missing = deletedTracked(root, dirs)
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err)
    log.warn(`Tracked-folder check skipped – git is unavailable (${reason}).`)
    return 0
  }
  if (missing.length) {
    log.error(`${missing.length} tracked file(s) missing from ${dirs.join(', ')}:`)
    for (const f of missing) log.error(`  ${f}`)
    log.error(`Restore them with: git restore -- ${dirs.join(' ')}`)
    return 1
  }
  log.log(`Tracked folders present: ${dirs.join(', ')}.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root)
}

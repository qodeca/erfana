// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The files each window holds unsaved editor changes for
 * (docs/designs/comments/html-preview-comments.md decision 13, §7.8; tests M-011,
 * M-062).
 *
 * The renderer reports its dirty tabs' paths – absolute, in project space,
 * the spelling its tabs use – through `preview:commentSetUnsavedSources`, and
 * the writer asks here before every save (`CommentWriter.hasUnsavedSource`).
 * A path is resolved with `fs.promises.realpath` when it arrives, so a
 * project reached through a symlinked folder still matches the real path the
 * writer locks (M-062); one that does not resolve is kept as written.
 *
 * Before anything is resolved, a reported path must be fully qualified and
 * lexically inside the open project – the only place comments write – and
 * carry no Win32 device or namespace prefix (`\\?\`, `\\.\`, `\??\`).
 * Anything else is dropped unresolved, so a renderer cannot make main touch a
 * path of its choosing: a UNC path is resolved only when the project itself
 * lives on that share. Dropping is safe – comments never write outside the
 * project, so a dirty tab there guards nothing.
 *
 * Kept per window. The HTML Preview asks about its own window only (§7.8
 * "Limitation"); the file-comment family asks about EVERY window
 * ({@link CommentUnsavedSources.hasAny}, spec 024 024-FR-026, § 8 C6), since
 * its writes go straight to disk while any window's editor may hold the file.
 */
import { realpath } from 'node:fs/promises'
import { isAbsolute, normalize, resolve } from 'node:path'
import { isInsideRoot } from '../../utils/pathCompare'
import { withTimeout } from '../../utils/withTimeout'

/** Resolve one path; defaults to `fs.promises.realpath`. */
export type RealpathFn = (path: string) => Promise<string>

/**
 * Longest {@link CommentUnsavedSources.hasAny} waits on reports still being
 * resolved. Past it the answer is "unsaved" – fail closed, so the save is
 * refused and can be retried – rather than holding a write open while a slow
 * lookup decides (security audit of 8a4e442e, L4).
 */
export const UNSAVED_LOOKUP_MAX_WAIT_MS = 250

/** Win32 device and namespace prefixes (`\\?\`, `\\.\`, `\??\`), either separator. */
const WIN_DEVICE_PREFIX = /^[\\/]{2}[?.](?:[\\/]|$)|^[\\/]\?\?(?:[\\/]|$)/

/**
 * Whether a reported path may be resolved: fully qualified (a Windows path
 * rooted without a drive resolves against the current one), no device
 * prefix, and lexically inside `root`.
 */
export function isReportablePath(path: string, root: string | null, platform: NodeJS.Platform = process.platform): boolean {
  if (root === null || WIN_DEVICE_PREFIX.test(path)) return false
  if (!isAbsolute(path) || resolve(path) !== normalize(path)) return false
  return isInsideRoot(resolve(path), resolve(root), platform !== 'win32' && platform !== 'darwin')
}

/** How two real paths compare on `platform`: case-blind where the disk usually is. */
export function samePathKey(path: string, platform: NodeJS.Platform = process.platform): string {
  const normal = resolve(path)
  return platform === 'win32' || platform === 'darwin' ? normal.toLowerCase() : normal
}

/** The process-wide record. */
export interface CommentUnsavedSources {
  /** Replace `windowId`'s dirty files. Resolves once they are resolved. */
  set(windowId: number, paths: readonly string[]): Promise<void>
  /** Whether `windowId` holds unsaved changes for the real path `realPath`. */
  has(windowId: number, realPath: string): Promise<boolean>
  /**
   * Whether any window holds unsaved changes for the real path `realPath`
   * (024-FR-026). `true` when a report is still being resolved after
   * {@link UNSAVED_LOOKUP_MAX_WAIT_MS}.
   */
  hasAny(realPath: string): Promise<boolean>
  /** The window is gone. */
  forget(windowId: number): void
}

/** What the record is built from. */
export interface CommentUnsavedSourcesDeps {
  /** The open project's root as the renderer's tabs spell it (`FileService.getProjectPath`), or `null`. */
  readonly projectRoot: () => string | null
  readonly realpath?: RealpathFn
  readonly platform?: NodeJS.Platform
  /** {@link UNSAVED_LOOKUP_MAX_WAIT_MS} by default. */
  readonly lookupMaxWaitMs?: number
}

/** Build the record. */
export function createCommentUnsavedSources(deps: CommentUnsavedSourcesDeps): CommentUnsavedSources {
  const toReal = deps.realpath ?? (path => realpath(path))
  const platform = deps.platform ?? process.platform
  const maxWaitMs = deps.lookupMaxWaitMs ?? UNSAVED_LOOKUP_MAX_WAIT_MS
  /** The newest `set` per window is the one asked, even while an older one still resolves. */
  const byWindow = new Map<number, Promise<ReadonlySet<string>>>()

  async function resolveAll(paths: readonly string[]): Promise<ReadonlySet<string>> {
    const root = deps.projectRoot()
    const keys = await Promise.all(
      paths.filter(path => isReportablePath(path, root, platform)).map(async path => {
        try {
          return samePathKey(await toReal(path), platform)
        } catch {
          return samePathKey(path, platform)
        }
      })
    )
    return new Set(keys)
  }

  return {
    async set(windowId, paths) {
      const pending = resolveAll(paths)
      byWindow.set(windowId, pending)
      await pending
    },
    async has(windowId, realPath) {
      const pending = byWindow.get(windowId)
      if (pending === undefined) return false
      return (await pending).has(samePathKey(realPath, platform))
    },
    async hasAny(realPath) {
      const key = samePathKey(realPath, platform)
      const answer = Promise.all(byWindow.values()).then(lists => lists.some(list => list.has(key)))
      // resolveAll never rejects, so only the timer can make this throw
      return withTimeout(answer, maxWaitMs, 'unsaved-files lookup').catch(() => true)
    },
    forget(windowId) {
      byWindow.delete(windowId)
    }
  }
}

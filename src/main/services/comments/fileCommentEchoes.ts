// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The own-write echo filter of `file-comment:changed` (§7.5 of the HTML
 * preview comments design, `docs/designs/comments/html-preview-comments.md`).
 *
 * A comment save renames a new file into place, and the file's watch reports
 * that rename like any other change. The panel that saved lists the file
 * again from its own save answer, so the echo would only make it list a
 * second time and restart the preview's render mid-save. After a successful
 * write the file's real path, the SHA-256 the writer left on disk and the
 * writing panel are remembered; on the next change of that path the file is
 * hashed again, and only when it still holds exactly those bytes is the
 * writing panel left out of that one send. Every other panel showing the file
 * is still told – it has no save answer to list from.
 *
 * Fail-open by design: a different hash, a read that fails or throws, or a
 * change with no write remembered sends to every panel. A remembered write is
 * used once, by the first change after it, so a later outside change always
 * sends.
 */
import { logger } from '../LoggingService'
import { readConfinedCommentBytes, type LoadResult } from './commentFileAccess'
import { sha256HexOf } from './commentJobDocs'
import type { CommentWriteResult } from './CommentWriter'

/** One successful comment write not yet matched to its watch event. */
interface OwnWrite {
  /** SHA-256 (hex) of the bytes the write left on disk. */
  readonly hash: string
  /** The writing panel's watch subscriber key. */
  readonly writer: string
}

/** Erfana's own comment writes, per real path, until their echo arrives. */
export class FileCommentEchoes {
  private readonly written = new Map<string, OwnWrite>()
  /** Grows with every {@link FileCommentEchoes.clear}: a write that settles after it remembers nothing. */
  private generation = 0

  constructor(private readonly read: (realPath: string) => Promise<LoadResult> = readConfinedCommentBytes) {}

  /**
   * Remember `write` once it succeeds, as `writer`'s write of `realPath`.
   * A failed or rejected write remembers nothing; its rejection is left to
   * the caller, who holds the same promise.
   *
   * @returns `write` itself.
   */
  track(realPath: string, writer: string, write: Promise<CommentWriteResult>): Promise<CommentWriteResult> {
    const generation = this.generation
    void write.then(
      result => {
        if (result.ok && generation === this.generation) this.written.set(realPath, { hash: result.fileHash, writer })
      },
      // The caller handles the rejection; here it only means there is nothing to remember.
      () => undefined
    )
    return write
  }

  /**
   * A watched file changed: call `send` with the panel to leave out, if any.
   * Synchronous when no write of `realPath` is remembered; otherwise after the
   * file is read and hashed; a `send` that throws there is logged, not left
   * as an unhandled rejection.
   */
  dispatch(realPath: string, send: (skipWriter: string | undefined) => void): void {
    const own = this.written.get(realPath)
    if (own === undefined) {
      send(undefined)
      return
    }
    this.written.delete(realPath)
    void this.holds(realPath, own.hash)
      .then(same => send(same ? own.writer : undefined))
      .catch((error: unknown) => {
        logger.warn('File comments: a change could not be sent', { error: error instanceof Error ? error.name : 'unknown' })
      })
  }

  /** The project changed: forget every remembered write, and any still settling. */
  clear(): void {
    this.generation += 1
    this.written.clear()
  }

  /** Whether `realPath` holds exactly the bytes hashed as `hash`; a failed read is "no". */
  private async holds(realPath: string, hash: string): Promise<boolean> {
    try {
      const read = await this.read(realPath)
      return read.ok && sha256HexOf(read.bytes) === hash
    } catch {
      return false
    }
  }
}

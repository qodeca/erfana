// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The driver the shared file-kind suite runs against (spec 024, 024-FR-002,
 * 024-AC-002; architecture note 001 § 3 "`.txt` test preview").
 *
 * A file kind plugs into the shared base – the writer, the list and the save
 * flow – and the suite proves the base serves it unchanged. Each kind's test
 * implements this driver over the real flow (main's `FileCommentService`, a
 * temporary project, in-process jobs) and runs `fileKind.suite.ts`. The
 * driver speaks in file names, target texts and thread keys only, so the
 * suite needs nothing from main and nothing about the kind's syntax beyond
 * `<!-- … -->` blocks.
 *
 * Test-only and type-only: no imports.
 */

/** One file the suite runs every action on, and the text of the target it comments on. */
export interface FileKindCase {
  /** What the file shows, for test titles: `LF`, `CRLF`, `BOM`, … */
  readonly label: string
  /** The file's name in the project, with the kind's extension. */
  readonly name: string
  /** The decoded file: a leading U+FEFF is written as a UTF-8 byte order mark. */
  readonly text: string
  /** Text the target holds, unique in the file: the driver picks the target that holds it. */
  readonly target: string
}

/** A thread as the list shows it. */
export interface FileKindThread {
  readonly threadKey: string
  readonly rawHash: string
  readonly status: 'open' | 'resolved'
  readonly attached: boolean
  readonly messages: ReadonlyArray<{ readonly id: string; readonly text: string }>
}

/** A change to a listed thread, by its keys (the `file-comment:save` thread ops). */
export type FileKindThreadOp =
  | { readonly op: 'reply'; readonly text: string }
  | { readonly op: 'editMessage'; readonly messageId: string; readonly text: string }
  | { readonly op: 'setStatus'; readonly status: 'open' | 'resolved' }
  | { readonly op: 'deleteThread' }

/** What a save answered. */
export type FileKindSave = { readonly ok: true; readonly threadKey: string | null } | { readonly ok: false; readonly code: string }

/** One kind over the real shared flow, ready for one test. */
export interface FileKindDriver {
  /** The kind, as messages name it. */
  readonly kind: string
  /** The first line of the kind's agent note: every block it writes opens its note with it. */
  readonly agentNoteFirstLine: string
  /** The files to run the actions on: LF, CRLF, mixed line endings, a BOM and no final line break at least. */
  readonly cases: readonly FileKindCase[]

  /** Write `text` as `name`, UTF-8. */
  write(name: string, text: string): Promise<void>
  /** The bytes of `name` on disk. */
  read(name: string): Promise<Uint8Array>
  /** List `name` from disk. */
  list(name: string): Promise<{ readonly writable: boolean; readonly threads: readonly FileKindThread[] }>
  /** Add a comment on the target that holds `target`, through a fresh draft. */
  add(name: string, target: string, text: string): Promise<FileKindSave>
  /** Change a listed thread of `name` by its keys. */
  change(name: string, thread: FileKindThread, op: FileKindThreadOp): Promise<FileKindSave>
  /** Mark `name` as having unsaved edits in an editor (or clear the mark). */
  setUnsaved(name: string, unsaved: boolean): void

  /** Remove everything the driver made. */
  dispose(): Promise<void>
}

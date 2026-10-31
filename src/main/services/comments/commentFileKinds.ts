// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which kinds of file take comments – main's composition root for file kinds
 * (spec 024 architecture note 001 § 3, § 8 C1, C18, C24).
 *
 * A {@link CommentFileKindRegistry} holds every kind by id and by extension.
 * Registering checks the kind: a fresh id, lower-case extensions no other
 * kind claims, and an agent note that may be written into files
 * (`agentNoteProblem`). Once frozen it takes no more kinds, so nothing that
 * runs later – an IPC handler, a page – can widen what is commentable.
 *
 * {@link commentFileKinds} is the production list of the HTML Preview's
 * family; {@link fileCommentKinds} that of the renderer-hosted previews. It is built, filled and
 * frozen when this module loads, which is before any IPC handler can run;
 * the `.txt` conformance kind is never in it (C18) – the tests build their
 * own registry.
 */
import { agentNoteProblem, type CommentFileKind, type CommentFileKindId } from '../../../shared/comments/fileKind'
import { htmlKind } from '../../../shared/comments/htmlKind'
import { markdownKind } from '../../../shared/markdownComments/markdownKind'

/** A lower-case extension with its dot: `.html`, `.md`. */
const EXTENSION = /^\.[a-z0-9]+$/

/** ASCII letters only to lower case: a non-ASCII letter that folds to one (the Kelvin sign) must not match. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, letter => letter.toLowerCase())
}

/** What a caller asks of the registry: the kind a file name maps to. */
export interface CommentFileKindLookup {
  /** The kind of a file name (or path), by its extension in any ASCII case; `undefined` for none. */
  kindOfName(fileName: string): CommentFileKind | undefined
}

/** Every registered comment file kind. */
export class CommentFileKindRegistry implements CommentFileKindLookup {
  private readonly byId = new Map<CommentFileKindId, CommentFileKind>()
  private readonly byExtension = new Map<string, CommentFileKind>()
  private isFrozen = false

  /** True once {@link CommentFileKindRegistry.freeze} ran. */
  get frozen(): boolean {
    return this.isFrozen
  }

  /**
   * Add a kind.
   *
   * @throws Error when the registry is frozen, the id or an extension is
   *   taken or malformed, or the agent note may not be written into files.
   */
  register(kind: CommentFileKind): void {
    if (this.isFrozen) throw new Error(`Comment file kinds are frozen; "${kind.id}" came too late`)
    if (this.byId.has(kind.id)) throw new Error(`Comment file kind "${kind.id}" is already registered`)
    if (kind.extensions.length === 0) throw new Error(`Comment file kind "${kind.id}" names no extension`)
    for (const extension of kind.extensions) {
      if (!EXTENSION.test(extension)) {
        throw new Error(`Comment file kind "${kind.id}": "${extension}" is not a lower-case extension`)
      }
      if (this.byExtension.has(extension)) {
        throw new Error(`Comment file kind "${kind.id}": "${extension}" belongs to another kind`)
      }
    }
    const problem = agentNoteProblem(kind.agentNote)
    if (problem !== undefined) throw new Error(`Comment file kind "${kind.id}": ${problem}`)
    this.byId.set(kind.id, kind)
    for (const extension of kind.extensions) this.byExtension.set(extension, kind)
  }

  /** Take no more kinds. */
  freeze(): void {
    this.isFrozen = true
  }

  /** The kind with this id. */
  kindById(id: CommentFileKindId): CommentFileKind | undefined {
    return this.byId.get(id)
  }

  kindOfName(fileName: string): CommentFileKind | undefined {
    const dot = fileName.lastIndexOf('.')
    return dot < 0 ? undefined : this.byExtension.get(asciiLower(fileName.slice(dot)))
  }

  /** Every registered extension, in registration order. */
  extensions(): readonly string[] {
    return [...this.byExtension.keys()]
  }
}

/** A registry holding `kinds`, frozen. */
export function frozenCommentFileKinds(kinds: readonly CommentFileKind[]): CommentFileKindRegistry {
  const registry = new CommentFileKindRegistry()
  for (const kind of kinds) registry.register(kind)
  registry.freeze()
  return registry
}

/** The production kinds: HTML. */
export const commentFileKinds: CommentFileKindRegistry = frozenCommentFileKinds([htmlKind])

/**
 * The kinds the `file-comment:*` channel family serves – the renderer-hosted
 * previews (spec 024 architecture note 001 § 4, § 8 C18): Markdown. A fixed
 * set of its own: the HTML Preview's files are written only through
 * `preview:comment*`, so HTML is not here, and a `file-comment:*` request for
 * an `.html` file is refused by name. The `.txt` conformance kind never is.
 * A kind added here also needs its job table in the parse worker
 * (`comment-parse.worker.ts`) and its row in `file-comments.ts` (its Settings
 * switch and write options) – without that row its comments stay off.
 */
export const fileCommentKinds: CommentFileKindRegistry = frozenCommentFileKinds([markdownKind])

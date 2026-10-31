// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Composition root of the `file-comment:*` family (spec 024 architecture
 * note 001 § 4): one `FileCommentService` for the process, serving the kinds
 * of `fileCommentKinds`, reading the reviewer from the app settings and every
 * window's unsaved files from the record the HTML Preview's family fills
 * (`preview:commentSetUnsavedSources`), so both families ask one list.
 *
 * Each kind's row in {@link KIND_SETTINGS} says, from the app settings read at
 * call time, whether its comments are on (024-FR-022) and what its write job
 * carries (Markdown: `breaks`, the preview's "preserve line breaks", so the
 * render check renders as the preview does). A kind without a row has its
 * comments off: a new kind is not writable until its Settings switch exists.
 *
 * A project change forgets every panel and closes every watch: a panel lists
 * its file again in the new project. Returns a disposable bundle.
 */
import type { CommentFileKindId } from '../../../shared/comments/fileKind'
import { isMarkdownPreviewCommentsEnabled, type GlobalSettings } from '../../../shared/ipc/global-settings-schema'
import { markdownKind } from '../../../shared/markdownComments/markdownKind'
import type { KindWriteOptions } from '../../services/comments/CommentWriter'
import { fileCommentKinds } from '../../services/comments/commentFileKinds'
import type { CommentUnsavedSources } from '../../services/comments/commentUnsavedSources'
import { FileCommentService } from '../../services/comments/FileCommentService'
import type { ProjectSession } from '../../services/session/ProjectSession'
import { commentIdentityOf } from '../preview/buildPreviewGraph'
import { registerFileCommentHandlers, sendFileCommentChanged } from './file-comment-handlers'

/** What a kind takes from the app settings. */
interface KindSettings {
  readonly enabled: (settings: GlobalSettings) => boolean
  readonly writeOptions: (settings: GlobalSettings) => KindWriteOptions
}

/** Every kind of `fileCommentKinds`, by id. */
export const KIND_SETTINGS: ReadonlyMap<CommentFileKindId, KindSettings> = new Map([
  [
    markdownKind.id,
    {
      enabled: isMarkdownPreviewCommentsEnabled,
      writeOptions: (settings: GlobalSettings) => ({ breaks: settings.editor.preserveLineBreaks })
    }
  ]
])

/** What the family is built from. */
export interface FileCommentsDeps {
  readonly session: Pick<ProjectSession, 'current' | 'onChange'>
  readonly unsaved: Pick<CommentUnsavedSources, 'hasAny'>
  readonly getSettings: () => GlobalSettings
}

/** The registered family. */
export interface FileCommentsBundle {
  dispose(): Promise<void>
}

/** Build the service and register its channels. Call once, at startup. */
export function registerFileComments(deps: FileCommentsDeps): FileCommentsBundle {
  const service = new FileCommentService({
    kinds: fileCommentKinds,
    unsaved: deps.unsaved,
    identity: () => commentIdentityOf(deps.getSettings()),
    send: sendFileCommentChanged,
    isKindEnabled: kind => KIND_SETTINGS.get(kind.id)?.enabled(deps.getSettings()) ?? false,
    writeOptions: kind => KIND_SETTINGS.get(kind.id)?.writeOptions(deps.getSettings()) ?? {}
  })
  const unregister = registerFileCommentHandlers({ service, session: deps.session })
  const unsubscribe = deps.session.onChange(() => {
    void service.clear()
  })
  return {
    async dispose() {
      unregister()
      unsubscribe()
      await service.clear()
    }
  }
}

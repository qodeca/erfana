// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * IPC handler for images referenced from Markdown (`markdown-image:read`, #71).
 *
 * The Markdown preview cannot load `./assets/icon.svg` itself: its page is the
 * app bundle, so a relative `src` resolves there. Like the image viewer (#70),
 * the main process reads the bytes and returns a `data:` URL. Gates, in order,
 * before anything is read:
 *
 * 1. the process-wide `isTrustedAppSender` gate in `registry.ts`;
 * 2. **`isTrustedSender`** – the app's own top-level frame only, checked before
 *    the payload is looked at;
 * 3. **Zod** – `{ filePath, knownVersion? }`, strict;
 * 4. **confinement** – a path not lexically inside the project root is
 *    refused before the file system is asked anything; then
 *    `resolveConfinedPath` in `project` mode: the nearest
 *    existing ancestor is canonicalised, links and junctions included, and must
 *    lie inside the open project; the file must exist and be a file;
 * 5. **type** – the requested AND the canonical path must both end in one of
 *    the five web image extensions, so an in-project link named `x.png` cannot
 *    hand back some other in-project file.
 *
 * Then `readDocumentImage` opens the file once, refuses anything but a regular
 * file from `fstat` on that handle, and reads at most
 * `MARKDOWN_IMAGE_MAX_BYTES + 1` bytes, with the same version token as the
 * image viewer. Every refusal is an answer, never a
 * rejected invoke, and none carries a path or says whether something outside
 * the project exists.
 *
 * The bytes go back as a `data:` URL for an `<img>`. The renderer never inlines
 * them into the DOM, so an SVG's scripts and external references stay inert
 * (an image context runs no script and fetches nothing).
 *
 * @see src/shared/ipc/markdown-image-schema.ts for the contract
 */
import type { IpcMainInvokeEvent } from 'electron'
import { MARKDOWN_IMAGE_CHANNELS } from '../../shared/ipc/markdown-image-channels'
import {
  MARKDOWN_IMAGE_MAX_BYTES,
  MarkdownImageReadRequestSchema,
  isMarkdownImagePath,
  type MarkdownImageReadResponse,
  type MarkdownImageRefusal
} from '../../shared/ipc/markdown-image-schema'
import { payloadArgs } from '../../shared/ipc/file-schema'
import { logger } from '../services/LoggingService'
import { ImageTooLargeError } from '../services/file/imageRead'
import { NotARegularFileError, readDocumentImage } from '../services/file/readDocumentImage'
import type { ProjectSession } from '../services/session/ProjectSession'
import { redactPath, redactedLogError } from '../utils/redactUserInput'
import { registerConfinedHandle } from './confinement/registerConfinedHandle'
import type { ConfinementError } from './confinement/ConfinementError'
import type { ConfinementDeps } from './confinement/resolveConfinedPath'
import { isTrustedSender } from './senderValidation'

/** The single refusal shape this channel returns. */
function refuse(reason: MarkdownImageRefusal): MarkdownImageReadResponse {
  return { status: 'refused', reason }
}

/**
 * Map a confinement refusal to the reason the preview shows. A path that
 * leaves the project, a link whose target cannot be shown, and "no project"
 * all read the same, so the answer says nothing about what is outside.
 */
export function refusalForConfinement(error: ConfinementError): MarkdownImageReadResponse {
  switch (error.code) {
    case 'NOT_FOUND':
    case 'WRONG_KIND':
      return refuse('not-found')
    case 'OUTSIDE_PROJECT':
    case 'UNVERIFIABLE':
    case 'NO_PROJECT':
    case 'NOT_SESSION_OWNER':
    case 'PROJECT_CHANGED':
      return refuse('outside-project')
    default:
      return refuse('unreadable')
  }
}

/** Sender gate: the app's own top-level renderer frame only. */
function allowSender(event: IpcMainInvokeEvent): boolean {
  const trusted = isTrustedSender(event)
  if (!trusted) {
    logger.warn('Rejected markdown-image:read from untrusted sender', {
      url: redactPath(event.senderFrame?.url ?? '')
    })
  }
  return trusted
}

/**
 * Register the Markdown image IPC handler.
 *
 * @param session - The project session the confinement check reads
 * @param confinementDeps - File system and path flavour for the path check (tests inject fakes)
 */
export function registerMarkdownImageHandlers(
  session: ProjectSession,
  confinementDeps?: ConfinementDeps
): void {
  registerConfinedHandle(
    MARKDOWN_IMAGE_CHANNELS.read,
    {
      schema: payloadArgs(MarkdownImageReadRequestSchema),
      paths: {
        filePath: { arg: 0, key: 'filePath', mode: 'project', mustExist: true, kind: 'file' }
      },
      senderGate: { allow: allowSender, denied: () => refuse('unreadable') },
      // A missing image is routine for a document being written; refusals stay
      // out of the warning log.
      refusalLogLevel: 'debug',
      lexicalPrecheck: true,
      confinementDeps,
      onRefusal: (error) => refusalForConfinement(error),
      handler: async (_ctx, [{ knownVersion }], { filePath }): Promise<MarkdownImageReadResponse> => {
        if (!isMarkdownImagePath(filePath.requested) || !isMarkdownImagePath(filePath.real)) {
          return refuse('unsupported-type')
        }
        try {
          return await readDocumentImage(filePath.real, knownVersion, MARKDOWN_IMAGE_MAX_BYTES)
        } catch (error) {
          if (error instanceof ImageTooLargeError) return refuse('too-large')
          if (error instanceof NotARegularFileError) return refuse('not-found')
          // A raw Node error can carry an absolute path: logged redacted, never returned
          logger.debug('markdown-image:read failed', { error: redactedLogError(error)?.message })
          return refuse('unreadable')
        }
      }
    },
    session
  )

  logger.info('✅ Markdown image IPC handlers registered')
}

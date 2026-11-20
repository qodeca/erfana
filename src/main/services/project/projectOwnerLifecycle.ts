// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * projectOwnerLifecycle - a window's open project ends with its page (#485).
 *
 * A reload (View > Reload, Force Reload) keeps the `webContents`, so the
 * `destroyed` close never runs. The new page starts with no project by design
 * (#60), yet main still had the old one open: reopening it was a same-project
 * no-op, no `project:changed` went out and the tree stayed empty. On every
 * `did-navigate` the open project is therefore closed as `page-reloaded`.
 *
 * - The first `did-navigate`, at start-up, finds no session and does nothing.
 * - The close carries the generation read at the navigation, so a project
 *   opened after it is left alone, and the owner check in `ProjectService`
 *   keeps another window's reload from closing this window's project.
 * - `page-reloaded` keeps the last project path: Recent Projects still lists it.
 */
import type { WebContents } from 'electron'
import { redactedLogError } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import type { CloseContext } from '../ProjectService'
import type { ProjectSession } from '../session/ProjectSession'

/** The slice of `ProjectService` a page's end touches. */
export interface ProjectOwnerTarget {
  readonly session: Pick<ProjectSession, 'current'>
  close(ctx: CloseContext): Promise<void>
}

/** The `webContents` event this module listens to. */
export type ProjectOwnerContents = Pick<WebContents, 'id'> & {
  on(event: 'did-navigate', listener: () => void): unknown
}

/** Close the window's open project whenever its page navigates (a reload included). */
export function wireProjectOwner(contents: ProjectOwnerContents, projects: ProjectOwnerTarget): void {
  // Read once: a destroyed webContents throws on property access
  const webContentsId = contents.id
  contents.on('did-navigate', () => {
    // Read synchronously, at the navigation: a later open must not be the one closed
    const open = projects.session.current()
    if (!open) return
    logger.info('Page navigated, closing its project', {
      webContentsId,
      generation: open.generation
    })
    projects
      .close({ senderId: webContentsId, reason: 'page-reloaded', expectedGeneration: open.generation })
      .catch(error => {
        logger.error('Closing the project after a page navigation failed', redactedLogError(error))
      })
  })
}

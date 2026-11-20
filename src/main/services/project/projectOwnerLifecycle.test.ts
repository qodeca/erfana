// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A window's open project ends with its page (#485): every `did-navigate` – a
 * reload included – closes it as `page-reloaded` with the generation read at
 * the navigation; the start-up navigation, with nothing open, does nothing.
 */
import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { logger } from '../LoggingService'
import type { ProjectSessionSnapshot } from '../session/ProjectSession'
import {
  wireProjectOwner,
  type ProjectOwnerContents,
  type ProjectOwnerTarget
} from './projectOwnerLifecycle'

const WINDOW_ID = 7
const SECRET_ROOT = '/Users/alice/secret-project'

/** A webContents that can be navigated. */
function fakeContents(id: number): ProjectOwnerContents & EventEmitter {
  return Object.assign(new EventEmitter(), { id }) as ProjectOwnerContents & EventEmitter
}

function snapshot(generation: number): ProjectSessionSnapshot {
  return { root: SECRET_ROOT, generation, ownerWebContentsId: WINDOW_ID } as ProjectSessionSnapshot
}

let open: ProjectSessionSnapshot | null
let projects: ProjectOwnerTarget & { close: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.clearAllMocks()
  open = null
  projects = {
    session: { current: () => open },
    close: vi.fn(() => Promise.resolve())
  }
})

describe('wireProjectOwner', () => {
  it('does nothing on the start-up navigation, when no project is open', () => {
    const contents = fakeContents(WINDOW_ID)
    wireProjectOwner(contents, projects)

    contents.emit('did-navigate')

    expect(projects.close).not.toHaveBeenCalled()
  })

  it('closes the open project as page-reloaded, for this window, at the current generation', () => {
    const contents = fakeContents(WINDOW_ID)
    wireProjectOwner(contents, projects)
    open = snapshot(3)

    contents.emit('did-navigate')

    expect(projects.close).toHaveBeenCalledTimes(1)
    expect(projects.close).toHaveBeenCalledWith({
      senderId: WINDOW_ID,
      reason: 'page-reloaded',
      expectedGeneration: 3
    })
  })

  it('reads the generation at the navigation, not when the close runs', () => {
    const contents = fakeContents(WINDOW_ID)
    wireProjectOwner(contents, projects)
    open = snapshot(3)

    contents.emit('did-navigate')
    open = snapshot(4)

    expect(projects.close).toHaveBeenCalledWith(expect.objectContaining({ expectedGeneration: 3 }))
  })

  it('closes again on each later reload', () => {
    const contents = fakeContents(WINDOW_ID)
    wireProjectOwner(contents, projects)

    open = snapshot(1)
    contents.emit('did-navigate')
    open = snapshot(3)
    contents.emit('did-navigate')

    expect(projects.close).toHaveBeenCalledTimes(2)
    expect(projects.close).toHaveBeenLastCalledWith(expect.objectContaining({ expectedGeneration: 3 }))
  })

  it('logs a failed close without the project path', async () => {
    const contents = fakeContents(WINDOW_ID)
    wireProjectOwner(contents, projects)
    open = snapshot(2)
    const failure = Object.assign(new Error(`EBUSY: resource busy, unlink '${SECRET_ROOT}/.lock'`), {
      code: 'EBUSY',
      syscall: 'unlink'
    })
    projects.close.mockRejectedValueOnce(failure)

    contents.emit('did-navigate')
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1))

    const [message, error] = vi.mocked(logger.error).mock.calls[0]
    expect(message).not.toContain('alice')
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain('alice')
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('alice')
  })
})

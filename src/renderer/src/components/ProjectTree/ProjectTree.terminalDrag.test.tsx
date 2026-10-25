// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Dragging a tree item onto the terminal inserts its path quoted for the
 * terminal's own shell (the kind kept in the terminal store).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { TEST_IDS } from '../../constants/testids'
import { installTreeViewport } from '../../test-utils/treeViewport'
import type { FileNode } from '../../../../preload/index'

installTreeViewport()

const PROJECT_PATH = '/projA'

// Captures the handlers ProjectTree hands to dnd-kit so a drag can be driven
// without a real pointer.
const dnd = vi.hoisted(() => ({
  props: null as any
}))

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    DndContext: (props: any) => {
      dnd.props = props
      return props.children
    }
  }
})

let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

function tree(): FileNode[] {
  return [{ name: 'top.md', path: `${PROJECT_PATH}/top.md`, type: 'file', extension: '.md' }]
}

function setupMockApi(): void {
  ;(window as any).api = {
    file: {
      readDirectory: vi.fn(async () => tree()),
      onProjectChanged: vi.fn((cb: any) => {
        onProjectChangedCallback = cb
        return () => {}
      }),
      closeProject: vi.fn(async () => undefined),
      getStats: vi.fn(async () => ({ size: 0 }))
    },
    directoryWatch: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      pause: vi.fn(async () => ({ success: true })),
      resume: vi.fn(async () => ({ success: true })),
      onDirectoryChanged: () => () => {},
      onProjectDeleted: () => () => {},
      onDirectoryError: () => () => {}
    },
    gitWatcher: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      onStateChanged: () => () => {}
    },
    gitPolling: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      onPollTriggered: () => () => {}
    },
    git: {
      getStatus: vi.fn(async () => ({
        isGitRepo: false,
        branch: null,
        isDetached: false,
        files: [],
        counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
        truncated: false
      }))
    },
    import: { isSupported: vi.fn(async () => false) },
    logging: { log: vi.fn() }
  }
}

function addFakeTerminal(): void {
  for (const id of [TEST_IDS.TERMINAL_PANEL, TEST_IDS.TERMINAL_INSTANCE]) {
    const el = document.createElement('div')
    el.setAttribute('data-testid', id)
    el.getBoundingClientRect = () =>
      ({ left: 0, right: 1000, top: 0, bottom: 1000, width: 1000, height: 1000 }) as DOMRect
    document.body.appendChild(el)
  }
}

async function dragToTerminal(sourcePath: string): Promise<void> {
  const active = { id: sourcePath }
  await act(async () => {
    dnd.props.onDragStart({ active })
  })
  await act(async () => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }))
  })
  await act(async () => {
    await dnd.props.onDragEnd({ active, over: null })
  })
}

let sendToTerminal: Mock

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChangedCallback = null
  setupMockApi()
  addFakeTerminal()
  sendToTerminal = vi.fn(async () => true)
  useTerminalStore.setState({ sendToTerminal } as any)
})

afterEach(() => {
  document.querySelectorAll('[data-testid^="terminal"]').forEach((el) => el.remove())
  useTerminalStore.setState({ activeTerminalId: null, activeShellKind: null })
})

describe('ProjectTree drag to terminal', () => {
  async function renderTree(): Promise<void> {
    render(
      <DialogProvider>
        <ProjectManagementProvider>
          <ProjectTree
            onFileSelect={vi.fn()}
            showControlPanel={false}
            filterMode={'all' as any}
            onFilterModeChange={() => {}}
          />
        </ProjectManagementProvider>
      </DialogProvider>
    )
    await act(async () => {
      onProjectChangedCallback!({ newPath: PROJECT_PATH, oldPath: null })
    })
    await waitFor(() => expect(screen.getByText('top.md')).toBeInTheDocument())
  }

  it('quotes the path for a powershell terminal', async () => {
    await renderTree()
    useTerminalStore.getState().setActiveTerminal({ id: 't1', shellKind: 'powershell' })

    await dragToTerminal('C:\\Users\\Bob\u2019s Files\\proj\\notes.md')

    expect(sendToTerminal).toHaveBeenCalledWith(
      "'C:\\Users\\Bob\u2019\u2019s Files\\proj\\notes.md'",
      false
    )
  })

  it('quotes the path for a cmd terminal', async () => {
    await renderTree()
    useTerminalStore.getState().setActiveTerminal({ id: 't1', shellKind: 'cmd' })

    await dragToTerminal('C:\\Users\\Bob\\notes.md')

    expect(sendToTerminal).toHaveBeenCalledWith('"C:\\Users\\Bob\\notes.md"', false)
  })
})

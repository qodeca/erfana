// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project row's real action list (#451): its order, which button is raised
 * (New file moves into the "More actions" menu last), and the state each
 * button carries into the menu – busy Import, disabled while switching or
 * loading, the Refresh shortcut. Icons and tooltips are projectRowActions.test.tsx's (#452).
 */
import { describe, it, expect, vi } from 'vitest'
import { buildProjectRowActions, type ProjectRowActionsInput } from './projectRowActions'
import { moveOrder } from '../ToolbarOverflow/toolbarOverflow.logic'
import { TEST_IDS } from '../../constants/testids'

function input(overrides: Partial<ProjectRowActionsInput> = {}): ProjectRowActionsInput {
  return {
    projectPath: '/projects/notes',
    isSwitchingProject: false,
    loading: false,
    isImporting: false,
    isAnyRefreshing: false,
    onOpenProject: vi.fn(),
    onCloseProject: vi.fn(),
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    onImport: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides
  }
}

function byId(actions: ReturnType<typeof buildProjectRowActions>, id: string) {
  const action = actions.find((a) => a.id === id)
  if (!action) throw new Error(`no action ${id}`)
  return action
}

describe('buildProjectRowActions', () => {
  it('lists the six buttons in toolbar order with a project open', () => {
    expect(buildProjectRowActions(input()).map((a) => a.id)).toEqual([
      'open',
      'close',
      'new-file',
      'new-folder',
      'import',
      'refresh'
    ])
  })

  it('shows only Open project without a project', () => {
    const actions = buildProjectRowActions(input({ projectPath: null }))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ id: 'open', label: 'Open project', testId: TEST_IDS.PROJECT_TREE_BTN_OPEN })
  })

  it('raises New file, and only New file, so it moves into the menu last', () => {
    const actions = buildProjectRowActions(input())
    expect(actions.filter((a) => a.moveLast).map((a) => a.id)).toEqual(['new-file'])
    const order = moveOrder(actions.map(({ id, moveLast }) => ({ id, width: 24, moveLast })))
    expect(order[order.length - 1]).toBe('new-file')
    expect(order).toEqual(['refresh', 'import', 'new-folder', 'close', 'open', 'new-file'])
  })

  it('carries a busy Import into the menu as a disabled “Importing file…” item', () => {
    const idle = byId(buildProjectRowActions(input()), 'import')
    expect(idle.busy).toBe(false)
    const busy = byId(buildProjectRowActions(input({ isImporting: true })), 'import')
    expect(busy).toMatchObject({ busy: true, busyLabel: 'Importing file…', ariaLabel: 'Importing file...' })
  })

  it('disables Change and Close project while switching, and New file / New folder while loading', () => {
    const switching = buildProjectRowActions(input({ isSwitchingProject: true }))
    expect(byId(switching, 'open').disabled).toBe(true)
    expect(byId(switching, 'close').disabled).toBe(true)
    const loading = buildProjectRowActions(input({ loading: true }))
    expect(byId(loading, 'new-file').disabled).toBe(true)
    expect(byId(loading, 'new-folder').disabled).toBe(true)
    expect(byId(loading, 'open').disabled).toBe(false)
  })

  it('gives Refresh its shortcut for the menu’s shortcut column, and disables it while refreshing', () => {
    const refresh = byId(buildProjectRowActions(input()), 'refresh')
    expect(refresh.shortcut).toBeTruthy()
    expect(refresh.title).toBe(`Refresh (${refresh.shortcut})`)
    expect(byId(buildProjectRowActions(input({ isAnyRefreshing: true })), 'refresh').disabled).toBe(true)
  })

  it('wires each button to its own handler', () => {
    const p = input()
    const actions = buildProjectRowActions(p)
    for (const action of actions) action.onSelect()
    for (const handler of [p.onOpenProject, p.onCloseProject, p.onNewFile, p.onNewFolder, p.onImport, p.onRefresh]) {
      expect(handler).toHaveBeenCalledTimes(1)
    }
  })
})

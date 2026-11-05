// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * projectRowActions.test.tsx
 *
 * Pins the icon and tooltip of every project row button (#452 acceptance:
 * "Other toolbar buttons are unchanged"), including the states the wired
 * ProjectTree cannot easily reach: switching project and importing.
 *
 * Each action's `icon` is rendered on its own and read by its lucide class
 * (lucide-react renders `class="lucide lucide-<name>"`), the same way
 * ProjectTree.toolbar.test.tsx reads the rendered row.
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { buildProjectRowActions, type ProjectRowActionsInput } from './projectRowActions'
import type { ToolbarAction } from '../ToolbarOverflow/ToolbarOverflow'

vi.mock('../../utils/shortcutLabel', () => ({ formatShortcut: () => 'Ctrl+Alt+R' }))

function input(overrides: Partial<ProjectRowActionsInput> = {}): ProjectRowActionsInput {
  return {
    projectPath: '/proj',
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

function action(actions: ToolbarAction[], id: string): ToolbarAction {
  const found = actions.find(a => a.id === id)
  if (!found) throw new Error(`no action "${id}" in [${actions.map(a => a.id).join(', ')}]`)
  return found
}

/** Render one action's icon and return its root element. */
function iconOf(a: ToolbarAction): HTMLElement {
  const { container } = render(<span>{a.icon}</span>)
  return container.firstElementChild as HTMLElement
}

function lucideNames(el: HTMLElement): string[] {
  return [...el.querySelectorAll('svg')].flatMap(svg => [...svg.classList].filter(c => c.startsWith('lucide-')))
}

describe('buildProjectRowActions icons and tooltips (#452)', () => {
  it.each([
    { id: 'open', icon: 'lucide-replace', title: 'Change project' },
    { id: 'close', icon: 'lucide-x', title: 'Close project' },
    { id: 'new-file', icon: 'lucide-file-plus', title: 'Create new markdown file' },
    { id: 'new-folder', icon: 'lucide-folder-plus', title: 'Create new folder' },
    { id: 'import', icon: 'lucide-file-input', title: 'Import a file' },
    { id: 'refresh', icon: 'lucide-rotate-cw', title: 'Refresh (Ctrl+Alt+R)' }
  ])('with a project open, $id shows $icon and the tooltip "$title"', ({ id, icon, title }) => {
    const a = action(buildProjectRowActions(input()), id)
    expect(lucideNames(iconOf(a))).toEqual([icon])
    expect(a.title).toBe(title)
  })

  it('with no project, shows only Open project with folder-open', () => {
    const actions = buildProjectRowActions(input({ projectPath: null }))

    expect(actions.map(a => a.id)).toEqual(['open'])
    expect(lucideNames(iconOf(actions[0]))).toEqual(['lucide-folder-open'])
    expect(actions[0].title).toBe('Open project')
  })

  it('while switching project, Open shows the spinning rotate-cw and is disabled', () => {
    const open = action(buildProjectRowActions(input({ isSwitchingProject: true })), 'open')
    const icon = iconOf(open)

    expect(lucideNames(icon)).toEqual(['lucide-rotate-cw'])
    expect(icon.querySelector('svg')).toHaveClass('spin')
    expect(open.disabled).toBe(true)
  })

  it('while importing, Import shows an aria-hidden busy ring, no glyph, and the busy tooltip', () => {
    const importAction = action(buildProjectRowActions(input({ isImporting: true })), 'import')
    const icon = iconOf(importAction)

    expect(lucideNames(icon)).toEqual([])
    const ring = icon.querySelector('.icon-btn__busy-ring')
    expect(ring).not.toBeNull()
    expect(ring).toHaveAttribute('aria-hidden', 'true')
    expect(importAction.title).toBe('Importing file...')
    expect(importAction.ariaLabel).toBe('Importing file...')
    expect(importAction.busy).toBe(true)
  })

  it('Refresh spins only while a refresh runs; Import never borrows its arrows', () => {
    const idle = action(buildProjectRowActions(input()), 'refresh')
    const busy = action(buildProjectRowActions(input({ isAnyRefreshing: true })), 'refresh')

    expect(iconOf(idle).querySelector('svg')).not.toHaveClass('spin')
    expect(iconOf(busy).querySelector('svg')).toHaveClass('spin')
    const importing = action(buildProjectRowActions(input({ isImporting: true, isAnyRefreshing: true })), 'import')
    expect(iconOf(importing).querySelector('.lucide-rotate-cw')).toBeNull()
  })
})

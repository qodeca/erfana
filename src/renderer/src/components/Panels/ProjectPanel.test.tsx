// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectPanel.test.tsx
 *
 * The Project panel header (#452, docs/designs/project-tree/toolbar-icons.html):
 * - the file-filter trigger is a real button – named, keyboard-reachable,
 *   aria-expanded and aria-controls the filter panel (it was a <span>)
 * - "Markdown only" shows in words in the header while that filter is on,
 *   whether the filter panel is open or closed
 *
 * The tree itself is stubbed: this file is about the header, and the tree's
 * own filter rendering is covered by ProjectTree.toolbar.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ISplitviewPanelProps } from 'dockview'
import { ProjectPanel } from './ProjectPanel'
import { PROJECT_FILTER_PANEL_ID } from '../ProjectTree/constants'
import type { FilterMode } from '../../types/filters'

const settings = vi.hoisted(() => ({
  getProjectFilterMode: vi.fn(async (): Promise<{ success: boolean; mode?: string }> => ({ success: true, mode: 'all' })),
  setProjectFilterMode: vi.fn(async () => ({ success: true }))
}))

vi.mock('../../services/settingsGateway', () => ({ settingsGateway: settings }))

vi.mock('../ProjectTree/ProjectTree', () => ({
  ProjectTree: (props: { showControlPanel: boolean; filterMode: FilterMode; onFilterModeChange: (m: FilterMode) => void }) => (
    <div data-testid="tree-stub" data-show-panel={String(props.showControlPanel)} data-filter={props.filterMode}>
      <button type="button" onClick={() => props.onFilterModeChange('markdown')}>stub: markdown</button>
      <button type="button" onClick={() => props.onFilterModeChange('all')}>stub: all</button>
    </div>
  )
}))

function renderPanel() {
  return render(<ProjectPanel {...({ params: {} } as unknown as ISplitviewPanelProps)} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  settings.getProjectFilterMode.mockResolvedValue({ success: true, mode: 'all' })
})

describe('ProjectPanel file-filter trigger (#452)', () => {
  it('is a button named "File filter" that is reachable by keyboard', async () => {
    renderPanel()

    const trigger = screen.getByRole('button', { name: 'File filter' })
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger).toHaveAttribute('type', 'button')
    trigger.focus()
    expect(trigger).toHaveFocus()
    expect(trigger.querySelector('svg.lucide-funnel')).not.toBeNull()
    await waitFor(() => expect(settings.getProjectFilterMode).toHaveBeenCalled())
  })

  it('opens and closes the filter panel, reporting aria-expanded and aria-controls', async () => {
    renderPanel()

    const trigger = screen.getByRole('button', { name: 'File filter' })
    expect(trigger).toHaveAttribute('aria-controls', PROJECT_FILTER_PANEL_ID)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('tree-stub')).toHaveAttribute('data-show-panel', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('tree-stub')).toHaveAttribute('data-show-panel', 'true')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(settings.getProjectFilterMode).toHaveBeenCalled())
  })
})

describe('ProjectPanel active-filter words (#452)', () => {
  it('shows no filter words while All files is on', async () => {
    renderPanel()

    await waitFor(() => expect(settings.getProjectFilterMode).toHaveBeenCalled())
    expect(screen.queryByText('Markdown only')).not.toBeInTheDocument()
  })

  it('shows "Markdown only" with the panel closed when that filter was persisted', async () => {
    settings.getProjectFilterMode.mockResolvedValue({ success: true, mode: 'markdown' })
    renderPanel()

    expect(await screen.findByText('Markdown only')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'File filter' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('follows the filter as it changes, and persists it', async () => {
    renderPanel()
    await waitFor(() => expect(settings.getProjectFilterMode).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'stub: markdown' }))
    expect(await screen.findByText('Markdown only')).toBeInTheDocument()
    expect(settings.setProjectFilterMode).toHaveBeenCalledWith('markdown')

    fireEvent.click(screen.getByRole('button', { name: 'stub: all' }))
    await waitFor(() => expect(screen.queryByText('Markdown only')).not.toBeInTheDocument())
  })
})

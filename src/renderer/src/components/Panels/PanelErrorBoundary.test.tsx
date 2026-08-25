// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the panel-scoped error boundary.
 *
 * The point of this tier is containment, not recovery: a project-tree defect
 * must not cost the user their unsaved Monaco buffers and their terminal. So
 * the assertions that matter are "siblings stay mounted" and "logged at error,
 * not fatal".
 *
 * `console.error` is suppressed per the `EditorErrorBoundary.test.tsx` pattern.
 *
 * @see docs/design/design-issue-60.md §5 (`PanelErrorBoundary` row)
 */

import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PanelErrorBoundary } from './PanelErrorBoundary'
import { TEST_IDS } from '../../constants/testids'
import { logger } from '../../utils/logger'

vi.mock('../../utils/logger', () => ({
  logger: {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn()
  }
}))

/**
 * A panel whose failure the TEST controls.
 *
 * A "throws on first render only" component does not work here: React retries
 * the failed render synchronously before giving up, so a self-clearing flag is
 * already false by the second attempt and the boundary never trips.
 */
const panelControl = { shouldThrow: true }

function ControlledPanel(): JSX.Element {
  if (panelControl.shouldThrow) {
    throw new Error('tree exploded')
  }
  return <div data-testid="tree-content">tree</div>
}

function Boom(): never {
  throw new Error('tree exploded')
}

/**
 * A panel that mounts healthy and dies later, while the user is inside it.
 *
 * The shape the attempt counter cannot see: no Reload was pressed, so the
 * "failed retry" gate is false and the restore has to come from the
 * focus-was-inside snapshot instead. Clicking also puts focus on the button,
 * which is what makes the crash happen with focus inside the boundary.
 */
function CrashesWhileFocused(): JSX.Element {
  const [crashed, setCrashed] = useState(false)
  if (crashed) throw new Error('tree exploded later')
  return (
    <button type="button" data-testid="tree-button" onClick={() => setCrashed(true)}>
      tree
    </button>
  )
}

function Sibling(): JSX.Element {
  return <div data-testid="sibling">editor and terminal</div>
}

/** Accessible name of the Reload button for the panel used in these tests. */
const RELOAD_TREE = 'Reload project tree'

describe('PanelErrorBoundary', () => {
  const originalConsoleError = console.error

  beforeEach(() => {
    vi.resetAllMocks()
    console.error = vi.fn()
    // Module-scope mutable fixture: a test that leaves it `false` would make a
    // later "the panel throws" test silently pass on a healthy render.
    panelControl.shouldThrow = true
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  describe('healthy path', () => {
    it('renders its children', () => {
      render(
        <PanelErrorBoundary componentName="Project tree">
          <Sibling />
        </PanelErrorBoundary>
      )

      expect(screen.getByTestId('sibling')).toBeInTheDocument()
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('caught throw', () => {
    it('degrades to a named fallback inside the panel', () => {
      render(
        <PanelErrorBoundary componentName="Project tree">
          <Boom />
        </PanelErrorBoundary>
      )

      expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeInTheDocument()
      // The second sentence is the whole point of this tier: the user must know
      // the editor and terminal survived, not just that something broke.
      expect(
        screen.getByText('Project tree unavailable. The rest of Erfana still works.')
      ).toBeInTheDocument()
    })

    it('names the reload target in the accessible name', () => {
      render(
        <PanelErrorBoundary componentName="Project tree">
          <Boom />
        </PanelErrorBoundary>
      )

      const reload = screen.getByRole('button', { name: RELOAD_TREE })
      // Visible label stays short; the accessible name is the long form and
      // starts with it (WCAG 2.5.3 label-in-name).
      expect(reload).toHaveTextContent('Reload')
    })

    it('announces through the Reload button alone, with no second live region', () => {
      // ONE ANNOUNCEMENT CHANNEL. The boundary moves focus onto this button on
      // failure, and the description rides that move — the accessible name
      // alone says nothing about what happened. A `role="alert"` on the
      // container would land in the SAME tick with the SAME sentence, so the
      // user would hear it twice (or interleaved).
      render(
        <PanelErrorBoundary componentName="Project tree">
          <Boom />
        </PanelErrorBoundary>
      )

      expect(screen.getByRole('button', { name: RELOAD_TREE })).toHaveAccessibleDescription(
        'Project tree unavailable. The rest of Erfana still works.'
      )
      expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).not.toHaveAttribute('role')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('falls back to a generic name when none is given', () => {
      render(
        <PanelErrorBoundary>
          <Boom />
        </PanelErrorBoundary>
      )

      expect(
        screen.getByText('Panel unavailable. The rest of Erfana still works.')
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reload panel' })).toBeInTheDocument()
    })

    it('renders a custom fallback when supplied', () => {
      render(
        <PanelErrorBoundary componentName="Project tree" fallback={<span>custom</span>}>
          <Boom />
        </PanelErrorBoundary>
      )

      expect(screen.getByText('custom')).toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).not.toBeInTheDocument()
    })

    it('logs at error level, never fatal', () => {
      // `fatal` belongs to the root boundary: the window is still usable here,
      // and inflating the severity would bury real crashes in the log.
      render(
        <PanelErrorBoundary componentName="Project tree">
          <Boom />
        </PanelErrorBoundary>
      )

      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledWith(
        '[PanelErrorBoundary] Project tree error',
        expect.any(Error),
        expect.objectContaining({ componentStack: expect.stringContaining('Boom') })
      )
      expect(logger.fatal).not.toHaveBeenCalled()
    })

    it('leaves the rest of the app mounted', () => {
      render(
        <div>
          <PanelErrorBoundary componentName="Project tree">
            <Boom />
          </PanelErrorBoundary>
          <Sibling />
        </div>
      )

      expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeInTheDocument()
      expect(screen.getByTestId('sibling')).toBeInTheDocument()
    })
  })

  describe('Reload', () => {
    it('clears the error state and re-renders the panel', async () => {
      const user = userEvent.setup()

      render(
        <PanelErrorBoundary componentName="Project tree">
          <ControlledPanel />
        </PanelErrorBoundary>
      )

      expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeInTheDocument()

      panelControl.shouldThrow = false
      await user.click(screen.getByRole('button', { name: RELOAD_TREE }))

      expect(screen.getByTestId('tree-content')).toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).not.toBeInTheDocument()
    })

    it('shows the fallback again when the panel throws on retry', async () => {
      const user = userEvent.setup()

      render(
        <PanelErrorBoundary componentName="Project tree">
          <Boom />
        </PanelErrorBoundary>
      )

      await user.click(screen.getByRole('button', { name: RELOAD_TREE }))

      expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeInTheDocument()
      expect(logger.error).toHaveBeenCalledTimes(2)
    })

    it('stops repeating the reassurance once a retry has failed', async () => {
      const user = userEvent.setup()

      render(
        <PanelErrorBoundary componentName="Project tree">
          <Boom />
        </PanelErrorBoundary>
      )

      await user.click(screen.getByRole('button', { name: RELOAD_TREE }))

      expect(screen.getByText('Project tree is still unavailable.')).toBeInTheDocument()
      expect(
        screen.queryByText('Project tree unavailable. The rest of Erfana still works.')
      ).not.toBeInTheDocument()
    })

    it('puts focus back on Reload after a failed retry', async () => {
      // The failed retry rebuilds the fallback subtree, which drops focus to
      // <body>; without the restore a keyboard user has to tab in from the top.
      const user = userEvent.setup()

      render(
        <PanelErrorBoundary componentName="Project tree">
          <Boom />
        </PanelErrorBoundary>
      )

      await user.click(screen.getByRole('button', { name: RELOAD_TREE }))

      expect(screen.getByRole('button', { name: RELOAD_TREE })).toHaveFocus()
    })

    it('carries the failed-retry outcome on the button focus lands on', async () => {
      const user = userEvent.setup()

      render(
        <PanelErrorBoundary componentName="Project tree">
          <Boom />
        </PanelErrorBoundary>
      )

      await user.click(screen.getByRole('button', { name: RELOAD_TREE }))

      const reload = screen.getByRole('button', { name: RELOAD_TREE })
      expect(reload).toHaveFocus()
      // The deliberate focus move is the announcement: name plus description,
      // so "still unavailable" is heard rather than an unchanged "Reload".
      expect(reload).toHaveAccessibleDescription('Project tree is still unavailable.')
      // And it is the ONLY announcement — no live region re-reads the same copy.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('parks focus on the recovered panel after a successful reload', async () => {
      const user = userEvent.setup()

      render(
        <PanelErrorBoundary componentName="Project tree">
          <ControlledPanel />
        </PanelErrorBoundary>
      )

      panelControl.shouldThrow = false
      await user.click(screen.getByRole('button', { name: RELOAD_TREE }))

      // The button the user was standing on no longer exists; without this the
      // next Tab would start from the top of the window.
      const content = screen.getByTestId('tree-content').parentElement
      expect(content).toHaveAttribute('tabindex', '-1')
      expect(content).toHaveFocus()
    })

    it('restores focus to Reload when the panel dies with focus inside it', async () => {
      // No Reload was pressed, so the attempt counter proves nothing here —
      // this is the async re-throw shape, where the only signal is that focus
      // was inside the boundary when the subtree was torn down.
      const user = userEvent.setup()

      render(
        <PanelErrorBoundary componentName="Project tree">
          <CrashesWhileFocused />
        </PanelErrorBoundary>
      )

      await user.click(screen.getByTestId('tree-button'))

      expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: RELOAD_TREE })).toHaveFocus()
    })

    it('does not steal focus when the panel throws without a Reload', () => {
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      outside.focus()

      try {
        const { rerender } = render(
          <PanelErrorBoundary componentName="Project tree">
            <div data-testid="tree-content">tree</div>
          </PanelErrorBoundary>
        )

        rerender(
          <PanelErrorBoundary componentName="Project tree">
            <Boom />
          </PanelErrorBoundary>
        )

        expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeInTheDocument()
        expect(outside).toHaveFocus()
      } finally {
        outside.remove()
      }
    })
  })

  describe('mount-site key contract', () => {
    it('clears the error state when the keyed project changes', () => {
      // Mirrors `<PanelErrorBoundary key={projectPath ?? 'none'} …>` in
      // ProjectPanel: opening another project must not inherit project A's
      // stuck fallback, and Reload is not the user's job here.
      const { rerender } = render(
        <PanelErrorBoundary key="/project-a" componentName="Project tree">
          <ControlledPanel />
        </PanelErrorBoundary>
      )

      expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeInTheDocument()

      panelControl.shouldThrow = false
      rerender(
        <PanelErrorBoundary key="/project-b" componentName="Project tree">
          <ControlledPanel />
        </PanelErrorBoundary>
      )

      expect(screen.getByTestId('tree-content')).toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).not.toBeInTheDocument()
    })
  })
})

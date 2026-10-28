// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DialogContext tests for the unsaved-changes prompt (issue #124, part 3 §3.6).
 *
 * Split from `DialogContext.test.tsx`, which was already over the 500-line cap
 * (split policy, docs/windows/contributing.md, rule 2): these tests cover a new
 * code path – `showUnsavedChanges`, its cancel-on-unmount rule (RX2-5) and
 * `useOptionalDialog`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { DialogProvider, useDialog, useOptionalDialog } from './DialogContext'
import { DialogManager } from './DialogManager'
import type { UnsavedChangesDialogResult } from './types'

beforeEach(() => {
  const portalRoot = document.createElement('div')
  portalRoot.setAttribute('id', 'portal-root')
  document.body.appendChild(portalRoot)
})

afterEach(() => {
  document.getElementById('portal-root')?.remove()
})

describe('Unsaved-changes prompt (issue #124)', () => {
  /** Opens the prompt and exposes its answer once it settles. */
  function UnsavedHarness(): JSX.Element {
    const { showUnsavedChanges } = useDialog()
    const [answer, setAnswer] = React.useState<UnsavedChangesDialogResult | null>(null)
    return (
      <div>
        <button
          onClick={async () =>
            setAnswer(await showUnsavedChanges({ fileName: 'pricing.html', variant: 'save' }))
          }
        >
          Ask
        </button>
        {answer && <div data-testid="answer">{answer}</div>}
      </div>
    )
  }

  it('resolves with the button the user chose', async () => {
    const user = userEvent.setup()
    render(
      <DialogProvider>
        <UnsavedHarness />
        <DialogManager />
      </DialogProvider>
    )

    await user.click(screen.getByText('Ask'))
    await user.click(await screen.findByRole('button', { name: "Don't save" }))

    await waitFor(() => expect(screen.getByTestId('answer')).toHaveTextContent('discard'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('resolves cancel on Escape', async () => {
    const user = userEvent.setup()
    render(
      <DialogProvider>
        <UnsavedHarness />
        <DialogManager />
      </DialogProvider>
    )

    await user.click(screen.getByText('Ask'))
    await screen.findByRole('dialog', { name: 'Save changes to pricing.html?' })
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.getByTestId('answer')).toHaveTextContent('cancel'))
  })

  it('resolves an open prompt as cancel when the provider unmounts (RX2-5)', async () => {
    let ask: (() => Promise<UnsavedChangesDialogResult>) | null = null
    function Capture(): null {
      const { showUnsavedChanges } = useDialog()
      ask = () => showUnsavedChanges({ fileName: 'pricing.html', variant: 'save' })
      return null
    }
    const view = render(
      <DialogProvider>
        <Capture />
        <DialogManager />
      </DialogProvider>
    )

    let answer: Promise<UnsavedChangesDialogResult> | null = null
    React.act(() => {
      answer = ask!()
    })
    await screen.findByRole('dialog')

    view.unmount()

    await expect(answer).resolves.toBe('cancel')
  })

  it('useOptionalDialog is undefined outside a provider and the context inside one', () => {
    const seen: Array<ReturnType<typeof useOptionalDialog>> = []
    function Probe(): null {
      seen.push(useOptionalDialog())
      return null
    }

    render(<Probe />)
    render(
      <DialogProvider>
        <Probe />
      </DialogProvider>
    )

    expect(seen[0]).toBeUndefined()
    expect(typeof seen[seen.length - 1]?.showUnsavedChanges).toBe('function')
  })
})

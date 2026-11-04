// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WatchStoppedNotice, WATCH_STOPPED_COPY, WATCH_STOPPED_TEST_IDS } from './WatchStoppedNotice'

describe('WatchStoppedNotice (#464)', () => {
  it('says auto-refresh stopped for the file, as an alert', () => {
    render(<WatchStoppedNotice fileName="notes.md" onReload={vi.fn()} />)

    const notice = screen.getByTestId(WATCH_STOPPED_TEST_IDS.notice)
    expect(notice).toHaveAttribute('role', 'alert')
    expect(notice).toHaveTextContent(`${WATCH_STOPPED_COPY.title} for notes.md`)
    expect(notice).toHaveTextContent(WATCH_STOPPED_COPY.subtitle)
  })

  it('Reload calls onReload with no arguments (never the click event)', async () => {
    const onReload = vi.fn()
    render(<WatchStoppedNotice fileName="notes.md" onReload={onReload} />)

    await userEvent.click(screen.getByRole('button', { name: WATCH_STOPPED_COPY.reload }))

    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onReload).toHaveBeenCalledWith()
  })
})

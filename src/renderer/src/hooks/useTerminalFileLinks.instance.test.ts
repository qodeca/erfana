// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Which xterm instance the file-link provider registers on. The hook mirrors
 * the caller's ref into state, re-read when the terminal id changes (plan
 * item 19), so these pin the lifecycle TerminalPanel drives: ref set, then id
 * reported; on teardown both cleared; then a new instance with a new id.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'

vi.mock('../services/fileGateway', () => ({ fileGateway: { findByName: vi.fn(), validatePath: vi.fn() } }))
vi.mock('../services/terminalGateway', () => ({
  terminalGateway: { getInfo: vi.fn(async () => ({ success: true, info: { cwd: '/project' } })) }
}))
vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { useTerminalFileLinks } from './useTerminalFileLinks'

function makeTerminal() {
  const dispose = vi.fn()
  const terminal = { registerLinkProvider: vi.fn(() => ({ dispose })) } as unknown as Terminal
  return { terminal, dispose }
}

// Stable callbacks, so the provider memo only moves when the terminal does
const onFileOpen = vi.fn()
const onError = vi.fn()
const NO_FILES: never[] = []

describe('useTerminalFileLinks – terminal instance', () => {
  it('registers on the instance once its id is reported, and once only', async () => {
    const ref: { current: Terminal | null } = { current: null }
    const { result, rerender } = renderHook(
      ({ terminalId }) =>
        useTerminalFileLinks({ terminalRef: ref, terminalId, projectRoot: '/project', files: NO_FILES, onFileOpen, onError }),
      { initialProps: { terminalId: null as string | null } }
    )
    expect(result.current.isReady).toBe(false)

    const first = makeTerminal()
    ref.current = first.terminal
    rerender({ terminalId: 't1' })

    await waitFor(() => expect(result.current.isReady).toBe(true))
    rerender({ terminalId: 't1' })
    expect(first.terminal.registerLinkProvider).toHaveBeenCalledTimes(1)
  })

  it('finds an instance that appears just after its id, through the short poll', async () => {
    const ref: { current: Terminal | null } = { current: null }
    const { result } = renderHook(() =>
      useTerminalFileLinks({ terminalRef: ref, terminalId: 't1', projectRoot: '/project', files: NO_FILES, onFileOpen, onError })
    )
    const late = makeTerminal()
    ref.current = late.terminal

    await waitFor(() => expect(result.current.isReady).toBe(true))
    expect(late.terminal.registerLinkProvider).toHaveBeenCalledTimes(1)
  })

  it('moves to the new instance across a restart and disposes the old registration', async () => {
    const ref: { current: Terminal | null } = { current: null }
    const first = makeTerminal()
    ref.current = first.terminal
    const { result, rerender } = renderHook(
      ({ terminalId }) =>
        useTerminalFileLinks({ terminalRef: ref, terminalId, projectRoot: '/project', files: NO_FILES, onFileOpen, onError }),
      { initialProps: { terminalId: 't1' as string | null } }
    )
    await waitFor(() => expect(result.current.isReady).toBe(true))

    // Teardown: TerminalPanel clears the ref and the id together
    ref.current = null
    rerender({ terminalId: null })
    await waitFor(() => expect(result.current.isReady).toBe(false))
    expect(first.dispose).toHaveBeenCalledTimes(1)

    const second = makeTerminal()
    ref.current = second.terminal
    rerender({ terminalId: 't2' })
    await waitFor(() => expect(result.current.isReady).toBe(true))
    expect(second.terminal.registerLinkProvider).toHaveBeenCalledTimes(1)
  })
})

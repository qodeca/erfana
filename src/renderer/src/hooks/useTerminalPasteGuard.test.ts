// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalPasteGuard } from './useTerminalPasteGuard'

const state = vi.hoisted(() => ({
  bridge: true,
  pageWritten: false,
  dialog: null as null | { showConfirm: ReturnType<typeof vi.fn> }
}))

vi.mock('../services/browserTabGateway', () => ({
  hasBrowserTabBridge: () => state.bridge,
  browserTabGateway: { pageClipboard: vi.fn(async () => ({ pageWritten: state.pageWritten })) }
}))
vi.mock('../components/Dialog/DialogContext', () => ({ useOptionalDialog: () => state.dialog }))

describe('useTerminalPasteGuard (S-17)', () => {
  beforeEach(() => {
    state.bridge = true
    state.pageWritten = false
    state.dialog = null
  })

  it('lets text with no line break or control character through without asking', async () => {
    state.pageWritten = true
    state.dialog = { showConfirm: vi.fn(async () => false) }
    const { result } = renderHook(() => useTerminalPasteGuard())
    await expect(result.current('npm test', 'paste')).resolves.toBe(true)
    expect(state.dialog.showConfirm).not.toHaveBeenCalled()
  })

  it('asks before pasting page-written text with a line break, and follows the answer', async () => {
    state.pageWritten = true
    state.dialog = { showConfirm: vi.fn(async () => true) }
    const { result } = renderHook(() => useTerminalPasteGuard())
    await expect(result.current('rm -rf ~\n', 'paste')).resolves.toBe(true)
    expect(state.dialog.showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Paste text a web page copied?' }))
    state.dialog.showConfirm.mockResolvedValueOnce(false)
    await expect(result.current('rm -rf ~\n', 'paste')).resolves.toBe(false)
  })

  it('pastes clipboard text no page wrote without asking, and treats no bridge as no page', async () => {
    state.dialog = { showConfirm: vi.fn(async () => false) }
    const { result } = renderHook(() => useTerminalPasteGuard())
    await expect(result.current('a\nb', 'paste')).resolves.toBe(true)
    state.bridge = false
    state.pageWritten = true
    await expect(result.current('a\nb', 'paste')).resolves.toBe(true)
    expect(state.dialog.showConfirm).not.toHaveBeenCalled()
  })

  it('never types text that needs asking when there is no dialog system', async () => {
    const { result } = renderHook(() => useTerminalPasteGuard())
    await expect(result.current('one\ntwo', 'externalDrop')).resolves.toBe(false)
  })

  it('keeps one guard across renders and uses the newest dialog', async () => {
    const first = { showConfirm: vi.fn(async () => false) }
    state.dialog = first
    const { result, rerender } = renderHook(() => useTerminalPasteGuard())
    const guard = result.current
    const second = { showConfirm: vi.fn(async () => true) }
    state.dialog = second
    rerender()
    expect(result.current).toBe(guard)
    await expect(result.current('x\ny', 'externalDrop')).resolves.toBe(true)
    expect(second.showConfirm).toHaveBeenCalled()
    expect(first.showConfirm).not.toHaveBeenCalled()
  })
})

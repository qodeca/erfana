// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for prepareProjectTransition: hold, flush, prompt, settle.
 *
 * Uses the real editor save registry and project store; only the logger and
 * the terminal store are stood in for.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { prepareProjectTransition, type ConfirmFn } from './switchHelpers'
import { editorSaveRegistry } from '../../services/editorSaveRegistry'
import { noteProjectGeneration } from '../../services/projectGeneration'
import { useProjectStore } from '../../stores/useProjectStore'

vi.mock('../../utils/logger', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

const terminal = vi.hoisted(() => ({ busy: false }))
vi.mock('../../stores/useTerminalStore', () => ({
  useTerminalStore: {
    getState: () => ({
      hasUserInteracted: () => terminal.busy,
      isRecentlyActive: () => terminal.busy
    })
  }
}))

interface FakeTab {
  save: Mock
  release: Mock
  hold: Mock
}

/** Register a dirty tab; a successful save cleans it, as the real panel does. */
function registerTab(id: string, options: { saves?: boolean; conflict?: boolean } = {}): FakeTab {
  const { saves = true, conflict = false } = options
  const release = vi.fn()
  const hold = vi.fn(() => release)
  const save = vi.fn(async () => {
    if (saves) useProjectStore.getState().setEditorDirty(id, false)
    return saves
  })
  editorSaveRegistry.register(id, { save, hasConflict: () => conflict, holdAutosave: hold })
  useProjectStore.getState().setEditorDirty(id, true)
  return { save, release, hold }
}

describe('prepareProjectTransition', () => {
  let confirm: Mock & ConfirmFn
  let generation = 100

  beforeEach(() => {
    terminal.busy = false
    confirm = vi.fn().mockResolvedValue(true) as typeof confirm
    generation += 10
    noteProjectGeneration(generation)
  })

  afterEach(() => {
    editorSaveRegistry.reset()
    useProjectStore.setState({ dirtyPanelIds: new Set<string>(), isProjectChanging: false })
  })

  it('saves dirty tabs and goes ahead without a prompt', async () => {
    const tab = registerTab('editor-a')

    const transition = await prepareProjectTransition('switch', confirm)

    expect(tab.save).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
    expect(transition.proceed).toBe(true)
  })

  it('keeps the UI locked from the flush to settle when no prompt shows (no flicker)', async () => {
    registerTab('editor-a')
    const seen: boolean[] = []
    const unsubscribe = useProjectStore.subscribe((state) => seen.push(state.isProjectChanging))

    const transition = await prepareProjectTransition('switch', confirm)
    expect(useProjectStore.getState().isProjectChanging).toBe(true)
    expect(useProjectStore.getState().projectChangingMessage).toBe('Saving open tabs…')

    transition.settle(false)
    unsubscribe()

    expect(useProjectStore.getState().isProjectChanging).toBe(false)
    // never unlocked and locked again in between
    expect(seen.join()).not.toContain('false,true')
  })

  it('locks again after a confirmed prompt and unlocks on settle', async () => {
    registerTab('editor-a', { conflict: true })

    const transition = await prepareProjectTransition('switch', confirm)
    expect(useProjectStore.getState().isProjectChanging).toBe(true)

    noteProjectGeneration(generation + 1)
    transition.settle(true)
    expect(useProjectStore.getState().isProjectChanging).toBe(false)
  })

  it('an answer of "did not change" releases the hold even when an event was seen', async () => {
    const tab = registerTab('editor-a')
    const transition = await prepareProjectTransition('switch', confirm)

    noteProjectGeneration(generation + 1)
    transition.settle(false)

    expect(tab.release).toHaveBeenCalledTimes(1)
  })

  it('an answer of "changed" with no project:changed event releases the hold', async () => {
    const tab = registerTab('editor-a')
    const transition = await prepareProjectTransition('switch', confirm)

    transition.settle(true)

    expect(tab.release).toHaveBeenCalledTimes(1)
  })

  it('an answer of "changed" with an event keeps the hold', async () => {
    const tab = registerTab('editor-a')
    const transition = await prepareProjectTransition('switch', confirm)

    noteProjectGeneration(generation + 1)
    transition.settle(true)

    expect(tab.release).not.toHaveBeenCalled()
  })

  it('counts a tab that is dirty again after its save in the prompt', async () => {
    const tab = registerTab('editor-a')
    tab.save.mockImplementation(async () => true) // "saved", yet the store still says dirty

    await prepareProjectTransition('switch', confirm)

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: '1 tab could not be saved. Discard and switch project?' })
    )
  })

  it('holds autosave while it works and keeps the hold once the project changed', async () => {
    const tab = registerTab('editor-a')

    const transition = await prepareProjectTransition('switch', confirm)
    expect(tab.hold).toHaveBeenCalledTimes(1)

    noteProjectGeneration(generation + 1)
    transition.settle()

    expect(tab.release).not.toHaveBeenCalled()
  })

  it('re-arms autosave when the project did not change (no-op or failed open)', async () => {
    const tab = registerTab('editor-a')

    const transition = await prepareProjectTransition('switch', confirm)
    transition.settle()
    transition.settle()

    expect(tab.release).toHaveBeenCalledTimes(1)
  })

  it('locks the UI during the flush and lifts the lock before the prompt', async () => {
    registerTab('editor-a', { saves: false })
    let lockedDuringSave = false
    let lockedDuringPrompt = true
    const tab = registerTab('editor-b')
    tab.save.mockImplementation(async () => {
      lockedDuringSave = useProjectStore.getState().isProjectChanging
      useProjectStore.getState().setEditorDirty('editor-b', false)
      return true
    })
    confirm.mockImplementation(async () => {
      lockedDuringPrompt = useProjectStore.getState().isProjectChanging
      return true
    })

    await prepareProjectTransition('switch', confirm)

    expect(lockedDuringSave).toBe(true)
    expect(lockedDuringPrompt).toBe(false)
  })

  it('prompts with the count of tabs that could not be saved', async () => {
    registerTab('editor-a', { saves: false })
    registerTab('editor-b', { conflict: true })
    registerTab('editor-c')

    await prepareProjectTransition('switch', confirm)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '2 tabs could not be saved. Discard and switch project?',
        danger: true
      })
    )
  })

  it('never saves a conflicted tab', async () => {
    const tab = registerTab('editor-a', { conflict: true })

    await prepareProjectTransition('close', confirm)

    expect(tab.save).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: '1 tab could not be saved. Discard and close project?' })
    )
  })

  it('cancel ends the transition and re-arms autosave', async () => {
    const tab = registerTab('editor-a', { conflict: true })
    confirm.mockResolvedValue(false)

    const transition = await prepareProjectTransition('switch', confirm)

    expect(transition.proceed).toBe(false)
    expect(tab.release).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().isProjectChanging).toBe(false)
  })

  it('confirming discard keeps the hold, so no late write can follow', async () => {
    const tab = registerTab('editor-a', { conflict: true })

    const transition = await prepareProjectTransition('switch', confirm)
    expect(transition.proceed).toBe(true)

    noteProjectGeneration(generation + 1)
    transition.settle()
    expect(tab.release).not.toHaveBeenCalled()
  })

  it('reports a busy terminal when nothing is unsaved', async () => {
    terminal.busy = true

    const transition = await prepareProjectTransition('switch', confirm)

    expect(transition.terminalBusy).toBe(true)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Active Terminal Session' }))
  })

  it('unlocks, re-arms and rethrows when the flush itself throws', async () => {
    const tab = registerTab('editor-a')
    const spy = vi.spyOn(editorSaveRegistry, 'flushAll').mockRejectedValue(new Error('boom'))

    await expect(prepareProjectTransition('switch', confirm)).rejects.toThrow('boom')

    expect(tab.release).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().isProjectChanging).toBe(false)
    spy.mockRestore()
  })
})

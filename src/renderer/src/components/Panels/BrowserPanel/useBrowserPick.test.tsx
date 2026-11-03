// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DockviewApi } from 'dockview'

const gateway = vi.hoisted(() => ({
  pickMode: vi.fn(),
  closePick: vi.fn(),
  refine: vi.fn(),
  pickSurface: vi.fn(),
  writeCapture: vi.fn(),
  discardCaptureFiles: vi.fn()
}))
const still = vi.hoisted(() => ({ release: vi.fn() }))
const send = vi.hoisted(() => ({ sendCapture: vi.fn() }))
const toasts = vi.hoisted(() => ({ showErrorToast: vi.fn(), showInfoToast: vi.fn() }))
const files = vi.hoisted(() => ({ openFileInPanel: vi.fn() }))
const prompts = vi.hoisted(() => ({ executePromptTemplate: vi.fn() }))
const activity = vi.hoisted(() => ({ setActivePanel: vi.fn() }))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../services/browser/browserStill', () => ({ browserStill: still, PICK_STILL_HOLDER: 'pick' }))
vi.mock('./browserSend', async importOriginal => ({ ...(await importOriginal<typeof import('./browserSend')>()), sendCapture: send.sendCapture }))
vi.mock('../../../utils/toastHelpers', () => toasts)
vi.mock('../../../utils/openFileInPanel', () => files)
vi.mock('../../../utils/panelUtils', () => prompts)
vi.mock('../../../stores/useActivityBarStore', () => ({ useActivityBarStore: { getState: () => activity } }))
vi.mock('../../../utils/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { IDLE_PICK, useBrowserPickStore, type PickSummary } from '../../../stores/useBrowserPickStore'
import type { PickEvent } from '../../../../../shared/ipc/browser-tab-schema'
import { targetView, type TargetStatus } from './pickRow.logic'
import { useBrowserPick, type UseBrowserPickOptions } from './useBrowserPick'
import type { BrowserTarget } from './useBrowserTarget'

const TAB = 'browser-tab-1'
const CAPTURE = 'a'.repeat(32)
const SUMMARY: PickSummary = {
  name: 'button.cta',
  size: '176 × 32',
  ancestors: ['html', 'body', 'button.cta'],
  box: { x: 10, y: 20, width: 176, height: 32 },
  atTop: false,
  atStart: true,
  gone: false,
  changedAfterPick: false
}
const CAPTURED: PickEvent = { tabId: TAB, kind: 'captured', captureId: CAPTURE, still: new Uint8Array(4), stillWidth: 1, stillHeight: 1, summary: SUMMARY }

function makeTarget(status: TargetStatus = { kind: 'agent', process: 'claude' }, name: string | null = 'Terminal'): BrowserTarget {
  return { terminalId: name === null ? null : 'terminal-1', terminalName: name, status, view: targetView(name, status), refresh: vi.fn() }
}

let project = 0
function setup(overrides: Partial<UseBrowserPickOptions> = {}) {
  const focusPage = vi.fn()
  const options: UseBrowserPickOptions = {
    tabId: TAB,
    live: true,
    target: makeTarget(),
    containerApi: {} as DockviewApi,
    projectPath: `/projects/p${++project}`,
    focusPage,
    openTargetMenu: vi.fn(),
    startTerminal: vi.fn(),
    ...overrides
  }
  const view = renderHook((props: UseBrowserPickOptions) => useBrowserPick(props), { initialProps: options })
  return { ...view, options, focusPage }
}

const capture = (): void => act(() => useBrowserPickStore.getState().apply(CAPTURED))
const pickTab = () => useBrowserPickStore.getState().byTab.get(TAB) ?? IDLE_PICK
const flush = async (): Promise<void> => {
  await act(async () => undefined)
}

describe('useBrowserPick', () => {
  beforeEach(() => {
    for (const fn of Object.values(gateway)) fn.mockReset().mockResolvedValue(undefined)
    for (const fn of [still.release, send.sendCapture, toasts.showErrorToast, toasts.showInfoToast, files.openFileInPanel, activity.setActivePanel]) fn.mockReset()
  })
  afterEach(() => {
    useBrowserPickStore.getState().forget(TAB)
  })

  it('refuses Pick element without a live page with the load-a-page note', () => {
    const { result } = setup({ live: false })
    act(() => result.current.togglePick())
    expect(gateway.pickMode).not.toHaveBeenCalled()
    expect(pickTab().note).toBe('loadAPage')
  })

  it('toggles pick mode, and with a capture held closes it as the toolbar', () => {
    const { result } = setup()
    act(() => result.current.togglePick())
    expect(gateway.pickMode).toHaveBeenCalledWith(TAB, true)
    capture()
    expect(result.current.surface).toBe('panel')
    act(() => result.current.togglePick())
    expect(gateway.closePick).toHaveBeenCalledWith({ tabId: TAB, captureId: CAPTURE, reason: 'toolbar' })
    expect(result.current.surface).toBe('none')
    expect(still.release).toHaveBeenCalledWith(TAB, 'pick')
  })

  it('opens the panel with the pre-warning for a shell, and refreshes the target', () => {
    const target = makeTarget({ kind: 'shell', process: 'zsh' })
    const { result } = setup({ target })
    capture()
    expect(result.current.banner).toMatchObject({ kind: 'preWarnShell' })
    expect(target.refresh).toHaveBeenCalled()
  })

  it('closes on Esc, tells main and returns focus to the page', () => {
    const { result, focusPage } = setup()
    capture()
    act(() => result.current.close('esc'))
    expect(gateway.closePick).toHaveBeenCalledWith({ tabId: TAB, captureId: CAPTURE, reason: 'esc' })
    expect(focusPage).toHaveBeenCalledOnce()
    expect(pickTab().capture).toBeNull()
  })

  it('refines and switches between the panel and the dialog, keeping the typed text across dialog actions', () => {
    const { result } = setup()
    capture()
    act(() => result.current.refine('parent'))
    expect(gateway.refine).toHaveBeenCalledWith({ tabId: TAB, captureId: CAPTURE, move: 'parent' })
    act(() => result.current.openDialog('ask'))
    expect(gateway.pickSurface).toHaveBeenCalledWith(TAB, CAPTURE, 'dialog')
    expect(result.current).toMatchObject({ surface: 'dialog', dialogAction: 'ask', returnAction: 'ask' })
    act(() => result.current.setDraft('why?'))
    expect(result.current.draft).toBe('why?')
    act(() => result.current.back())
    expect(gateway.pickSurface).toHaveBeenLastCalledWith(TAB, CAPTURE, 'menu')
    expect(result.current.surface).toBe('panel')
    act(() => result.current.openDialog('ask'))
    expect(result.current.draft).toBe('why?')
    // The text follows the reviewer to another dialog action (M-25, 025-AC-064).
    act(() => result.current.back())
    act(() => result.current.openDialog('change'))
    expect(result.current).toMatchObject({ dialogAction: 'change', draft: 'why?' })
  })

  it('keeps the typed text when a hidden tab closes the dialog, and drops it on Cancel (025-FR-052)', () => {
    const { result } = setup()
    capture()
    act(() => result.current.openDialog('change'))
    act(() => result.current.setDraft('label cut off'))
    act(() => result.current.close('tabHidden'))
    expect(gateway.closePick).toHaveBeenCalledWith({ tabId: TAB, captureId: CAPTURE, reason: 'tabHidden' })
    expect(result.current.surface).toBe('none')
    capture()
    act(() => result.current.openDialog('ask'))
    expect(result.current.draft).toBe('label cut off')
    act(() => result.current.close('cancel'))
    capture()
    act(() => result.current.openDialog('ask'))
    expect(result.current.draft).toBe('')
  })

  it('closes the panel on a page change with a note, but keeps the dialog (025-FR-053)', () => {
    const { result } = setup()
    capture()
    act(() => useBrowserPickStore.getState().apply({ tabId: TAB, kind: 'ended', reason: 'pageChanged' }))
    expect(gateway.closePick).toHaveBeenCalledWith({ tabId: TAB, captureId: CAPTURE, reason: 'cancel' })
    expect(pickTab()).toMatchObject({ capture: null, note: 'pageChanged' })
    expect(result.current.surface).toBe('none')

    capture()
    act(() => result.current.openDialog('change'))
    gateway.closePick.mockClear()
    act(() => useBrowserPickStore.getState().apply({ tabId: TAB, kind: 'ended', reason: 'pageChanged' }))
    expect(result.current.surface).toBe('dialog')
    expect(gateway.closePick).not.toHaveBeenCalled()
  })

  it('sends, shows the notice and the deny-rule offer once per project', async () => {
    send.sendCapture.mockResolvedValue({ kind: 'sent', contextPath: '.erfana/browser/captures/c.md' })
    const { result, focusPage, options } = setup()
    capture()
    act(() => result.current.send('explain'))
    expect(result.current.busy).toBe('explain')
    await flush()
    expect(send.sendCapture.mock.calls[0][1]).toMatchObject({ tabId: TAB, captureId: CAPTURE, terminalId: 'terminal-1', action: 'explain', instruction: '', sendAnyway: false })
    expect(result.current).toMatchObject({ busy: null, surface: 'none', lastCapture: '.erfana/browser/captures/c.md' })
    expect(result.current.notice).toEqual({ text: 'Sent Explain to Terminal', contextPath: '.erfana/browser/captures/c.md' })
    expect(focusPage).toHaveBeenCalled()
    expect(toasts.showInfoToast).toHaveBeenCalledOnce()
    act(() => result.current.dismissNotice())
    expect(result.current.notice).toBeNull()

    capture()
    act(() => result.current.send('explain'))
    await flush()
    expect(toasts.showInfoToast).toHaveBeenCalledOnce()
    expect(options.projectPath).toMatch(/^\/projects\//)
  })

  it('passes the deps through to main and the prompt template', async () => {
    send.sendCapture.mockResolvedValue({ kind: 'failed', reason: 'x' })
    const { result } = setup()
    capture()
    act(() => result.current.send('explain'))
    await flush()
    const deps = send.sendCapture.mock.calls[0][0]
    await deps.writeCapture({ captureId: CAPTURE, terminalId: 'terminal-1' })
    expect(gateway.writeCapture).toHaveBeenCalledWith({ captureId: CAPTURE, terminalId: 'terminal-1', tabId: TAB })
    await deps.discardCaptureFiles(TAB, CAPTURE)
    expect(gateway.discardCaptureFiles).toHaveBeenCalledWith(TAB, CAPTURE)
    await deps.closeSent(TAB, CAPTURE)
    expect(gateway.closePick).toHaveBeenCalledWith({ tabId: TAB, captureId: CAPTURE, reason: 'sent' })
    deps.executePrompt('browser-explain', { contextRef: 'c' }, 'terminal-1')
    expect(prompts.executePromptTemplate).toHaveBeenCalledWith('browser-explain', { contextRef: 'c' }, {
      terminalId: 'terminal-1',
      openPanel: false,
      reveal: 'withoutFocus',
      showToast: false
    })
  })

  it('swaps in a guard banner, sends anyway on its answer, and keeps the panel after a failure', async () => {
    send.sendCapture.mockResolvedValueOnce({ kind: 'guard', guard: { kind: 'wrapper', process: 'npx' } })
    const { result } = setup()
    capture()
    act(() => result.current.send('explain'))
    await flush()
    expect(result.current.banner).toMatchObject({ kind: 'sendAnyway', text: 'Terminal is running npx – it may not be your agent. Send anyway?' })
    send.sendCapture.mockResolvedValueOnce({ kind: 'failed', reason: 'The terminal closed' })
    act(() => result.current.bannerAction('sendAnyway'))
    await flush()
    expect(send.sendCapture.mock.calls[1][1]).toMatchObject({ sendAnyway: true, action: 'explain' })
    expect(toasts.showErrorToast).toHaveBeenCalledWith("Couldn't send to your agent", 'The terminal closed. Nothing was sent – choose Explain to try again.')
    expect(result.current.surface).toBe('panel')
  })

  it('sends a dialog action with its text, and keeps it after a failure', async () => {
    send.sendCapture.mockResolvedValue({ kind: 'failed', reason: 'Disk full' })
    const { result } = setup()
    capture()
    act(() => result.current.openDialog('change'))
    act(() => result.current.setDraft('Make it blue'))
    act(() => result.current.send('change'))
    await flush()
    expect(send.sendCapture.mock.calls[0][1]).toMatchObject({ action: 'change', instruction: 'Make it blue' })
    expect(toasts.showErrorToast.mock.calls[0][1]).toBe('Disk full. Nothing was sent, and your text is still in the dialog – press Send to try again.')
    expect(result.current).toMatchObject({ surface: 'dialog', draft: 'Make it blue' })
  })

  it('answers the banner buttons: Open terminal shows the panel and starts a new terminal, Choose terminal opens the terminal menu, a choice there rewrites the banner', () => {
    const target = makeTarget({ kind: 'shell', process: 'zsh' })
    const { result, rerender, options } = setup({ target })
    capture()
    act(() => result.current.bannerAction('openTerminal'))
    expect(activity.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
    expect(options.startTerminal).toHaveBeenCalledOnce()
    expect(options.openTargetMenu).not.toHaveBeenCalled()
    expect(result.current.surface).toBe('panel')
    act(() => result.current.bannerAction('chooseTerminal'))
    expect(options.openTargetMenu).toHaveBeenCalledOnce()
    expect(options.startTerminal).toHaveBeenCalledOnce()
    // The menu is open, nothing chosen yet: the pre-warning stays.
    expect(result.current.banner).toMatchObject({ kind: 'preWarnShell' })
    act(() => result.current.targetChosenAgain())
    expect(result.current.banner).toMatchObject({ kind: 'guardShell' })
    const agent = makeTarget()
    rerender({ ...options, target: agent })
    act(() => result.current.targetChosenAgain())
    expect(agent.refresh).toHaveBeenCalled()
    expect(result.current.banner).toEqual({ kind: 'targetChosen', text: 'Sends to → Terminal · claude – send again when ready.', action: null })
  })

  it('opens a capture under the project root, and says so when the editor is not ready', () => {
    files.openFileInPanel.mockReturnValueOnce({}).mockReturnValueOnce(undefined)
    const { result } = setup({ projectPath: '/projects/site/' })
    act(() => result.current.openCapture('.erfana/browser/captures/c.md'))
    expect(files.openFileInPanel).toHaveBeenCalledWith({}, '/projects/site/.erfana/browser/captures/c.md')
    act(() => result.current.openCapture('.erfana/browser/captures/c.md'))
    expect(toasts.showErrorToast).toHaveBeenCalledWith("Couldn't open the capture", 'The editor is not ready.')
  })

  it('joins a Windows project root with its own separator, and does nothing without a project', () => {
    files.openFileInPanel.mockReturnValue({})
    const { result, rerender, options } = setup({ projectPath: 'C:\\work\\site' })
    act(() => result.current.openCapture('.erfana/browser/captures/c.md'))
    expect(files.openFileInPanel).toHaveBeenCalledWith({}, 'C:\\work\\site\\.erfana\\browser\\captures\\c.md')
    rerender({ ...options, projectPath: null })
    act(() => result.current.openCapture('x.md'))
    expect(files.openFileInPanel).toHaveBeenCalledOnce()
  })

  it('shows the terminal without moving focus, and does nothing without a tab', () => {
    const { result } = setup({ tabId: null })
    act(() => result.current.showTerminal())
    expect(activity.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
    act(() => result.current.togglePick())
    act(() => result.current.close('esc'))
    expect(gateway.pickMode).not.toHaveBeenCalled()
    expect(gateway.closePick).not.toHaveBeenCalled()
  })
})

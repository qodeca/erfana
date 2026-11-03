// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi, type Mock } from 'vitest'
import { BrowserCapture } from '../capture/BrowserCapture'
import { chain, entry, facts, hints, moment } from '../capture/__test-helpers__/captureFixtures'
import { PickReader } from './pickCdp'
import { PickFrames } from './pickFrames'
import { closeEvent, refineHeld, type RefineHeldDeps } from './pickMenu'
import { samplePage } from './__test-helpers__/samplePage'

const top = (id: number) => ({ sessionKey: '', backendNodeId: id, frameId: 'top' })

function setup(liveBox = { x: 20, y: 20, width: 100, height: 30 }) {
  const page = samplePage({ crossSite: false })
  const reader = new PickReader(page.cdp)
  const frames = new PickFrames(page.cdp, reader)
  const entries = [entry('div', { node: top(3) }), entry('button', { node: top(4), boxInView: { x: 20, y: 20, width: 100, height: 30 } }), entry('span', { node: top(5) })]
  const factsRead = vi.fn(async () => facts({ boxInView: liveBox }))
  const capture = new BrowserCapture('cid', moment(), chain(entries), { facts: factsRead, hints: async () => hints() })
  const deps: RefineHeldDeps & { refined: Mock<RefineHeldDeps['refined']>; note: Mock<RefineHeldDeps['note']> } = {
    reader,
    frames,
    isHeld: (c) => c === capture,
    refined: vi.fn<RefineHeldDeps['refined']>(),
    note: vi.fn<RefineHeldDeps['note']>()
  }
  return { page, capture, deps, factsRead }
}

describe('refineHeld', () => {
  it('moves along the snapshot chain and sends the new summary', async () => {
    const { capture, deps } = setup()
    await refineHeld(capture, 'parent', deps)
    expect(capture.entry.name.tagName).toBe('button')
    expect(deps.refined).toHaveBeenCalledTimes(1)
    expect(deps.refined).toHaveBeenCalledWith({ captureId: 'cid', summary: expect.objectContaining({ changedAfterPick: false }) })
  })

  it('notes a refused move', async () => {
    const { capture, deps } = setup()
    await refineHeld(capture, 'child', deps)
    expect(deps.note).toHaveBeenCalledWith('backAtStart')
    expect(deps.refined).not.toHaveBeenCalled()
  })

  it('sends the summary again with "changed after the pick" when the live box moved more than 1 px (S-34)', async () => {
    const { capture, deps } = setup({ x: 20, y: 40, width: 100, height: 30 })
    await refineHeld(capture, 'parent', deps)
    expect(deps.refined).toHaveBeenCalledTimes(2)
    expect(deps.refined.mock.calls[1][0].summary.changedAfterPick).toBe(true)
  })

  it('marks the capture gone when the picked element left a live page, and says so', async () => {
    const { page, capture, deps } = setup()
    page.disconnected.add(5)
    await refineHeld(capture, 'parent', deps)
    expect(capture.gone).toBe(true)
    expect(deps.note).toHaveBeenCalledWith('elementGone')
    expect(deps.refined).toHaveBeenCalledWith({ captureId: 'cid', summary: expect.objectContaining({ gone: true }) })
  })

  it('counts an element whose chain cannot be read, or that has no node, as gone', async () => {
    const broken = setup()
    broken.page.broken.add(5)
    await refineHeld(broken.capture, 'parent', broken.deps)
    expect(broken.capture.gone).toBe(true)
    const nodeless = setup()
    nodeless.capture.chain.entries[2].node = null
    await refineHeld(nodeless.capture, 'parent', nodeless.deps)
    expect(nodeless.capture.gone).toBe(true)
  })

  it('never reads a frozen page before the move (a page function on a paused page hangs, ADR 0008)', async () => {
    const { page, capture, deps } = setup()
    capture.frozen = true
    await refineHeld(capture, 'parent', deps)
    expect(page.cdp.calls('Runtime.callFunctionOn')).toEqual([])
    expect(capture.gone).toBe(false)
  })

  it('does nothing once another capture is held, and drops a stale facts read', async () => {
    const { capture, deps, factsRead } = setup({ x: 99, y: 99, width: 1, height: 1 })
    await refineHeld(capture, 'parent', { ...deps, isHeld: () => false })
    expect(deps.refined).not.toHaveBeenCalled()
    let release: () => void = () => undefined
    factsRead.mockImplementationOnce(() => new Promise((r) => (release = () => r(facts({ boxInView: { x: 99, y: 99, width: 1, height: 1 } })))))
    const first = refineHeld(capture, 'parent', deps)
    await vi.waitFor(() => expect(factsRead).toHaveBeenCalled())
    capture.move('child')
    release()
    await first
    expect(deps.refined.mock.calls.every((c) => c[0].summary.changedAfterPick === false)).toBe(true)
  })

  it('loses only the change note when the facts read fails', async () => {
    const { capture, deps, factsRead } = setup()
    factsRead.mockRejectedValue(new Error('page'))
    await expect(refineHeld(capture, 'parent', deps)).resolves.toBeUndefined()
    expect(deps.refined).toHaveBeenCalledTimes(1)
  })
})

describe('closeEvent', () => {
  it('maps each closePick reason to its routing event', () => {
    expect(closeEvent('sent', 'menu')).toEqual({ type: 'sent' })
    expect(closeEvent('tabHidden', 'menu')).toEqual({ type: 'endSilently' })
    expect(closeEvent('focusLeft', 'dialog')).toEqual({ type: 'focusOut' })
    expect(closeEvent('esc', 'dialog')).toEqual({ type: 'dialogClose' })
    expect(closeEvent('cancel', 'dialog')).toEqual({ type: 'dialogClose' })
    expect(closeEvent('esc', 'menu')).toEqual({ type: 'menuClose', reason: 'esc' })
    expect(closeEvent('clickOutside', 'menu')).toEqual({ type: 'menuClose', reason: 'esc' })
    expect(closeEvent('toolbar', 'menu')).toEqual({ type: 'menuClose', reason: 'toolbarClick' })
  })
})

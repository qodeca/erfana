// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { CROSSHAIR_CSS } from './pickModeSwitch'
import { STILL_MAX_EDGE_PX } from './BrowserTabPick'
import { pickHarness, settle, type PickHarness } from './__test-helpers__/pickHarness'
import { CHAIN_REST_MS } from './pickHover'
import { PICK_CHAIN } from '../cdp/cdpPickFunctions'
import { PAINT_WAIT_CAP_MS, PAINT_WAIT_SCRIPT, PAINT_WAIT_WORLD_ID } from './pickPainted'

/** Pick mode on, the pointer over the label, its highlight shown. */
async function hovering(h: PickHarness, x = 35, y = 30): Promise<void> {
  h.routing.dispatch({ type: 'pickButton' })
  await settle()
  h.contents.mouse('mouseMove', x, y)
  await settle()
}

async function confirmed(h: PickHarness, freeze = false): Promise<string> {
  await hovering(h)
  h.routing.dispatch(freeze ? { type: 'pickShortcut', now: h.clock.now() } : { type: 'enter', now: h.clock.now() })
  await settle()
  const captured = h.events.find((e) => e.kind === 'captured')
  if (captured?.kind !== 'captured') throw new Error(`no capture: ${JSON.stringify(h.events.map((e) => e.kind))}`)
  return captured.captureId
}

const kinds = (h: PickHarness): string[] => h.events.map((e) => e.kind)

describe('BrowserTabPick', () => {
  let h: PickHarness
  beforeEach(() => {
    h = pickHarness()
  })

  describe('pick mode on and off (025-FR-025)', () => {
    it('turns the engine side on with the routing: domains, focus emulation on every frame, crosshair', async () => {
      h.routing.dispatch({ type: 'pickButton' })
      await settle()
      expect(h.pick.isActive).toBe(true)
      expect(h.page.cdp.enabled).toBe(1)
      expect(h.page.cdp.calls('Emulation.setFocusEmulationEnabled').map((c) => c.sessionKey)).toEqual(['', 'S1'])
      expect(h.contents.css).toEqual([CROSSHAIR_CSS])
      h.routing.dispatch({ type: 'pickButton' })
      await settle()
      expect(h.pick.isActive).toBe(false)
      expect(h.page.cdp.disabled).toBe(1)
      expect(h.contents.removedCss).toEqual(['css-1'])
    })

    it('turns focus emulation on for a frame that attaches while pick mode is on', async () => {
      h.routing.dispatch({ type: 'pickButton' })
      await settle()
      h.page.addFrameTarget('S9', 'F9', 'top')
      h.page.cdp.emit('targetAttached', h.page.cdp.targets.at(-1)!)
      await settle()
      expect(h.page.cdp.calls('Emulation.setFocusEmulationEnabled').map((c) => c.sessionKey)).toContain('S9')
    })

    it('does not start on a detached session', async () => {
      h.page.cdp.attached = false
      h.pick.setMode(true)
      await settle()
      expect(h.pick.isActive).toBe(false)
    })

    it('ends silently when the debugger detaches', async () => {
      h.routing.dispatch({ type: 'pickButton' })
      await settle()
      h.page.cdp.emit('detached', { reason: 'other' } as never)
      await settle()
      expect(h.routing.dispatched.at(-1)).toEqual({ type: 'endSilently' })
      expect(h.pick.isActive).toBe(false)
    })
  })

  describe('a frame that goes while it holds the highlight (025-FR-029)', () => {
    it('ends the highlight and its label with no pointer move; pick mode stays on', async () => {
      await hovering(h, 415, 115)
      expect(h.pick.highlight.record?.node.sessionKey).toBe('S1')
      const frame = h.page.cdp.targets.find((t) => t.sessionKey === 'S1')!
      h.page.cdp.targets = h.page.cdp.targets.filter((t) => t !== frame)
      h.page.cdp.emit('targetDetached', frame)
      await settle()
      expect(h.pick.highlight.record).toBeNull()
      expect(h.events.at(-1)).toMatchObject({ kind: 'highlight', label: null })
      expect(h.routing.dispatched.at(-1)).toEqual({ type: 'hover', element: false })
      expect(h.pick.isActive).toBe(true)
    })

    it('keeps the highlight when another frame went, or the frame only changed process', async () => {
      await hovering(h)
      const before = h.pick.highlight.record
      h.page.cdp.emit('protocolEvent', { target: h.page.cdp.targets[0], method: 'Page.frameDetached', params: { frameId: 'other', reason: 'remove' } })
      h.page.cdp.emit('protocolEvent', { target: h.page.cdp.targets[0], method: 'Page.frameDetached', params: { frameId: 'top', reason: 'swap' } })
      await settle()
      expect(h.pick.highlight.record).toBe(before)
    })

    it('leaves a held capture alone', async () => {
      await confirmed(h)
      const count = h.events.length
      h.page.cdp.targets = h.page.cdp.targets.filter((t) => t.sessionKey !== 'S1')
      h.page.cdp.emit('protocolEvent', { target: h.page.cdp.targets[0], method: 'Page.frameDetached', params: { frameId: 'F1', reason: 'remove' } })
      await settle()
      expect(h.events.slice(count).filter((e) => e.kind === 'highlight')).toEqual([])
    })
  })

  describe('hover (025-FR-026)', () => {
    it('outlines the element under the pointer and sends its exact label', async () => {
      await hovering(h)
      expect(h.pick.highlight.record?.label).toBe('span#label 40 × 20')
      expect(h.events.at(-1)).toEqual({ tabId: 'tab-1', kind: 'highlight', label: 'span#label 40 × 20' })
      expect(h.state().highlighted).toBe(true)
      expect(h.bench.read('highlight')).toHaveLength(1)
    })

    it('hovers the last pointer position as pick mode starts', async () => {
      h.contents.mouse('mouseMove', 35, 30)
      h.routing.dispatch({ type: 'pickButton' })
      await settle()
      expect(h.pick.highlight.record?.node.backendNodeId).toBe(5)
    })

    it('hides the outline over nothing, and says so', async () => {
      await hovering(h)
      h.contents.mouse('mouseMove', 900, 900)
      await settle()
      expect(h.pick.highlight.record).toBeNull()
      expect(h.events.at(-1)).toMatchObject({ kind: 'highlight', label: null })
      expect(h.state().highlighted).toBe(false)
    })

    it('runs one hit test at a time and takes the latest position', async () => {
      await hovering(h)
      h.contents.mouse('mouseMove', 25, 22)
      h.contents.mouse('mouseMove', 15, 15)
      h.contents.mouse('mouseMove', 415, 115)
      await settle()
      expect(h.pick.highlight.record?.node).toEqual({ sessionKey: 'S1', backendNodeId: 102, frameId: 'F1' })
      expect(h.page.cdp.calls('DOM.getNodeForLocation').filter((c) => c.sessionKey === '').length).toBeLessThanOrEqual(4)
    })

    it('ignores moves while pick mode is off', async () => {
      h.contents.mouse('mouseMove', 35, 30)
      await settle()
      expect(h.page.cdp.calls('DOM.getNodeForLocation')).toEqual([])
    })
  })

  describe('Up and Down before a confirm (025-FR-027)', () => {
    it('walks the hovered chain and notes the ends', async () => {
      await hovering(h)
      h.pick.refine('child')
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'note', note: 'backAtStart' })
      h.pick.refine('parent')
      await settle()
      expect(h.pick.highlight.record?.label).toMatch(/^button#save /)
      for (let i = 0; i < 3; i++) h.pick.refine('parent')
      await settle()
      expect(h.pick.highlight.record?.label).toMatch(/^html /)
      h.pick.refine('parent')
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'note', note: 'topOfPage' })
      h.pick.refine('child')
      await settle()
      expect(h.pick.highlight.record?.label).toMatch(/^body /)
    })

    it('asks for a mouse move when nothing is hovered, and notes a chain that cannot be read', async () => {
      h.routing.dispatch({ type: 'pickButton' })
      await settle()
      h.pick.refine('parent')
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'note', note: 'moveTheMouse' })
      h.page.broken.add(5)
      h.contents.mouse('mouseMove', 35, 30)
      await settle()
      h.pick.refine('parent')
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'note', note: 'elementGone' })
    })

    it('reads the chain only once the pointer rests on an element, never for one it only crossed', async () => {
      const chainReads = (): number =>
        h.page.cdp.calls('Runtime.callFunctionOn').filter((c) => (c.params as { functionDeclaration?: string }).functionDeclaration === PICK_CHAIN.source).length
      await hovering(h)
      expect(chainReads()).toBe(0)
      h.clock.advance(CHAIN_REST_MS - 1)
      h.contents.mouse('mouseMove', 100, 45) // onto the button before the label's rest ended
      await settle()
      h.clock.advance(CHAIN_REST_MS - 1)
      await settle()
      expect(chainReads()).toBe(0)
      h.clock.advance(1)
      await settle()
      expect(chainReads()).toBe(1)
      // Up then walks the chain already read.
      h.pick.refine('parent')
      await settle()
      expect(chainReads()).toBe(1)
      expect(h.pick.highlight.record?.label).toMatch(/^div#outer /)
    })

    it('reads the chain at the first Up when the pointer has not rested yet, and drops the rest timer', async () => {
      await hovering(h)
      h.pick.refine('parent')
      await settle()
      expect(h.pick.highlight.record?.label).toMatch(/^button#save /)
      const sent = h.page.cdp.sent.length
      h.clock.advance(CHAIN_REST_MS)
      await settle()
      expect(h.page.cdp.sent.length).toBe(sent)
    })

    it('keeps the new element outlined when the pointer moves on while the first Up reads the chain', async () => {
      await hovering(h)
      // The chain read takes several round trips; the move to the frame's element lands before it ends.
      h.pick.refine('parent')
      h.contents.mouse('mouseMove', 415, 115)
      await settle()
      expect(h.pick.highlight.record?.node).toEqual({ sessionKey: 'S1', backendNodeId: 102, frameId: 'F1' })
      expect(h.events.filter((e) => e.kind === 'highlight').at(-1)).toMatchObject({ label: h.pick.highlight.record?.label })
    })

    it('outlines the new element again when the pointer moves on while an Up draws its outline', async () => {
      await hovering(h)
      h.clock.advance(CHAIN_REST_MS)
      await settle()
      // The chain is read: the Up goes straight to drawing, and the move lands (and is outlined) while it does.
      const highlight = h.pick.highlight
      const show = highlight.show.bind(highlight)
      vi.spyOn(highlight, 'show').mockImplementationOnce(async (node) => {
        h.contents.mouse('mouseMove', 415, 115)
        await settle()
        return show(node)
      })
      h.pick.refine('parent')
      await settle()
      expect(h.pick.highlight.record?.node).toEqual({ sessionKey: 'S1', backendNodeId: 102, frameId: 'F1' })
      expect(h.events.filter((e) => e.kind === 'highlight').at(-1)).toMatchObject({ label: h.pick.highlight.record?.label })
    })

    it('moving onto the same element keeps the refined highlight', async () => {
      await hovering(h)
      h.pick.refine('parent')
      await settle()
      h.contents.mouse('mouseMove', 36, 31)
      await settle()
      expect(h.pick.highlight.record?.label).toMatch(/^span#label /)
    })
  })

  describe('confirm and the held capture (025-FR-053)', () => {
    it('hides the highlight before the screenshot, holds the capture and sends the still image with the summary', async () => {
      const id = await confirmed(h)
      expect(kinds(h)).toEqual(expect.arrayContaining(['capturing', 'captured']))
      const hide = h.page.cdp.sent.findIndex((c) => c.method === 'Overlay.hideHighlight')
      expect(hide).toBeGreaterThan(-1)
      const captured = h.events.find((e) => e.kind === 'captured')!
      expect(captured).toMatchObject({ captureId: id, stillWidth: 1600, stillHeight: 1200, summary: { name: 'span#label', atStart: true } })
      expect(h.pick.capture?.id).toBe(id)
      expect(h.pick.capture?.moment.pickPoint).toEqual({ x: 35, y: 30 })
      expect(h.state().surface).toBe('menu')
      expect(h.bench.read('confirmToMenu')).toHaveLength(1)
    })

    it('takes the screenshot only once the page drew two frames after the highlight was hidden (025-AC-034)', async () => {
      let atWait: { hidden: boolean; captures: number } | null = null
      h.contents.onScript = () => {
        atWait = { hidden: h.page.cdp.sent.some((c) => c.method === 'Overlay.hideHighlight'), captures: h.contents.captures }
      }
      await confirmed(h)
      expect(atWait).toEqual({ hidden: true, captures: 0 })
      expect(h.contents.scripts).toEqual([{ worldId: PAINT_WAIT_WORLD_ID, code: PAINT_WAIT_SCRIPT }])
      expect(h.contents.captures).toBe(1)
    })

    it('takes the screenshot at the cap when the page draws no frame, and at once when the wait cannot run', async () => {
      h.contents.paint = 'never'
      await hovering(h)
      h.routing.dispatch({ type: 'enter', now: h.clock.now() })
      await settle()
      expect(h.contents.captures).toBe(0)
      h.clock.advance(PAINT_WAIT_CAP_MS - 1)
      await settle()
      expect(h.contents.captures).toBe(0)
      h.clock.advance(1)
      await settle()
      expect(h.contents.captures).toBe(1)
      expect(h.events.some((e) => e.kind === 'captured')).toBe(true)

      const failing = pickHarness()
      failing.contents.paint = 'fails'
      await confirmed(failing)
      expect(failing.contents.captures).toBe(1)
    })

    it('records the viewport as the whole placed page view at the page zoom, a classic scrollbar included (025-FR-034)', async () => {
      const placed = pickHarness({ viewSize: { width: 800, height: 600 } })
      // The layout viewport leaves out a 15 px classic scrollbar.
      placed.page.viewports.set('', { width: 785, height: 600 })
      await confirmed(placed)
      expect(placed.pick.capture?.moment.viewport).toEqual({ width: 800, height: 600 })
      expect(placed.pick.capture?.moment.image.width).toBe(1600)

      const zoomed = pickHarness({ viewSize: { width: 800, height: 600 } })
      zoomed.contents.zoom = 1.25
      await confirmed(zoomed)
      expect(zoomed.pick.capture?.moment.viewport).toEqual({ width: 640, height: 480 })
    })

    it('caps the still image at 4096 px a side', async () => {
      h.contents.image = { width: 3000, height: 1000, scale: 2, alpha: 255 }
      await confirmed(h)
      const captured = h.events.find((e) => e.kind === 'captured')
      expect(captured).toMatchObject({ stillWidth: STILL_MAX_EDGE_PX })
    })

    it('re-hit-tests at a click and captures the element under it', async () => {
      await hovering(h)
      // BrowserTabInput's listener runs first and dispatches the click; the pick controller then records the point.
      h.routing.dispatch({ type: 'pageClick', now: h.clock.now(), doubleClickMs: 500 })
      h.contents.mouse('mouseDown', 25, 22)
      await settle()
      expect(h.pick.capture?.entry.name.id).toBe('save')
      expect(h.pick.capture?.moment.pickPoint).toEqual({ x: 25, y: 22 })
    })

    it('fails the capture with its reason when the screenshot stays empty; pick mode stays on', async () => {
      h.faults.armEmptyCaptures(2)
      await hovering(h)
      h.routing.dispatch({ type: 'enter', now: h.clock.now() })
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'captureFailed', reason: 'The screenshot came back empty' })
      expect(h.pick.capture).toBeNull()
      expect(h.state()).toMatchObject({ pick: true, capturing: false, surface: 'none' })
    })

    it('fails the capture when the highlighted element cannot be read', async () => {
      await hovering(h)
      h.page.broken.add(5)
      h.routing.dispatch({ type: 'enter', now: h.clock.now() })
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'captureFailed', reason: 'The capture could not be taken' })
    })

    it('fails the capture when nothing is highlighted', async () => {
      h.routing.dispatch({ type: 'pickButton' })
      await settle()
      await h.pick.startCapture(false)
      expect(h.events.at(-1)).toMatchObject({ kind: 'captureFailed', reason: 'The element under the pointer could not be read' })
    })

    it('reads the facts and hints after the menu shows', async () => {
      await confirmed(h)
      await settle()
      expect(h.page.cdp.calls('Runtime.callFunctionOn').some((c) => String((c.params as { functionDeclaration: string }).functionDeclaration).includes('getComputedStyle'))).toBe(true)
      const el = await h.pick.capture!.element()
      expect(el.facts.outerHtml).toBe('<span></span>')
    })

    it('outlines the same element again after the menu closes (no stale "same element" skip)', async () => {
      const id = await confirmed(h)
      expect(h.pick.close(id, 'esc')).toBe(true)
      await settle()
      expect(h.pick.highlight.record).toBeNull()
      h.contents.mouse('mouseMove', 35, 30)
      await settle()
      expect(h.pick.highlight.record?.label).toBe('span#label 40 × 20')
    })
  })

  describe('freeze (ADR 0008)', () => {
    it('reads every chain entry, then pauses the page and says so; closing the menu resumes it', async () => {
      const id = await confirmed(h, true)
      await settle()
      expect(h.pick.isFrozen).toBe(true)
      expect(h.events.at(-1)).toEqual({ tabId: 'tab-1', kind: 'frozen', captureId: id })
      const pause = h.page.cdp.sent.findIndex((c) => c.method === 'Debugger.pause')
      const lastCall = h.page.cdp.sent.map((c) => c.method).lastIndexOf('Runtime.callFunctionOn')
      expect(lastCall).toBeLessThan(pause)
      expect(h.state().frozen).toBe(true)
      h.pick.close(id, 'esc')
      await settle()
      expect(h.pick.isFrozen).toBe(false)
      expect(h.page.cdp.calls('Debugger.resume').length).toBeGreaterThan(0)
    })

    it('runs no page function while frozen: refinement uses the prefetched facts and no React lookup', async () => {
      const id = await confirmed(h, true)
      await settle()
      const before = h.page.cdp.calls('Runtime.callFunctionOn').length
      expect(h.pick.refine('parent')).toBeUndefined()
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'refined', captureId: id, summary: { name: 'button#save' } })
      const el = await h.pick.capture!.element()
      expect(el.hints.sourceAttributes).toEqual([['data-source', 'src/Save.tsx:4']])
      expect(h.page.cdp.calls('Runtime.callFunctionOn').length).toBe(before)
    })

    it('counts a resume from DevTools as closing without sending', async () => {
      await confirmed(h, true)
      await settle()
      h.page.cdp.emit('protocolEvent', { target: h.page.cdp.targets[0], method: 'Debugger.resumed', params: {} })
      await settle()
      expect(h.pick.capture).toBeNull()
      expect(h.events.at(-1)).toMatchObject({ kind: 'ended', reason: 'user' })
      expect(h.state().surface).toBe('none')
    })

    it('does not freeze when the menu closed before the hints finished', async () => {
      await hovering(h)
      h.routing.dispatch({ type: 'pickShortcut', now: h.clock.now() })
      await Promise.resolve()
      await settle()
      const id = h.pick.capture!.id
      h.pick.close(id, 'esc')
      await settle()
      expect(h.pick.isFrozen).toBe(false)
    })
  })

  describe('the menu', () => {
    it('refines the held capture with Up and Down', async () => {
      const id = await confirmed(h)
      h.pick.refine('parent')
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'refined', captureId: id, summary: { name: 'button#save' } })
    })

    it('maps each close reason to the routing and releases the capture', async () => {
      const id = await confirmed(h)
      expect(h.pick.close('other', 'esc')).toBe(false)
      expect(h.pick.close(id, 'sent')).toBe(true)
      expect(h.routing.dispatched.at(-1)).toEqual({ type: 'sent' })
      expect(h.pick.capture).toBeNull()
    })

    it('keeps the capture for an open dialog after the page navigated, then releases it at close (025-FR-053)', async () => {
      const id = await confirmed(h)
      h.routing.dispatch({ type: 'dialogOpen' })
      h.contents.emit('did-navigate')
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'ended', reason: 'pageChanged' })
      expect(h.pick.capture?.afterNavigation).toBe(true)
      h.pick.close(id, 'cancel')
      expect(h.pick.capture).toBeNull()
    })

    it('ends pick mode with the page-changed reason when the page navigates under the open menu (025-FR-053)', async () => {
      await confirmed(h)
      h.contents.emit('did-navigate')
      await settle()
      expect(h.events.filter((e) => e.kind === 'ended').at(-1)).toMatchObject({ kind: 'ended', reason: 'pageChanged' })
    })

    it('ends pick mode on a new document with the navigated reason when nothing is held', async () => {
      h.routing.dispatch({ type: 'pickButton' })
      await settle()
      h.contents.emit('did-navigate')
      await settle()
      expect(h.events.at(-1)).toMatchObject({ kind: 'ended', reason: 'navigated' })
      expect(h.pick.isActive).toBe(false)
    })

    it('ignores a new document outside pick mode', async () => {
      h.contents.emit('did-navigate')
      await settle()
      expect(kinds(h)).toEqual([])
    })
  })

  describe('Pick this element (025-FR-057)', () => {
    it('hit-tests at the menu point (page view px, zoom included) and captures that element at once', async () => {
      h.contents.zoom = 2
      await h.pick.pickAt({ x: 50, y: 44 })
      await settle()
      expect(h.pick.isActive).toBe(true)
      expect(h.pick.capture?.entry.name.id).toBe('save')
      expect(h.pick.capture?.moment.pickPoint).toEqual({ x: 25, y: 22 })
      expect(h.state().surface).toBe('menu')
    })

    it('works with pick mode off, where the session refuses the DOM domain until pick mode turns it on', async () => {
      h.page.cdp.gatePickDomains = true
      expect(h.pick.isActive).toBe(false)
      await h.pick.pickAt({ x: 25, y: 22 })
      await settle()
      expect(h.pick.isActive).toBe(true)
      expect(h.pick.capture?.entry.name.id).toBe('save')
      expect(h.state().surface).toBe('menu')
    })

    it('turns pick mode back off when the point hits nothing and pick mode was off', async () => {
      h.page.cdp.gatePickDomains = true
      await h.pick.pickAt({ x: 5000, y: 5000 })
      await settle()
      expect(h.pick.isActive).toBe(false)
      expect(h.pick.capture).toBeNull()
      expect(h.page.cdp.disabled).toBe(h.page.cdp.enabled)
    })

    it('does nothing over nothing, on a detached session, or after dispose', async () => {
      await h.pick.pickAt({ x: 5000, y: 5000 })
      h.page.cdp.attached = false
      await h.pick.pickAt({ x: 35, y: 30 })
      h.page.cdp.attached = true
      h.pick.dispose()
      await h.pick.pickAt({ x: 35, y: 30 })
      await settle()
      expect(h.pick.capture).toBeNull()
      expect(h.routing.dispatched.filter((e) => e.type === 'contextMenuPick')).toEqual([])
    })
  })

  it('dispose removes every listener and sends nothing more', async () => {
    await hovering(h)
    h.pick.dispose()
    h.pick.dispose()
    expect(h.contents.listenerCount('before-mouse-event')).toBe(0)
    expect(h.page.cdp.listenerCount('protocolEvent')).toBe(0)
    const count = h.events.length
    h.contents.mouse('mouseMove', 25, 22)
    await settle()
    expect(h.events.length).toBe(count)
  })

  it('lists the targets its session holds (the test hook)', () => {
    expect(h.pick.attachedTargets().map((t) => t.sessionKey)).toEqual(['', 'S1'])
  })
})

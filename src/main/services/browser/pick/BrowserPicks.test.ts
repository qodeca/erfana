// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const { logger } = vi.hoisted(() => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../LoggingService', () => ({ logger }))

import { createManualClock } from '../../../../shared/clock'
import { INITIAL_ROUTING_STATE, reduceRouting, type RoutingState } from '../../../../shared/browser/routingState'
import type { PickEvent } from '../../../../shared/ipc/browser-tab-schema'
import type { BrowserTab, TabHost } from '../BrowserTab'
import type { TargetTerminals } from '../capture/BrowserTargetStatus'
import type { Bitmap } from '../capture/captureImage'
import { CAPTURES_REL } from '../capture/CaptureStore'
import type { TabInputPick } from '../input/BrowserTabInput'
import { BrowserPicks, SEND_READ_TIMEOUT_MS, type TabPickInput } from './BrowserPicks'
import type { BrowserTabPick } from './BrowserTabPick'
import { FakePickContents, settle } from './__test-helpers__/pickHarness'
import { samplePage } from './__test-helpers__/samplePage'

const OWNER = 42

function input(): TabPickInput & { pick: TabInputPick | null } {
  let state: RoutingState = { ...INITIAL_ROUTING_STATE, pageLoaded: true, focus: 'page' }
  const self: TabPickInput & { pick: TabInputPick | null } = {
    pick: null,
    state: () => state,
    dispatch(event) {
      const { state: next, effects } = reduceRouting(state, event)
      state = next
      for (const effect of effects) {
        if (effect.type === 'pickMode') self.pick?.mode(effect.on)
        else self.pick?.onEffect(effect)
      }
      return effects
    },
    attachPick(pick) {
      self.pick = pick
    }
  }
  return self
}

function terminals(kind: 'agent' | 'shell' | 'none' = 'agent'): TargetTerminals {
  return {
    getOwner: (id) => (kind === 'none' || id !== 'terminal-1' ? undefined : OWNER),
    getActivity: () => ({ busy: kind === 'agent', known: true })
  }
}

describe('BrowserPicks', () => {
  let root: string
  let encodePng: Mock<(bitmap: Bitmap) => Uint8Array>

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'erfana-picks-')))
    encodePng = vi.fn((_bitmap: Bitmap) => new Uint8Array([137, 80, 78, 71]))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function setup(over: { terminals?: TargetTerminals | null; register?: boolean } = {}) {
    const page = samplePage({ crossSite: false })
    const contents = new FakePickContents()
    const tab = {
      id: 'tab-1',
      contents,
      projectRoot: root,
      viewFrame: { placement: () => ({ view: { x: 10, y: 20 } }), widthPreset: 'full' }
    } as unknown as BrowserTab
    const host = { isDestroyed: () => false, getContentBounds: () => ({ x: 100, y: 200, width: 800, height: 600 }) } as unknown as TabHost
    const clock = createManualClock(Date.UTC(2026, 10, 2, 21, 5, 9))
    const picks = new BrowserPicks({
      clock,
      encodePng,
      terminals: over.terminals === null ? undefined : () => over.terminals ?? terminals(),
      sessionOf: over.register === true ? undefined : () => page.cdp
    })
    if (over.register === true) picks.registerSession(contents, page.cdp)
    const routing = input()
    const events: PickEvent[] = []
    const pick = picks.attach(tab, host, routing, (e) => events.push(e))!
    return { page, contents, tab, host, picks, pick, routing, events, clock }
  }

  async function held(s: ReturnType<typeof setup>): Promise<string> {
    s.routing.dispatch({ type: 'pickButton' })
    await settle()
    s.contents.mouse('mouseMove', 35, 30)
    await settle()
    s.routing.dispatch({ type: 'enter', now: s.clock.now() })
    await settle()
    const id = s.pick.capture?.id
    if (id === undefined) throw new Error('no capture')
    return id
  }

  describe('attach', () => {
    it('gives a tab its pick pipeline wired to its routing, once; events go to the owning window', async () => {
      const s = setup()
      expect(s.picks.forTab(s.tab)).toBe(s.pick)
      expect(s.picks.attach(s.tab, s.host, input(), () => undefined)).toBeNull()
      s.routing.pick!.mode(true)
      await settle()
      expect(s.pick.isActive).toBe(true)
      s.routing.pick!.refine('parent')
      await settle()
      expect(s.events.some((e) => e.kind === 'note')).toBe(true)
    })

    it('uses a session recorded with registerSession', async () => {
      const s = setup({ register: true })
      expect(s.pick).not.toBeNull()
    })

    it('attaches nothing without routing or a CDP session', () => {
      const picks = new BrowserPicks({ clock: createManualClock(), encodePng })
      const tab = { id: 't', contents: new FakePickContents() } as unknown as BrowserTab
      expect(picks.attach(tab, {} as TabHost, null, () => undefined)).toBeNull()
      expect(picks.attach(tab, {} as TabHost, input(), () => undefined)).toBeNull()
      expect(picks.attachTab(tab, {} as TabHost, null, input(), { pick: () => undefined })).toBeNull()
    })

    it('places the pointer origin at the window content plus the view, none while the host is gone', () => {
      const s = setup()
      const deps = (s.pick as unknown as { deps: { viewOrigin: () => unknown; widthPreset: () => unknown; projectRoot: () => unknown } }).deps
      expect(deps.viewOrigin()).toEqual({ x: 110, y: 220 })
      expect(deps.widthPreset()).toEqual({ kind: 'preset', name: 'Full width' })
      expect(deps.projectRoot()).toBe(root)
      const gone = setup()
      ;(gone.host as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true
      const goneDeps = (gone.pick as unknown as { deps: { viewOrigin: () => unknown } }).deps
      expect(goneDeps.viewOrigin()).toBeNull()
    })

    it('forgets a tab whose page is destroyed, and a closed tab; detachTab disposes', () => {
      const s = setup()
      s.contents.emit('destroyed')
      expect(s.picks.forTab(s.tab)).toBeNull()
      s.picks.forgetTab('tab-1')
      const other = setup()
      const dispose = vi.spyOn(other.pick, 'dispose')
      other.picks.detachTab(other.pick as BrowserTabPick)
      expect(dispose).toHaveBeenCalled()
    })
  })

  describe('writeCapture (025-FR-046, 025-FR-061)', () => {
    it('runs the shell guard first: no terminal, another window\'s and a shell refuse before any file is written', async () => {
      const s = setup({ terminals: terminals('shell') })
      const id = await held(s)
      expect(await s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-2' })).toEqual({ guard: { kind: 'noTerminal', process: null } })
      expect(await s.picks.writeCapture(s.tab, s.pick, 7, { captureId: id, terminalId: 'terminal-1' })).toEqual({ guard: { kind: 'noTerminal', process: null } })
      expect(await s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1', sendAnyway: true })).toEqual({ guard: { kind: 'shell', process: null } })
      expect(await readdir(root)).toEqual([])
      const none = setup({ terminals: null })
      const noneId = await held(none)
      expect(await none.picks.writeCapture(none.tab, none.pick, OWNER, { captureId: noneId, terminalId: 'terminal-1' })).toEqual({ guard: { kind: 'noTerminal', process: null } })
    })

    it('writes the three files of the capture toward an agent and records them', async () => {
      const s = setup()
      const id = await held(s)
      const answer = await s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1' })
      if (!('paths' in answer)) throw new Error(JSON.stringify(answer))
      expect(answer.paths.context).toMatch(new RegExp(`^${CAPTURES_REL}/20261102-210509Z-[0-9a-f]{8}\\.md$`))
      expect((await readdir(path.join(root, ...CAPTURES_REL.split('/')))).length).toBe(3)
      const text = await readFile(path.join(root, answer.paths.context), 'utf8')
      expect(text).toContain('<span></span>')
      expect(s.pick.capture?.written).toHaveLength(3)
      expect(s.picks.bench.read('send')).toHaveLength(1)
    })

    it('joins a second submit to the write in flight (each confirmation writes once)', async () => {
      const s = setup()
      const id = await held(s)
      const [a, b] = await Promise.all([
        s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1' }),
        s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1' })
      ])
      expect(a).toEqual(b)
      expect((await readdir(path.join(root, ...CAPTURES_REL.split('/')))).length).toBe(3)
    })

    it('answers an error for a capture no longer held', async () => {
      const s = setup()
      expect(await s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: 'x'.repeat(32), terminalId: 'terminal-1' })).toEqual({
        error: 'The capture is no longer held – pick the element again'
      })
    })

    it('names the reason of a failed write, leaves no file and keeps the capture for a retry (025-AC-060)', async () => {
      const s = setup()
      const id = await held(s)
      s.picks.faults.armWriteFailures(1)
      expect(await s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1' })).toEqual({
        error: 'The capture could not be saved: forced write failure'
      })
      expect(await readdir(path.join(root, ...CAPTURES_REL.split('/')))).toEqual([])
      expect(s.pick.capture?.id).toBe(id)
      expect('paths' in (await s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1' }))).toBe(true)
    })

    it('answers a plain error when the capture cannot be rendered, and logs no page text', async () => {
      const s = setup()
      const id = await held(s)
      encodePng.mockImplementation(() => {
        throw new TypeError('encoder')
      })
      expect(await s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1' })).toEqual({ error: 'The capture could not be saved' })
      expect(logger.warn).toHaveBeenCalledWith('Browser capture could not be rendered', { error: 'TypeError' })
    })

    it('times the facts out after 10 s and still fails cleanly', async () => {
      const s = setup()
      const id = await held(s)
      const capture = s.pick.capture!
      vi.spyOn(capture, 'element').mockReturnValue(new Promise(() => undefined))
      const pending = s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1' })
      await settle()
      s.clock.advance(SEND_READ_TIMEOUT_MS)
      expect(await pending).toEqual({ error: 'The capture could not be saved' })
    })

    it('deletes the files when the pick ended while they were written', async () => {
      const s = setup()
      const id = await held(s)
      const capture = s.pick.capture!
      const element = capture.element.bind(capture)
      vi.spyOn(capture, 'element').mockImplementation(async () => {
        const el = await element()
        s.pick.release()
        return el
      })
      expect(await s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1' })).toEqual({ error: 'The pick ended before the capture was saved' })
      expect(await readdir(path.join(root, ...CAPTURES_REL.split('/')))).toEqual([])
    })

    it('answers an error when the capture went before the write began', async () => {
      const s = setup()
      const id = await held(s)
      const write = (s.picks as unknown as { write: (t: BrowserTab, p: BrowserTabPick, id: string) => Promise<unknown> }).write.bind(s.picks)
      s.pick.release()
      expect(await write(s.tab, s.pick, id)).toEqual({ error: 'The capture is no longer held – pick the element again' })
    })
  })

  it('discards the files of the last send and keeps the capture; false for another capture', async () => {
    const s = setup()
    const id = await held(s)
    await s.picks.writeCapture(s.tab, s.pick, OWNER, { captureId: id, terminalId: 'terminal-1' })
    expect(await s.picks.discardCaptureFiles(s.tab, s.pick, 'other')).toBe(false)
    expect(await s.picks.discardCaptureFiles(s.tab, s.pick, id)).toBe(true)
    expect(await readdir(path.join(root, ...CAPTURES_REL.split('/')))).toEqual([])
    expect(s.pick.capture?.written).toEqual([])
  })

  it('answers the target status, unknown and not fresh without a terminal service', () => {
    expect(setup().picks.targetStatus(OWNER, 'terminal-1')).toEqual({ kind: 'agent', process: null, fresh: true })
    expect(setup({ terminals: null }).picks.targetStatus(OWNER, 'terminal-1')).toEqual({ kind: 'unknown', process: null, fresh: false })
  })

  it('routes Pick this element to the tab, logging a failure; an unknown tab is ignored', async () => {
    const s = setup()
    const pickAt = vi.spyOn(s.pick, 'pickAt').mockRejectedValueOnce(new Error('boom'))
    s.picks.pickAt('tab-1', { x: 1, y: 2 })
    s.picks.pickAt('nope', { x: 1, y: 2 })
    await settle()
    expect(pickAt).toHaveBeenCalledWith({ x: 1, y: 2 })
    expect(logger.warn).toHaveBeenCalledWith('Browser pick: Pick this element failed', { error: 'Error: boom' })
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

const { logger } = vi.hoisted(() => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../LoggingService', () => ({ logger }))

import { PICK_OBJECT_GROUP } from '../cdp/cdpPinned'
import { PickReader } from './pickCdp'
import { PickFrames } from './pickFrames'
import { CROSSHAIR_CSS, PickModeSwitch, type ModeSwitchContents } from './pickModeSwitch'
import { FakePickCdp, frameTarget } from './__test-helpers__/fakePickCdp'

function contents(): ModeSwitchContents & { inserted: string[]; removed: string[]; destroyed: boolean } {
  return {
    inserted: [],
    removed: [],
    destroyed: false,
    isDestroyed() {
      return this.destroyed
    },
    async insertCSS(css, options) {
      this.inserted.push(`${options?.cssOrigin ?? ''}:${css}`)
      return 'key-1'
    },
    async removeInsertedCSS(key) {
      this.removed.push(key)
    }
  }
}

function setup() {
  const cdp = new FakePickCdp()
  cdp.targets.push(frameTarget('S1', 'F1'))
  const reader = new PickReader(cdp)
  const page = contents()
  return { cdp, page, sw: new PickModeSwitch(cdp, reader, new PickFrames(cdp, reader), page) }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('PickModeSwitch (025-FR-025)', () => {
  it('on: enables the pick domains, focus emulation on every frame target, and the crosshair at user origin (S-11)', async () => {
    const { cdp, page, sw } = setup()
    await sw.on(() => true)
    await flush()
    expect(cdp.enabled).toBe(1)
    expect(cdp.calls('Emulation.setFocusEmulationEnabled').map((c) => [c.sessionKey, c.params])).toEqual([
      ['', { enabled: true }],
      ['S1', { enabled: true }]
    ])
    expect(page.inserted).toEqual([`user:${CROSSHAIR_CSS}`])
  })

  it('logs a failure to enable the domains and carries on', async () => {
    const { cdp, sw } = setup()
    cdp.enableError = new Error('refused')
    await sw.on(() => true)
    expect(logger.warn).toHaveBeenCalledWith('Browser pick: the pick domains could not be enabled', { error: 'Error: refused' })
  })

  it('removes a crosshair that lands after pick mode already went off', async () => {
    const { page, sw } = setup()
    await sw.on(() => false)
    await flush()
    expect(page.removed).toEqual(['key-1'])
  })

  it('off: removes the crosshair, turns focus emulation off, releases handles and disables the domains', async () => {
    const { cdp, page, sw } = setup()
    await sw.on(() => true)
    await flush()
    cdp.sent.length = 0
    await sw.off()
    expect(page.removed).toEqual(['key-1'])
    expect(cdp.sent.map((c) => `${c.sessionKey}:${c.method}`)).toEqual([
      ':Emulation.setFocusEmulationEnabled',
      'S1:Emulation.setFocusEmulationEnabled',
      ':Runtime.releaseObjectGroup',
      'S1:Runtime.releaseObjectGroup'
    ])
    expect(cdp.calls('Runtime.releaseObjectGroup')[0].params).toEqual({ objectGroup: PICK_OBJECT_GROUP })
    expect(cdp.disabled).toBe(1)
  })

  it('off on a detached session or a destroyed page sends nothing it cannot', async () => {
    const { cdp, page, sw } = setup()
    await sw.on(() => true)
    await flush()
    page.destroyed = true
    cdp.attached = false
    cdp.sent.length = 0
    await sw.off()
    expect(page.removed).toEqual([])
    expect(cdp.sent).toEqual([])
    expect(cdp.disabled).toBe(0)
  })

  it('never rejects when the crosshair cannot be inserted or removed', async () => {
    const { page, sw } = setup()
    page.insertCSS = async () => Promise.reject(new Error('destroyed'))
    await expect(sw.on(() => true)).resolves.toBeUndefined()
    await flush()
    const late = setup()
    late.page.removeInsertedCSS = async () => Promise.reject(new Error('destroyed'))
    await late.sw.on(() => false)
    await flush()
    const stuck = setup()
    await stuck.sw.on(() => true)
    await flush()
    stuck.page.removeInsertedCSS = async () => Promise.reject(new Error('destroyed'))
    await expect(stuck.sw.off()).resolves.toBeUndefined()
  })

  it('turns focus emulation on for one frame that attaches later, and ignores a refusal', async () => {
    const { cdp, sw } = setup()
    cdp.handle('Emulation.setFocusEmulationEnabled', () => {
      throw new Error('gone')
    })
    sw.focusEmulation('S2', true)
    await flush()
    expect(cdp.calls('Emulation.setFocusEmulationEnabled')).toEqual([{ method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true }, sessionKey: 'S2' }])
  })
})

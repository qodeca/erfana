// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { PickReader } from './pickCdp'
import { PickFreeze, type FreezeAudio } from './pickFreeze'
import { FakePickCdp, frameTarget } from './__test-helpers__/fakePickCdp'

function audio(muted = false): FreezeAudio & { muted: boolean } {
  return {
    muted,
    isAudioMuted() {
      return this.muted
    },
    setAudioMuted(m: boolean) {
      this.muted = m
    },
    isDestroyed: () => false
  }
}

describe('PickFreeze (ADR 0008)', () => {
  let cdp: FakePickCdp
  let onExternalResume: Mock<() => void>

  beforeEach(() => {
    cdp = new FakePickCdp()
    cdp.targets.push(frameTarget('S1', 'F1'), { sessionKey: 'W1', targetId: 'w', type: 'worker', url: '' })
    onExternalResume = vi.fn<() => void>()
  })

  it('pauses every frame target – enable and pause sent back to back – suspends the hang probe and mutes the page', async () => {
    const sound = audio()
    const freeze = new PickFreeze(cdp, new PickReader(cdp), sound, onExternalResume)
    await freeze.freeze()
    expect(freeze.isFrozen).toBe(true)
    expect(cdp.sent.map((c) => `${c.sessionKey}:${c.method}`)).toEqual([':Debugger.enable', ':Debugger.pause', 'S1:Debugger.enable', 'S1:Debugger.pause'])
    expect(cdp.hangProbeCalls).toEqual(['suspend:frozen'])
    expect(sound.muted).toBe(true)
    await freeze.freeze()
    expect(cdp.calls('Debugger.pause')).toHaveLength(2)
  })

  it('pauses a frame that attaches while frozen, but no worker', async () => {
    const freeze = new PickFreeze(cdp, new PickReader(cdp), audio(), onExternalResume)
    await freeze.freeze()
    cdp.emit('targetAttached', frameTarget('S2', 'F2'))
    cdp.emit('targetAttached', { sessionKey: 'W2', targetId: 'w2', type: 'worker', url: '' })
    await Promise.resolve()
    expect(cdp.calls('Debugger.pause').map((c) => c.sessionKey)).toEqual(['', 'S1', 'S2'])
  })

  it('resumes then disables every frame target, restores the hang probe and the sound it muted; idempotent', async () => {
    const sound = audio()
    const freeze = new PickFreeze(cdp, new PickReader(cdp), sound, onExternalResume)
    await freeze.unfreeze()
    expect(cdp.sent).toEqual([])
    await freeze.freeze()
    cdp.sent.length = 0
    await freeze.unfreeze()
    expect(cdp.sent.map((c) => `${c.sessionKey}:${c.method}`)).toEqual([':Debugger.resume', 'S1:Debugger.resume', ':Debugger.disable', 'S1:Debugger.disable'])
    expect(cdp.hangProbeCalls).toEqual(['suspend:frozen', 'resume:frozen'])
    expect(sound.muted).toBe(false)
    expect(freeze.isFrozen).toBe(false)
  })

  it('leaves a page the user had muted muted', async () => {
    const sound = audio(true)
    const freeze = new PickFreeze(cdp, new PickReader(cdp), sound, onExternalResume)
    await freeze.freeze()
    await freeze.unfreeze()
    expect(sound.muted).toBe(true)
  })

  it('never rejects when a frame cannot be paused or resumed', async () => {
    cdp.handle('Debugger.pause', () => {
      throw new Error('gone')
    })
    cdp.handle('Debugger.resume', () => {
      throw new Error('gone')
    })
    const freeze = new PickFreeze(cdp, new PickReader(cdp), audio(), onExternalResume)
    await expect(freeze.freeze()).resolves.toBeUndefined()
    await expect(freeze.unfreeze()).resolves.toBeUndefined()
  })

  it("counts a resume Erfana did not cause as closing without sending; its own resume and an unfrozen page's are ignored", async () => {
    const freeze = new PickFreeze(cdp, new PickReader(cdp), audio(), onExternalResume)
    const resumed = () => cdp.emit('protocolEvent', { target: cdp.targets[0], method: 'Debugger.resumed', params: {} })
    resumed()
    expect(onExternalResume).not.toHaveBeenCalled()
    await freeze.freeze()
    cdp.handle('Debugger.resume', () => {
      resumed()
      return {}
    })
    await freeze.unfreeze()
    expect(onExternalResume).not.toHaveBeenCalled()
    await freeze.freeze()
    cdp.emit('protocolEvent', { target: cdp.targets[0], method: 'Debugger.paused', params: {} })
    resumed()
    expect(onExternalResume).toHaveBeenCalledTimes(1)
  })

  it('stops listening on dispose', () => {
    const freeze = new PickFreeze(cdp, new PickReader(cdp), audio(), onExternalResume)
    freeze.dispose()
    expect(cdp.listenerCount('protocolEvent')).toBe(0)
    expect(cdp.listenerCount('targetAttached')).toBe(0)
  })

  it('does not touch the sound of a destroyed page', async () => {
    const sound = { ...audio(), isDestroyed: () => true, setAudioMuted: vi.fn(), isAudioMuted: () => false }
    const freeze = new PickFreeze(cdp, new PickReader(cdp), sound, onExternalResume)
    await freeze.freeze()
    await freeze.unfreeze()
    expect(sound.setAudioMuted).not.toHaveBeenCalled()
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { ISOLATED_WORLD_NAME, PICK_OBJECT_GROUP } from '../cdp/cdpPinned'
import { PICK_CHAIN, REACT_DEBUG_STACK } from '../cdp/cdpPickFunctions'
import { numberField, PickReader, PickReadError, stringField } from './pickCdp'
import { FakePickCdp, frameTarget } from './__test-helpers__/fakePickCdp'

const NODE = { sessionKey: '', backendNodeId: 7, frameId: 'top' }

describe('PickReader', () => {
  it('turns a synchronous refusal of the session into a rejection', async () => {
    const cdp = new FakePickCdp()
    cdp.send = () => {
      throw new Error('not allowed')
    }
    await expect(new PickReader(cdp).call('DOM.enable', {}, '')).rejects.toThrow('not allowed')
  })

  it("resolves a node in Erfana's isolated world, created once per frame with the pinned name and no universal access", async () => {
    const cdp = new FakePickCdp()
      .handle('Page.createIsolatedWorld', () => ({ executionContextId: 4 }))
      .handle('DOM.resolveNode', () => ({ object: { objectId: 'o1' } }))
    const reader = new PickReader(cdp)
    expect(await reader.resolve(NODE, 'isolated')).toBe('o1')
    expect(await reader.resolve(NODE, 'isolated')).toBe('o1')
    expect(cdp.calls('Page.createIsolatedWorld')).toEqual([
      { method: 'Page.createIsolatedWorld', params: { frameId: 'top', worldName: ISOLATED_WORLD_NAME, grantUniveralAccess: false }, sessionKey: '' }
    ])
    expect(cdp.calls('DOM.resolveNode')[0].params).toEqual({ backendNodeId: 7, objectGroup: PICK_OBJECT_GROUP, executionContextId: 4 })
  })

  it('makes a fresh world once when the cached one is stale (a new document), and forgets worlds on reset and per session', async () => {
    let context = 1
    let stale = true
    const cdp = new FakePickCdp()
      .handle('Page.createIsolatedWorld', () => ({ executionContextId: context++ }))
      .handle('DOM.resolveNode', (p) => {
        if (p.executionContextId === 1 && stale) throw new Error('Cannot find context')
        return { object: { objectId: `o${String(p.executionContextId)}` } }
      })
    const reader = new PickReader(cdp)
    expect(await reader.resolve(NODE, 'isolated')).toBe('o2')
    stale = false
    reader.reset()
    expect(await reader.resolve(NODE, 'isolated')).toBe('o3')
    reader.forgetSession('')
    expect(await reader.resolve(NODE, 'isolated')).toBe('o4')
    reader.forgetSession('other')
    expect(await reader.resolve(NODE, 'isolated')).toBe('o4')
  })

  it('drops a world that could not be created, so the next ask tries again', async () => {
    let fail = true
    const cdp = new FakePickCdp()
      .handle('Page.createIsolatedWorld', () => (fail ? {} : { executionContextId: 9 }))
      .handle('DOM.resolveNode', () => ({ object: { objectId: 'o9' } }))
    const reader = new PickReader(cdp)
    await expect(reader.resolve(NODE, 'isolated')).rejects.toBeInstanceOf(PickReadError)
    fail = false
    expect(await reader.resolve(NODE, 'isolated')).toBe('o9')
  })

  it("resolves in the page's main world without an isolated world (the React lookup)", async () => {
    const cdp = new FakePickCdp().handle('DOM.resolveNode', () => ({ object: { objectId: 'm1' } }))
    expect(await new PickReader(cdp).resolve(NODE, 'main')).toBe('m1')
    expect(cdp.calls('Page.createIsolatedWorld')).toEqual([])
    const none = new FakePickCdp().handle('DOM.resolveNode', () => ({ object: {} }))
    await expect(new PickReader(none).resolve(NODE, 'main')).rejects.toBeInstanceOf(PickReadError)
  })

  it('calls a pinned function with its exact source, side effects refused, by value, in the pick group', async () => {
    const cdp = new FakePickCdp().handle('Runtime.callFunctionOn', () => ({ result: { value: 42 } }))
    expect(await new PickReader(cdp).callValue('', 'o1', PICK_CHAIN, [3])).toBe(42)
    expect(cdp.calls('Runtime.callFunctionOn')[0].params).toEqual({
      functionDeclaration: PICK_CHAIN.source,
      objectId: 'o1',
      throwOnSideEffect: true,
      returnByValue: true,
      silent: true,
      objectGroup: PICK_OBJECT_GROUP,
      userGesture: false,
      awaitPromise: false,
      arguments: [{ value: 3 }]
    })
  })

  it('fails a call that threw in the page or answered nothing usable', async () => {
    const threw = new FakePickCdp().handle('Runtime.callFunctionOn', () => ({ result: {}, exceptionDetails: { text: 'EvalError' } }))
    await expect(new PickReader(threw).callValue('', 'o', PICK_CHAIN)).rejects.toThrow('Pick read failed: pickChain')
    const junk = new FakePickCdp().handle('Runtime.callFunctionOn', () => 'junk')
    await expect(new PickReader(junk).callObject('', 'o', PICK_CHAIN)).rejects.toBeInstanceOf(PickReadError)
  })

  it('answers the returned handle, or null for a null result', async () => {
    let answer: unknown = { result: { objectId: 'o5' } }
    const cdp = new FakePickCdp().handle('Runtime.callFunctionOn', () => answer)
    const reader = new PickReader(cdp)
    expect(await reader.callObject('', 'o', PICK_CHAIN)).toBe('o5')
    expect(cdp.calls('Runtime.callFunctionOn')[0].params).toMatchObject({ returnByValue: false })
    answer = { result: { subtype: 'null' } }
    expect(await reader.callObject('', 'o', PICK_CHAIN)).toBeNull()
  })

  it("answers a returned error's description by handle, or null for anything else (the React 19 stack read)", async () => {
    let answer: unknown = { result: { type: 'object', subtype: 'error', objectId: 'o6', description: 'Error: react-stack-top-frame\n    at x' } }
    const cdp = new FakePickCdp().handle('Runtime.callFunctionOn', () => answer)
    const reader = new PickReader(cdp)
    expect(await reader.callErrorDescription('S1', 'o', REACT_DEBUG_STACK)).toBe('Error: react-stack-top-frame\n    at x')
    expect(cdp.calls('Runtime.callFunctionOn')[0]).toMatchObject({
      sessionKey: 'S1',
      params: { functionDeclaration: REACT_DEBUG_STACK.source, returnByValue: false, throwOnSideEffect: true, objectGroup: PICK_OBJECT_GROUP }
    })
    answer = { result: { type: 'object', subtype: 'null', value: null } }
    expect(await reader.callErrorDescription('', 'o', REACT_DEBUG_STACK)).toBeNull()
    answer = { result: { type: 'object', className: 'Object', description: 'Object' } }
    expect(await reader.callErrorDescription('', 'o', REACT_DEBUG_STACK)).toBeNull()
    answer = { result: { type: 'object', subtype: 'error' } }
    expect(await reader.callErrorDescription('', 'o', REACT_DEBUG_STACK)).toBeNull()
  })

  it('runs a function on a node in the isolated world', async () => {
    const cdp = new FakePickCdp()
      .handle('Page.createIsolatedWorld', () => ({ executionContextId: 1 }))
      .handle('DOM.resolveNode', () => ({ object: { objectId: 'o1' } }))
      .handle('Runtime.callFunctionOn', (p) => ({ result: { value: p.objectId } }))
    expect(await new PickReader(cdp).valueOn(NODE, PICK_CHAIN)).toBe('o1')
  })

  it('releases the pick group in every attached target, never rejecting', async () => {
    const cdp = new FakePickCdp().handle('Runtime.releaseObjectGroup', (_p, key) => {
      if (key === 'S1') throw new Error('gone')
      return {}
    })
    cdp.targets.push(frameTarget('S1', 'F1'))
    await expect(new PickReader(cdp).releaseAll()).resolves.toBeUndefined()
    expect(cdp.calls('Runtime.releaseObjectGroup').map((c) => [c.sessionKey, c.params])).toEqual([
      ['', { objectGroup: PICK_OBJECT_GROUP }],
      ['S1', { objectGroup: PICK_OBJECT_GROUP }]
    ])
  })
})

describe('CDP answer fields', () => {
  it('reads finite numbers and strings, with fallbacks', () => {
    expect(numberField({ a: 3 }, 'a')).toBe(3)
    expect(numberField({ a: Number.POSITIVE_INFINITY }, 'a', 9)).toBe(9)
    expect(numberField(null, 'a')).toBe(0)
    expect(stringField({ a: 'x' }, 'a')).toBe('x')
    expect(stringField({ a: 1 }, 'a')).toBe('')
  })
})

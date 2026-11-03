// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { allowedMethods, CdpRefusedError, checkCdpCommand, jsonEqual } from './cdpAllowList'
import {
  CDP_PAGE_FUNCTIONS,
  ISOLATED_WORLD_NAME,
  OUTER_HTML_CUT,
  pickOutlineParams
} from './cdpPinned'

function refusal(fn: () => unknown): CdpRefusedError {
  try {
    fn()
  } catch (error) {
    if (error instanceof CdpRefusedError) return error
    throw error
  }
  throw new Error('expected a refusal')
}

describe('cdpAllowList – the pinned method lists (§ 5, 025-NFR-001)', () => {
  it('pins the tab-kind list exactly', () => {
    expect(allowedMethods('tab')).toEqual([
      'CSS.disable',
      'CSS.enable',
      'CSS.getComputedStyleForNode',
      'CSS.getMatchedStylesForNode',
      'DOM.describeNode',
      'DOM.disable',
      'DOM.enable',
      'DOM.getBoxModel',
      'DOM.getContentQuads',
      'DOM.getDocument',
      'DOM.getFrameOwner',
      'DOM.getNodeForLocation',
      'DOM.querySelectorAll',
      'DOM.resolveNode',
      'Debugger.disable',
      'Debugger.enable',
      'Debugger.pause',
      'Debugger.resume',
      'Emulation.setFocusEmulationEnabled',
      'Emulation.setUserAgentOverride',
      'Log.disable',
      'Log.enable',
      'Network.disable',
      'Network.enable',
      'Network.setUserAgentOverride',
      'Overlay.disable',
      'Overlay.enable',
      'Overlay.hideHighlight',
      'Overlay.highlightQuad',
      'Page.createIsolatedWorld',
      'Page.enable',
      'Page.getFrameTree',
      'Page.getLayoutMetrics',
      'Page.handleJavaScriptDialog',
      'Runtime.callFunctionOn',
      'Runtime.disable',
      'Runtime.discardConsoleEntries',
      'Runtime.enable',
      'Runtime.evaluate',
      'Runtime.releaseObjectGroup',
      'Runtime.runIfWaitingForDebugger',
      'Target.setAutoAttach'
    ])
  })

  it('pins the popup-kind list exactly: no pick, overlay, freeze or page function', () => {
    expect(allowedMethods('popup')).toEqual([
      'Emulation.setUserAgentOverride',
      'Log.disable',
      'Log.enable',
      'Network.disable',
      'Network.enable',
      'Network.setUserAgentOverride',
      'Page.enable',
      'Page.handleJavaScriptDialog',
      'Runtime.disable',
      'Runtime.discardConsoleEntries',
      'Runtime.enable',
      'Runtime.evaluate',
      'Runtime.releaseObjectGroup',
      'Runtime.runIfWaitingForDebugger',
      'Target.setAutoAttach'
    ])
  })

  it.each([
    'Runtime.compileScript',
    'Runtime.addBinding',
    'Page.navigate',
    'Page.addScriptToEvaluateOnNewDocument',
    'Input.dispatchKeyEvent',
    'Network.getResponseBody',
    'Storage.getCookies',
    'Target.createTarget',
    'Overlay.setInspectMode',
    'Overlay.highlightNode',
    'Browser.close',
    'runtime.enable',
    ''
  ])('refuses %s, which no list holds', method => {
    expect(refusal(() => checkCdpCommand('tab', method)).rule).toBe('not allowed for the tab kind')
  })

  it.each(['DOM.enable', 'Overlay.highlightQuad', 'Runtime.callFunctionOn', 'Debugger.pause', 'Page.createIsolatedWorld'])(
    'refuses %s on the popup kind',
    method => {
      expect(refusal(() => checkCdpCommand('popup', method, {})).rule).toBe('not allowed for the popup kind')
    }
  )
})

describe('cdpAllowList – parameter pinning (S23)', () => {
  it('accepts only the fixed auto-attach options', () => {
    expect(checkCdpCommand('tab', 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })).toEqual({
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    })
    for (const params of [
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      { autoAttach: true, waitForDebuggerOnStart: true, flatten: false },
      { autoAttach: true, waitForDebuggerOnStart: true },
      { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'browser' }] }
    ]) {
      expect(refusal(() => checkCdpCommand('tab', 'Target.setAutoAttach', params)).rule).toBe('pinned parameters')
    }
  })

  it("accepts Runtime.evaluate only as the hang probe with expression '0'", () => {
    expect(checkCdpCommand('tab', 'Runtime.evaluate', { expression: '0', returnByValue: true, silent: true })).toBeTruthy()
    for (const params of [
      { expression: '1', returnByValue: true, silent: true },
      { expression: 'document.cookie', returnByValue: true, silent: true },
      { expression: '0', returnByValue: true, silent: true, userGesture: true },
      { expression: '0', returnByValue: true, silent: true, includeCommandLineAPI: true },
      { expression: '0' },
      undefined
    ]) {
      expect(refusal(() => checkCdpCommand('popup', 'Runtime.evaluate', params)).rule).toBe('pinned parameters')
    }
  })

  describe('Runtime.callFunctionOn', () => {
    const ok = { functionDeclaration: OUTER_HTML_CUT.source, objectId: 'obj-1', throwOnSideEffect: true }

    it('accepts a registered function with its pinned side-effect flag', () => {
      expect(checkCdpCommand('tab', 'Runtime.callFunctionOn', ok)).toEqual(ok)
      expect(
        checkCdpCommand('tab', 'Runtime.callFunctionOn', {
          ...ok,
          userGesture: false,
          awaitPromise: false,
          returnByValue: true,
          silent: true,
          objectGroup: 'erfana-pick',
          arguments: [{ value: 1 }, { value: 'a' }, { value: null }, { value: true }]
        })
      ).toBeTruthy()
    })

    it('every registered function is frozen and carries a side-effect flag', () => {
      expect(Object.isFrozen(CDP_PAGE_FUNCTIONS)).toBe(true)
      for (const fn of CDP_PAGE_FUNCTIONS) {
        expect(Object.isFrozen(fn)).toBe(true)
        expect(typeof fn.throwOnSideEffect).toBe('boolean')
      }
    })

    it.each([
      ['an unregistered function', { ...ok, functionDeclaration: 'function () { return document.cookie }' }, 'function not in the registry'],
      ['a registered function with a trailing space', { ...ok, functionDeclaration: `${OUTER_HTML_CUT.source} ` }, 'function not in the registry'],
      ['userGesture true', { ...ok, userGesture: true }, 'parameter userGesture'],
      ['awaitPromise true', { ...ok, awaitPromise: true }, 'parameter awaitPromise'],
      ['throwOnSideEffect false', { ...ok, throwOnSideEffect: false }, 'parameter throwOnSideEffect'],
      ['throwOnSideEffect absent', { functionDeclaration: OUTER_HTML_CUT.source, objectId: 'obj-1' }, 'parameter throwOnSideEffect'],
      ['an execution context instead of an object', { ...ok, executionContextId: 3 }, 'unexpected parameter executionContextId'],
      ['an object argument', { ...ok, arguments: [{ objectId: 'x' }] }, 'parameter arguments'],
      ['too many arguments', { ...ok, arguments: Array.from({ length: 5 }, () => ({ value: 1 })) }, 'parameter arguments'],
      ['a foreign object group', { ...ok, objectGroup: 'page' }, 'parameter objectGroup'],
      ['generatePreview', { ...ok, generatePreview: true }, 'unexpected parameter generatePreview']
    ])('refuses %s', (_name, params, rule) => {
      expect(refusal(() => checkCdpCommand('tab', 'Runtime.callFunctionOn', params)).rule).toBe(rule)
    })
  })

  it('refuses DOM.getDocument with depth -1 or deeper than 1, and pierce', () => {
    expect(checkCdpCommand('tab', 'DOM.getDocument', { depth: 1 })).toEqual({ depth: 1 })
    expect(checkCdpCommand('tab', 'DOM.getDocument', { depth: 0 })).toEqual({ depth: 0 })
    expect(checkCdpCommand('tab', 'DOM.getDocument')).toEqual({})
    for (const params of [{ depth: -1 }, { depth: 2 }, { depth: 1, pierce: true }]) {
      expect(() => checkCdpCommand('tab', 'DOM.getDocument', params)).toThrow(CdpRefusedError)
    }
  })

  it('pins the hit test to ignorePointerEventsNone false (ADR 0007 decision 4)', () => {
    expect(checkCdpCommand('tab', 'DOM.getNodeForLocation', { x: 1, y: 2, ignorePointerEventsNone: false })).toBeTruthy()
    expect(() => checkCdpCommand('tab', 'DOM.getNodeForLocation', { x: 1, y: 2, ignorePointerEventsNone: true })).toThrow(CdpRefusedError)
    expect(() => checkCdpCommand('tab', 'DOM.getNodeForLocation', { x: 1, y: 2 })).toThrow(CdpRefusedError)
    expect(() => checkCdpCommand('tab', 'DOM.getNodeForLocation', { x: 1.5, y: 2, ignorePointerEventsNone: false })).toThrow(CdpRefusedError)
  })

  it('pins the isolated world name and refuses universal access', () => {
    expect(checkCdpCommand('tab', 'Page.createIsolatedWorld', { frameId: 'F', worldName: ISOLATED_WORLD_NAME })).toBeTruthy()
    expect(() => checkCdpCommand('tab', 'Page.createIsolatedWorld', { frameId: 'F', worldName: 'other' })).toThrow(CdpRefusedError)
    expect(() =>
      checkCdpCommand('tab', 'Page.createIsolatedWorld', { frameId: 'F', worldName: ISOLATED_WORLD_NAME, grantUniveralAccess: true })
    ).toThrow(CdpRefusedError)
  })

  it('accepts only the outline-only highlight: no fill, one quad, an RGBA outline (Q2)', () => {
    const square = [10, 10, 110, 10, 110, 40, 10, 40]
    expect(checkCdpCommand('tab', 'Overlay.highlightQuad', pickOutlineParams(square))).toBeTruthy()
    const forced = pickOutlineParams(square, { r: 0, g: 120, b: 215, a: 1 })
    expect(checkCdpCommand('tab', 'Overlay.highlightQuad', forced)).toBeTruthy()
    const outline = pickOutlineParams(square)
    for (const params of [
      { ...outline, color: { r: 160, g: 168, b: 255, a: 0.25 } },
      { ...outline, color: undefined },
      { ...outline, quad: [1, 2, 3] },
      { ...outline, quad: [...square.slice(0, 7), Number.NaN] },
      { ...outline, outlineColor: 'red' },
      { ...outline, outlineColor: { r: 0, g: 0, b: 0, a: 2 } },
      { ...outline, showInfo: true }
    ]) {
      expect(() => checkCdpCommand('tab', 'Overlay.highlightQuad', params)).toThrow(CdpRefusedError)
    }
  })

  it('pins zero network buffers', () => {
    expect(checkCdpCommand('tab', 'Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 })).toBeTruthy()
    expect(() => checkCdpCommand('tab', 'Network.enable', {})).toThrow(CdpRefusedError)
    expect(() =>
      checkCdpCommand('tab', 'Network.enable', { maxTotalBufferSize: 1, maxResourceBufferSize: 0, maxPostDataSize: 0 })
    ).toThrow(CdpRefusedError)
  })

  it('only names Erfana-known object groups when releasing', () => {
    expect(checkCdpCommand('tab', 'Runtime.releaseObjectGroup', { objectGroup: 'console' })).toBeTruthy()
    expect(() => checkCdpCommand('tab', 'Runtime.releaseObjectGroup', { objectGroup: 'x' })).toThrow(CdpRefusedError)
  })

  it.each(['Runtime.enable', 'Log.enable', 'DOM.enable', 'Debugger.resume', 'Overlay.hideHighlight'])(
    'refuses any parameter on the parameterless %s',
    method => {
      expect(checkCdpCommand('tab', method)).toEqual({})
      expect(refusal(() => checkCdpCommand('tab', method, { extra: 1 })).rule).toBe('unexpected parameter extra')
    }
  )

  it('refuses params that are not plain JSON', () => {
    expect(refusal(() => checkCdpCommand('tab', 'Runtime.enable', [] as unknown)).rule).toBe('parameters are not an object')
    expect(refusal(() => checkCdpCommand('tab', 'Runtime.enable', 'x' as unknown)).rule).toBe('parameters are not an object')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(refusal(() => checkCdpCommand('tab', 'Runtime.enable', cyclic)).rule).toBe('parameters are not plain JSON')
    expect(refusal(() => checkCdpCommand('tab', 'Emulation.setFocusEmulationEnabled', { enabled: true, f: () => 1 })).rule).toBe(
      'parameters are not plain JSON'
    )
    expect(refusal(() => checkCdpCommand('tab', 'DOM.getBoxModel', { nodeId: Number.NaN })).rule).toBe('parameters are not plain JSON')
  })

  it('sends a copy, so a later change to the caller object cannot reach the wire', () => {
    const params = { enabled: true }
    const sent = checkCdpCommand('tab', 'Emulation.setFocusEmulationEnabled', params)
    params.enabled = false
    expect(sent).toEqual({ enabled: true })
    expect(sent).not.toBe(params)
  })

  it('jsonEqual compares JSON values regardless of key order', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(jsonEqual([1, 2], [1])).toBe(false)
    expect(jsonEqual([1], { 0: 1 })).toBe(false)
    expect(jsonEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false)
    expect(jsonEqual(1, '1')).toBe(false)
  })
})

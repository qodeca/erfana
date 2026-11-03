// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The CDP method allow-list and parameter pinning (spec 025 solution design
 * § 5, 025-NFR-001 bullet 2, panel finding S23).
 *
 * One frozen rule table per session kind. A method not in the kind's table is
 * refused; a method in it is refused unless its parameters have exactly the
 * allowed keys, each of the allowed type, and every pinned value. The
 * parameters are copied before the check and the copy is what gets sent, so
 * nothing can change between check and send.
 *
 * Beyond the § 5 table: `Runtime.disable`, `Log.disable` and `Network.disable`,
 * which the flood budget needs to turn a target's logs off (§ 5, S-14). The
 * live pick highlight is `Overlay.highlightQuad` with its fill pinned to none
 * (ADR 0007 decision 6, owner decision Q2); `Overlay.highlightNode` – fill,
 * band and engine label – is not on the list.
 */
import {
  AUTO_ATTACH_PARAMS,
  CDP_OBJECT_GROUPS,
  CDP_PAGE_FUNCTIONS,
  HANG_PROBE_EVALUATE_PARAMS,
  ISOLATED_WORLD_NAME,
  NETWORK_ENABLE_PARAMS,
  NO_FILL,
  QUAD_LENGTH
} from './cdpPinned'
import { isRecord, type CdpParams } from './cdpTypes'

export type CdpSessionKind = 'tab' | 'popup'

/** Thrown for a method or parameter set the allow-list refuses. Never sent. */
export class CdpRefusedError extends Error {
  constructor(
    readonly method: string,
    readonly rule: string
  ) {
    super(`CDP command refused: ${method} (${rule})`)
    this.name = 'CdpRefusedError'
  }
}

type Pred = (value: unknown) => boolean
/** Returns null when the params pass, or the rule that refused them. */
type ParamsCheck = (params: CdpParams) => string | null

const str: Pred = v => typeof v === 'string'
const nonEmptyStr: Pred = v => typeof v === 'string' && v.length > 0
const bool: Pred = v => typeof v === 'boolean'
const int: Pred = v => Number.isSafeInteger(v)
const is =
  (expected: unknown): Pred =>
  v =>
    v === expected
const oneOf =
  (allowed: readonly unknown[]): Pred =>
  v =>
    allowed.includes(v)

/** True when `a` and `b` are equal JSON values (key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]))
  }
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]))
}

/** Exactly these keys, each passing its predicate; `optional` keys may be absent. */
function shape(required: Record<string, Pred>, optional: Record<string, Pred> = {}): ParamsCheck {
  return params => {
    for (const key of Object.keys(params)) {
      if (!Object.hasOwn(required, key) && !Object.hasOwn(optional, key)) return `unexpected parameter ${key}`
    }
    for (const [key, ok] of Object.entries(required)) {
      if (!Object.hasOwn(params, key) || !ok(params[key])) return `parameter ${key}`
    }
    for (const [key, ok] of Object.entries(optional)) {
      if (Object.hasOwn(params, key) && !ok(params[key])) return `parameter ${key}`
    }
    return null
  }
}

const noParams = shape({})

/** The params must equal `pinned` exactly. */
function pinned(value: CdpParams): ParamsCheck {
  return params => (jsonEqual(params, value) ? null : 'pinned parameters')
}

const nodeRef = { nodeId: int, backendNodeId: int, objectId: nonEmptyStr }

const rgba: Pred = v =>
  isRecord(v) &&
  shape({ r: int, g: int, b: int }, { a: v2 => typeof v2 === 'number' && v2 >= 0 && v2 <= 1 })(v) === null

/** No fill: the live highlight is an outline only (ADR 0007 decision 6, owner decision Q2). */
const noFill: Pred = v => jsonEqual(v, NO_FILL)

/** One quad: eight finite numbers. */
const quad: Pred = v => Array.isArray(v) && v.length === QUAD_LENGTH && v.every(n => typeof n === 'number' && Number.isFinite(n))

/** Primitive call arguments only: `{ value }` with a string, number, boolean or null. */
const callArguments: Pred = v =>
  Array.isArray(v) &&
  v.length <= 4 &&
  v.every(a => isRecord(a) && shape({ value: x => x === null || ['string', 'number', 'boolean'].includes(typeof x) })(a) === null)

/** A registered page function, its pinned side-effect flag, no gesture, no awaited promise. */
const callFunctionOn: ParamsCheck = params => {
  const fn = CDP_PAGE_FUNCTIONS.find(f => f.source === params.functionDeclaration)
  if (!fn) return 'function not in the registry'
  // A function pinned to `throwOnSideEffect: true` must say so; one pinned to
  // false may omit it (false is the protocol default).
  const sideEffect: Record<string, Pred> = fn.throwOnSideEffect ? { throwOnSideEffect: is(true) } : {}
  const optionalSideEffect: Record<string, Pred> = fn.throwOnSideEffect ? {} : { throwOnSideEffect: is(false) }
  return shape(
    { functionDeclaration: str, objectId: nonEmptyStr, ...sideEffect },
    {
      ...optionalSideEffect,
      arguments: callArguments,
      returnByValue: bool,
      silent: bool,
      objectGroup: oneOf(CDP_OBJECT_GROUPS),
      userGesture: is(false),
      awaitPromise: is(false)
    }
  )(params)
}

/** `DOM.getDocument` depth 0 or 1 only – never -1 (ADR 0007 decision 3). */
const shallowDepth: Pred = v => v === 0 || v === 1

const userAgentOverride = shape({ userAgent: nonEmptyStr }, { acceptLanguage: str, platform: str })

/** Rules shared by both kinds. */
const SHARED_RULES: Readonly<Record<string, ParamsCheck>> = {
  'Target.setAutoAttach': pinned(AUTO_ATTACH_PARAMS),
  'Runtime.enable': noParams,
  'Runtime.disable': noParams,
  'Runtime.runIfWaitingForDebugger': noParams,
  'Runtime.evaluate': pinned(HANG_PROBE_EVALUATE_PARAMS),
  'Runtime.releaseObjectGroup': shape({ objectGroup: oneOf(CDP_OBJECT_GROUPS) }),
  'Runtime.discardConsoleEntries': noParams,
  'Log.enable': noParams,
  'Log.disable': noParams,
  'Network.enable': pinned(NETWORK_ENABLE_PARAMS),
  'Network.disable': noParams,
  'Network.setUserAgentOverride': userAgentOverride,
  'Page.enable': noParams,
  'Page.handleJavaScriptDialog': shape({ accept: bool }, { promptText: str }),
  'Emulation.setUserAgentOverride': userAgentOverride
}

/** Tab-only rules: pick reads, highlight, focus emulation, freeze. */
const TAB_ONLY_RULES: Readonly<Record<string, ParamsCheck>> = {
  'Runtime.callFunctionOn': callFunctionOn,
  'Page.getFrameTree': noParams,
  'Page.getLayoutMetrics': noParams,
  'Page.createIsolatedWorld': shape({ frameId: nonEmptyStr, worldName: is(ISOLATED_WORLD_NAME) }, { grantUniveralAccess: is(false) }),
  'DOM.enable': noParams,
  'DOM.disable': noParams,
  'DOM.getDocument': shape({}, { depth: shallowDepth, pierce: is(false) }),
  'DOM.getNodeForLocation': shape(
    { x: int, y: int, ignorePointerEventsNone: is(false) },
    { includeUserAgentShadowDOM: bool }
  ),
  'DOM.describeNode': shape({}, { ...nodeRef, depth: shallowDepth, pierce: is(false) }),
  'DOM.getBoxModel': shape({}, nodeRef),
  'DOM.getContentQuads': shape({}, nodeRef),
  'DOM.resolveNode': shape({}, { nodeId: int, backendNodeId: int, objectGroup: oneOf(CDP_OBJECT_GROUPS), executionContextId: int }),
  'DOM.querySelectorAll': shape({ nodeId: int, selector: nonEmptyStr }),
  'DOM.getFrameOwner': shape({ frameId: nonEmptyStr }),
  'CSS.enable': noParams,
  'CSS.disable': noParams,
  'CSS.getComputedStyleForNode': shape({ nodeId: int }),
  'CSS.getMatchedStylesForNode': shape({ nodeId: int }),
  'Overlay.enable': noParams,
  'Overlay.disable': noParams,
  'Overlay.highlightQuad': shape({ quad, color: noFill, outlineColor: rgba }),
  'Overlay.hideHighlight': noParams,
  'Emulation.setFocusEmulationEnabled': shape({ enabled: bool }),
  'Debugger.enable': noParams,
  'Debugger.pause': noParams,
  'Debugger.resume': noParams,
  'Debugger.disable': noParams
}

const POPUP_METHODS = [
  'Target.setAutoAttach',
  'Runtime.enable',
  'Runtime.disable',
  'Runtime.runIfWaitingForDebugger',
  'Runtime.evaluate',
  'Runtime.releaseObjectGroup',
  'Runtime.discardConsoleEntries',
  'Log.enable',
  'Log.disable',
  'Network.enable',
  'Network.disable',
  'Network.setUserAgentOverride',
  'Page.enable',
  'Page.handleJavaScriptDialog',
  'Emulation.setUserAgentOverride'
] as const

const RULES: Readonly<Record<CdpSessionKind, ReadonlyMap<string, ParamsCheck>>> = Object.freeze({
  tab: new Map(Object.entries({ ...SHARED_RULES, ...TAB_ONLY_RULES })),
  popup: new Map(POPUP_METHODS.map(m => [m, SHARED_RULES[m]]))
})

/** The methods a session of `kind` may send, sorted (for the pinning tests). */
export function allowedMethods(kind: CdpSessionKind): readonly string[] {
  return [...RULES[kind].keys()].sort()
}

/** Domains enabled only while pick mode is on (ADR 0007 decision 2). */
export const PICK_ONLY_DOMAINS: readonly string[] = Object.freeze(['DOM', 'CSS', 'Overlay'])

/** Copies `params` as plain JSON; refuses anything that is not (functions, cycles, class instances). */
function plainCopy(method: string, params: unknown): CdpParams {
  if (params === undefined) return {}
  if (!isRecord(params)) throw new CdpRefusedError(method, 'parameters are not an object')
  try {
    const copy: unknown = JSON.parse(JSON.stringify(params))
    if (isRecord(copy) && jsonEqual(copy, params)) return copy
  } catch {
    // fall through to the refusal
  }
  throw new CdpRefusedError(method, 'parameters are not plain JSON')
}

/**
 * The params to send for `method` on a session of `kind`: a checked plain
 * copy of `params`.
 *
 * @throws CdpRefusedError when the method is not allowed for `kind`, or the
 *   params do not match its rule
 */
export function checkCdpCommand(kind: CdpSessionKind, method: string, params?: unknown): CdpParams {
  const rule = RULES[kind].get(method)
  if (!rule) throw new CdpRefusedError(method, `not allowed for the ${kind} kind`)
  const copy = plainCopy(method, params)
  const refusal = rule(copy)
  if (refusal !== null) throw new CdpRefusedError(method, refusal)
  return copy
}

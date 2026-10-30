// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page's three comment signals, checked (docs/designs/
 * html-preview-comments.md §7.3 steps 1–2, §8 page → main, §9.1 S1–S3, S7,
 * S9; tests M-033, SEC-04, SEC-05, SEC-06, SEC-09, SEC-26).
 *
 * `commentHello`, `commentPick` and `commentAnchors` arrive on the view's own
 * `webContents.ipc` from any of its frames. Nothing on them writes (§4.1 B1):
 * the most a signal can do is open a draft, a pin's threads, or change which
 * pins are "not visible now". Each is dropped – counted, and logged as a code
 * with the panel's digest – unless:
 * - it names its sender frame, and that frame is one of this view's, live;
 * - its payload passes the strict schema (`preview-comment-schema.ts`);
 * - it fits the budget: five element and pin picks per second for the whole
 *   view, three `exit` and three `parent` picks each on their own (so a burst
 *   of clicks never drops Esc), five hellos and eight anchor reports per frame
 *   – and, because the per-frame budgets are forgotten past 256 frames (a
 *   page that keeps making frames would otherwise get fresh ones), at most
 *   {@link HELLOS_PER_VIEW_PER_SECOND} hellos and
 *   {@link ANCHORS_PER_VIEW_PER_SECOND} anchor reports for the whole view;
 * - for an element pick: comment mode is on (the page's preload asks for a
 *   menu only then, so one without it is not from the preload), the frame is
 *   commentable, the token is in the load
 *   bound to THAT frame (SEC-26), the load is of the frame's own file as main
 *   recorded it at the frame's last navigation (SEC-09), and the tag the page
 *   says the tokened element has is the tag main recorded for the token
 *   (R3-13 L5) – a token moved onto another element is refused;
 * - for a `context` pick – the reader's right-click outside comment mode that
 *   the page did not cancel (OD-01) – comment mode is OFF (in the mode the
 *   preload sends `menu`), the real cursor is over the view at the point the
 *   page reports (`commentContextGate.ts`, security review L-1), and the
 *   element checks above hold: it only ever opens a menu;
 * - for a pin pick: the key is one of the frame's pins;
 * - for a keyboard-picker step that reached an element: comment mode is on,
 *   and the token passes the element pick's frame and file checks, so the
 *   tag and line the window says are main's own (security review S-L-A).
 */
import { createDropReporter, type DropReporter } from '../../../../shared/dropReporter'
import {
  CommentAnchorsSchema,
  CommentHelloSchema,
  CommentPickSchema,
  type CommentAnchors,
  type CommentPick
} from '../../../../shared/ipc/preview-comment-schema'
import { logger } from '../../LoggingService'
import { samePathKey } from '../../comments/commentUnsavedSources'
import type { CommentFrameLike, CommentFrames, FrameRecord } from './commentFrames'
import { realContextClick, type ContextGateGeometry } from './commentContextGate'
import type { PickerStepEvent } from './commentPickerSpeaker'
import type { ElementTokenEntry, ElementTokenTable } from './ElementTokenTable'

/** Element and pin picks the whole view admits per second (`PREVIEW_LIMITS.COMMENT_PICKS_PER_SECOND`). */
export const MAIN_PICKS_PER_SECOND = 5
/** `exit` and `parent` picks per second, each kind on its own budget. */
export const MAIN_CONTROL_PICKS_PER_SECOND = 3
/** Keyboard-picker `step`s per second: what the window's live region says (the preload sends at most ten). */
export const MAIN_STEPS_PER_SECOND = 12
/** Hellos one frame may send per second (the preload repeats at most once a second). */
export const HELLOS_PER_FRAME_PER_SECOND = 5
/** Anchor reports one frame may send per second (the preload sends at most four). */
export const ANCHORS_PER_FRAME_PER_SECOND = 8
/** Hellos the whole view admits per second: a page at the frame cap (50 frames) loading at once, and its repeats. */
export const HELLOS_PER_VIEW_PER_SECOND = 64
/** Anchor reports the whole view admits per second: two from every frame of a page at the frame cap, and more. */
export const ANCHORS_PER_VIEW_PER_SECOND = 128

const WINDOW_MS = 1_000
const MAX_FRAME_BUDGETS = 256

/** The event Electron hands a `webContents.ipc` listener, as far as these checks read it. */
export interface PageSignalEvent {
  readonly senderFrame?: unknown
}

/** At most `perSecond` takes in any one-second window. */
export class SlidingBudget {
  private readonly taken: number[] = []

  constructor(private readonly perSecond: number) {}

  take(now: number): boolean {
    while (this.taken.length > 0 && now - this.taken[0] >= WINDOW_MS) this.taken.shift()
    if (this.taken.length >= this.perSecond) return false
    this.taken.push(now)
    return true
  }
}

/** What a checked signal is handed to. */
export interface PageSignalSinks {
  hello(frame: CommentFrameLike): void
  /** Esc in the page, in comment mode. */
  exit(): void
  /** Alt+↑ out of a frame's `<body>`. */
  parent(frame: CommentFrameLike): void
  /** The keyboard picker moved, in comment mode: the window's live region says it. */
  step(step: PickerStepEvent): void
  icon(frame: CommentFrameLike, record: FrameRecord, pinKey: string, pick: CommentPick): void
  /** `entry` absent: the element has no tokened ancestor ("Can't comment here"). */
  element(frame: CommentFrameLike, record: FrameRecord, entry: ElementTokenEntry | undefined, pick: CommentPick): void
  anchors(frame: CommentFrameLike, record: FrameRecord, anchors: CommentAnchors): void
}

/** What the handler is built from. */
export interface PickHandlerDeps {
  readonly panelId: string
  readonly frames: CommentFrames
  readonly tokens: ElementTokenTable
  readonly now: () => number
  readonly mode: () => boolean
  readonly sinks: PageSignalSinks
  readonly platform?: NodeJS.Platform
  /** Where the view and the real cursor are, for a `context` pick (L-1); absent: every `context` pick is dropped. */
  readonly geometry?: ContextGateGeometry
}

/** The handler: one entry per page channel. Never throws. */
export interface CommentPickHandler {
  hello(event: PageSignalEvent, payload: unknown): void
  pick(event: PageSignalEvent, payload: unknown): void
  anchors(event: PageSignalEvent, payload: unknown): void
}

function dropLog(now: () => number): DropReporter {
  return createDropReporter({
    source: 'main',
    now,
    emit: ({ context }) =>
      logger.warn('Preview comments: page signal dropped', {
        reason: context.reason,
        panelId: context.panelId,
        ...(context.suppressed === undefined ? {} : { suppressed: context.suppressed })
      })
  })
}

/** The same tag, compared as the DOM and parse5 spell it. */
function sameTag(fromPage: string | undefined, recorded: string): boolean {
  return fromPage !== undefined && (fromPage === recorded || fromPage.toLowerCase() === recorded.toLowerCase())
}

/** Build one view's handler. */
export function createCommentPickHandler(deps: PickHandlerDeps): CommentPickHandler {
  const drops = dropLog(deps.now)
  const picks = new SlidingBudget(MAIN_PICKS_PER_SECOND)
  const control = { exit: new SlidingBudget(MAIN_CONTROL_PICKS_PER_SECOND), parent: new SlidingBudget(MAIN_CONTROL_PICKS_PER_SECOND) }
  const steps = new SlidingBudget(MAIN_STEPS_PER_SECOND)
  const perFrame = new Map<string, SlidingBudget>()
  const perView = { hello: new SlidingBudget(HELLOS_PER_VIEW_PER_SECOND), anchors: new SlidingBudget(ANCHORS_PER_VIEW_PER_SECOND) }

  const drop = (reason: string): void => drops.report({ reason, level: 'warn', panelId: deps.panelId })

  /** The sender, when it is a live frame of this view. */
  function senderOf(event: PageSignalEvent): CommentFrameLike | undefined {
    const sender = event?.senderFrame as CommentFrameLike | null | undefined
    if (sender === undefined || sender === null || typeof sender.frameTreeNodeId !== 'number') return undefined
    return deps.frames.frameOf(sender.frameTreeNodeId)
  }

  /** The frame's own budget first, then the view's: one frame's flood does not spend the view's. */
  function signalBudget(kind: keyof typeof perView, frame: CommentFrameLike, perSecond: number): boolean {
    return frameBudget(kind, frame, perSecond) && perView[kind].take(deps.now())
  }

  function frameBudget(kind: string, frame: CommentFrameLike, perSecond: number): boolean {
    const key = `${kind}:${frame.frameTreeNodeId}`
    let budget = perFrame.get(key)
    if (budget === undefined) {
      if (perFrame.size >= MAX_FRAME_BUDGETS) perFrame.delete(perFrame.keys().next().value as string)
      budget = new SlidingBudget(perSecond)
      perFrame.set(key, budget)
    }
    return budget.take(deps.now())
  }

  /** What `token` names in the load bound to `record`'s frame, of that frame's own file (SEC-26, SEC-09) – or why not. */
  function entryOf(record: FrameRecord, token: string): ElementTokenEntry | 'unknown-token' | 'wrong-file' {
    const entry = record.loadId === undefined ? undefined : deps.tokens.lookup(record.loadId, token)
    if (entry === undefined) return 'unknown-token'
    if (record.file === undefined || samePathKey(entry.realPath, deps.platform) !== samePathKey(record.file.realPath, deps.platform)) {
      return 'wrong-file'
    }
    return entry
  }

  function elementPick(frame: CommentFrameLike, record: FrameRecord, pick: CommentPick): void {
    if (pick.token === undefined) {
      deps.sinks.element(frame, record, undefined, pick)
      return
    }
    const entry = entryOf(record, pick.token)
    if (typeof entry === 'string') return drop(entry)
    if (!sameTag(pick.tag, entry.tagName)) return drop('tag-mismatch')
    deps.sinks.element(frame, record, entry, pick)
  }

  /** A picker step: an element is said only as main recorded it for the frame's own load (S-L-A). */
  function stepPick(frame: CommentFrameLike, pick: CommentPick): void {
    if (pick.say !== 'showing') {
      deps.sinks.step({ say: pick.say as 'top' | 'no-child' })
      return
    }
    const record = deps.frames.get(frame.frameTreeNodeId)
    if (record === undefined || !deps.frames.isCommentable(record)) return drop('not-commentable')
    // The schema puts a token on every `showing` step.
    const entry = entryOf(record, pick.token as string)
    if (typeof entry === 'string') return drop(entry)
    // C-10: the open comments on the element itself, from main's own pins.
    const comments = pick.added ? 0 : [...record.pins.values()].reduce((sum, pin) => sum + (pin.token === pick.token && pin.runtime === undefined ? pin.threadIds.length : 0), 0)
    deps.sinks.step({ say: 'showing', entry, ...(pick.added ? { added: true as const } : {}), ...(comments > 0 ? { comments } : {}) })
  }

  function route(frame: CommentFrameLike, pick: CommentPick): void {
    if (pick.kind === 'step') {
      if (!steps.take(deps.now())) return drop('rate-limited')
      if (!deps.mode()) return drop('mode-off')
      stepPick(frame, pick)
      return
    }
    if (pick.kind === 'exit' || pick.kind === 'parent') {
      if (!control[pick.kind].take(deps.now())) return drop('rate-limited')
      if (pick.kind === 'exit') {
        if (deps.mode()) deps.sinks.exit()
      } else if (frame.parent !== null) {
        deps.sinks.parent(frame)
      }
      return
    }
    if (!picks.take(deps.now())) return drop('rate-limited')
    const record = deps.frames.get(frame.frameTreeNodeId)
    if (record === undefined || !deps.frames.isCommentable(record)) return drop('not-commentable')
    if (pick.kind === 'icon') {
      const key = pick.key as string
      // A stack pin's click (C-17) names only pins main sent this frame, like its own – each once, and never itself
      // again (security review M-1: a repeated key re-ran the pin's blocks once per copy).
      const stack = [...new Set(pick.stack ?? [])].filter(other => other !== key)
      if (!record.pins.has(key) || stack.some(other => !record.pins.has(other))) return drop('unknown-pin')
      deps.sinks.icon(frame, record, key, { ...pick, stack })
      return
    }
    // A menu or open pick comes only in comment mode; a right-click outside it only out of it (OD-01).
    if (deps.mode() !== (pick.kind !== 'context')) return drop(pick.kind === 'context' ? 'mode-on' : 'mode-off')
    // L-1: a page renderer cannot pop Erfana's menu at will – the real cursor must be at the click it reports.
    if (pick.kind === 'context' && (deps.geometry === undefined || !realContextClick(pick, deps.geometry))) return drop('cursor-elsewhere')
    elementPick(frame, record, pick)
  }

  /** Run `body`, dropping instead of throwing: a listener throw is an uncaught main-process error. */
  function guarded(body: () => void): void {
    try {
      body()
    } catch (error) {
      logger.error('Preview comments: a page signal failed', undefined, {
        error: error instanceof Error ? error.name : typeof error
      })
    }
  }

  return {
    hello(event, payload) {
      guarded(() => {
        const frame = senderOf(event)
        if (frame === undefined) return drop('no-frame')
        if (!CommentHelloSchema.safeParse(payload).success) return drop('invalid-hello')
        if (!signalBudget('hello', frame, HELLOS_PER_FRAME_PER_SECOND)) return drop('rate-limited')
        deps.sinks.hello(frame)
      })
    },
    pick(event, payload) {
      guarded(() => {
        const frame = senderOf(event)
        if (frame === undefined) return drop('no-frame')
        const parsed = CommentPickSchema.safeParse(payload)
        if (!parsed.success) return drop('invalid-pick')
        route(frame, parsed.data)
      })
    },
    anchors(event, payload) {
      guarded(() => {
        const frame = senderOf(event)
        if (frame === undefined) return drop('no-frame')
        const parsed = CommentAnchorsSchema.safeParse(payload)
        if (!parsed.success) return drop('invalid-anchors')
        if (!signalBudget('anchors', frame, ANCHORS_PER_FRAME_PER_SECOND)) return drop('rate-limited')
        const record = deps.frames.get(frame.frameTreeNodeId)
        if (record === undefined) return drop('not-commentable')
        deps.sinks.anchors(frame, record, parsed.data)
      })
    }
  }
}

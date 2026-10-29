// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * When the overlay redraws, and the page-wide side effects of comment mode
 * (docs/designs/comments/html-preview-comments.md §6 status, §7.5 step 6, §10.1,
 * §10.2; tests J-006, J-016).
 *
 * - {@link RenderScheduler}: at most one render per animation frame, with a
 *   timer fallback so a view Chromium is not painting (hidden behind Erfana's
 *   chrome) still reports visibility.
 * - {@link PageWatch}: scrolling and resizing redraw at once (pins follow
 *   sticky and fixed elements); DOM and size changes re-check at most every
 *   {@link ANCHOR_CHECK_MIN_MS}. Only while something is shown or comment mode
 *   is on – a page with no pins pays nothing. Its `version` counts the page's
 *   DOM changes, so pin elements are re-resolved only after one.
 * - {@link CursorSheet}: the crosshair cursor in comment mode, through a
 *   constructable sheet on the document (a page CSP cannot block it). The
 *   sheet is in `document.adoptedStyleSheets`, where the page can read,
 *   edit or drop it – accepted: it is cosmetic, and the overlay never relies
 *   on it.
 * - {@link ScrollRestore}: the frame's own scroll after a save reload, retried
 *   for up to {@link RESTORE_BUDGET_MS} while the page grows, stopped by any
 *   user input.
 */
import { ANCHOR_CHECK_MIN_MS, RENDER_FALLBACK_MS, RESTORE_BUDGET_MS } from './constants'
import { CROSSHAIR_CSS } from './overlayStyles'

/** Coalesces render requests to one per animation frame. */
export class RenderScheduler {
  private queued = false
  private frame = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly win: Window,
    private readonly run: () => void
  ) {}

  /** Render on the next animation frame (or the fallback timer, whichever is first). */
  soon(): void {
    if (this.queued) return
    this.queued = true
    // Whichever comes first cancels the other.
    const fire = (): void => {
      this.cancel()
      this.run()
    }
    this.frame = this.win.requestAnimationFrame(fire)
    this.timer = setTimeout(fire, RENDER_FALLBACK_MS)
  }

  /** Drop a queued render. */
  cancel(): void {
    this.queued = false
    if (this.frame !== 0) this.win.cancelAnimationFrame(this.frame)
    this.frame = 0
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}

/** What {@link PageWatch} needs. */
export interface PageWatchDeps {
  readonly win: Window & typeof globalThis
  readonly doc: Document
  readonly now: () => number
}

const REDRAW_EVENTS = ['scroll', 'resize'] as const
const CHECK_EVENTS = ['transitionend', 'animationend', 'load'] as const
const PASSIVE_CAPTURE: AddEventListenerOptions = Object.freeze({ capture: true, passive: true })

/** Redraws the overlay when the page moves or changes. */
export class PageWatch {
  private on = false
  private mutations: MutationObserver | null = null
  private sizes: ResizeObserver | null = null
  private sized = new Set<Element>()
  private checkTimer: ReturnType<typeof setTimeout> | null = null
  private lastCheck = Number.NEGATIVE_INFINITY
  private changes = 0
  private readonly redraw = (): void => this.onChange()
  private readonly check = (): void => this.throttled()

  constructor(
    private readonly deps: PageWatchDeps,
    private readonly isHost: (target: Node) => boolean,
    private readonly onChange: () => void
  ) {}

  /**
   * Bumped by every batch of page mutations (and by each start and stop, when
   * nothing watched the page): what was resolved at one version holds until
   * the next.
   */
  get version(): number {
    return this.changes
  }

  /** Watch the page, or stop. */
  set(on: boolean): void {
    if (on === this.on) return
    this.on = on
    this.changes += 1
    const { win, doc } = this.deps
    if (on) {
      this.listen()
      this.mutations = new MutationObserver(records => {
        if (records.every(record => this.isOwn(record))) return
        this.changes += 1
        this.throttled()
      })
      this.mutations.observe(doc, { childList: true, subtree: true, attributes: true })
      return
    }
    for (const type of REDRAW_EVENTS) win.removeEventListener(type, this.redraw, { capture: true })
    for (const type of CHECK_EVENTS) win.removeEventListener(type, this.check, { capture: true })
    this.mutations?.disconnect()
    this.mutations = null
    this.sizes?.disconnect()
    this.sizes = null
    this.sized = new Set()
    if (this.checkTimer !== null) clearTimeout(this.checkTimer)
    this.checkTimer = null
  }

  /** Put the window listeners back after `document.open()` erased them (the observers survive it). */
  reattach(): void {
    if (this.on) this.listen()
  }

  /** Re-check when any of `elements` changes size. */
  observeSizes(elements: readonly Element[]): void {
    const View = this.deps.win
    if (!this.on || typeof View.ResizeObserver !== 'function') return
    this.sizes ??= new View.ResizeObserver(() => this.throttled())
    const next = new Set(elements)
    for (const element of this.sized) if (!next.has(element)) this.sizes.unobserve(element)
    for (const element of next) if (!this.sized.has(element)) this.sizes.observe(element)
    this.sized = next
  }

  private listen(): void {
    const { win } = this.deps
    for (const type of REDRAW_EVENTS) win.addEventListener(type, this.redraw, PASSIVE_CAPTURE)
    for (const type of CHECK_EVENTS) win.addEventListener(type, this.check, PASSIVE_CAPTURE)
  }

  /** A record about Erfana's own host only (attached, restyled). */
  private isOwn(record: MutationRecord): boolean {
    if (this.isHost(record.target)) return true
    if (record.type !== 'childList') return false
    const nodes = [...record.addedNodes, ...record.removedNodes]
    return nodes.length > 0 && nodes.every(node => this.isHost(node))
  }

  private throttled(): void {
    if (this.checkTimer !== null) return
    const wait = Math.max(0, this.lastCheck + ANCHOR_CHECK_MIN_MS - this.deps.now())
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null
      this.lastCheck = this.deps.now()
      this.onChange()
    }, wait)
  }
}

/** The crosshair cursor over the whole page in comment mode. */
export class CursorSheet {
  private sheet: CSSStyleSheet | null = null

  constructor(private readonly doc: Document) {}

  /** Add or remove the cursor rule. Skipped in a document without a window. */
  set(on: boolean): void {
    const { doc } = this
    const View = doc.defaultView
    if (View === null) return
    if (on && this.sheet === null) {
      const sheet = new View.CSSStyleSheet()
      sheet.replaceSync(CROSSHAIR_CSS)
      this.sheet = sheet
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
    } else if (!on && this.sheet !== null) {
      const sheet = this.sheet
      this.sheet = null
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(other => other !== sheet)
    }
  }

  /** Add the rule back if the document lost it (`document.open()`, or the page); nothing while off. */
  reassert(): void {
    const { doc, sheet } = this
    if (sheet === null || doc.adoptedStyleSheets.includes(sheet)) return
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
  }
}

/** Restores the frame's scroll from `commentState.restore` (§7.5 step 6, J-016). */
export class ScrollRestore {
  private target: { readonly x: number; readonly y: number } | null = null
  private startedAt = 0
  private frame = 0

  constructor(
    private readonly win: Window,
    private readonly now: () => number
  ) {}

  /** Scroll to `target`, retrying each frame while the page is still too short. */
  start(target: { readonly x: number; readonly y: number }): void {
    this.cancel()
    this.target = target
    this.startedAt = this.now()
    this.step()
  }

  /** Stop retrying (the user scrolled, typed or pressed). */
  cancel(): void {
    this.target = null
    if (this.frame !== 0 && typeof this.win.cancelAnimationFrame === 'function') {
      this.win.cancelAnimationFrame(this.frame)
    }
    this.frame = 0
  }

  private step(): void {
    const { target, win } = this
    this.frame = 0
    if (target === null || typeof win.scrollTo !== 'function') return
    win.scrollTo(target.x, target.y)
    const reached = Math.abs(win.scrollX - target.x) < 1 && Math.abs(win.scrollY - target.y) < 1
    if (reached || this.now() - this.startedAt >= RESTORE_BUDGET_MS || typeof win.requestAnimationFrame !== 'function') {
      this.target = null
      return
    }
    this.frame = win.requestAnimationFrame(() => this.step())
  }
}

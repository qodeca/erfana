// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's one host element (docs/designs/html-preview-comments.md
 * §9.1 S4, S25, §10.2 "Isolation", §19 R3-7; tests SEC-21, SEC-28, SEC-31).
 *
 * A plain `<div>` – never a custom element name, which a page could define
 * first and so run its own constructor on Erfana's host – appended to
 * `<html>`, holding a CLOSED shadow root (`host.shadowRoot === null` from the
 * page). Its own styles are inline `!important` declarations set through
 * `el.style`, which beat a page's `!important` rules; it is raised into the
 * top layer with the Popover API, which beats any `z-index`.
 *
 * The page can still remove it, move it, restyle it or `hidePopover()` it. Each
 * of those is repaired – re-attached, re-styled, re-shown – but only
 * {@link OVERLAY_REPAIRS_PER_SECOND} times in any second, whether the repair
 * comes from the host's own watch or from the next render finding the host
 * gone: a page that keeps fighting (a framework rebuilding `<html>` in a loop,
 * or a hostile page) makes the overlay give up for this document instead of
 * spinning, and the owner reports "comments unavailable". Only trusted
 * `toggle` events count, so a page cannot spend the budget with forged ones.
 *
 * The host's popover events never reach the page: the input guards stop
 * `beforetoggle` and `toggle` on the host in the window's capture phase, ahead
 * of any page listener, and hand `toggle` to {@link OverlayHost.handleToggle}.
 * A page can only cancel `showPopover()` after `document.open()` erased those
 * guards – and a show that did not take is re-tried on the same budget.
 *
 * Documented limit (S5): a page `<dialog>` or popover shown later sits above
 * the host in the top layer, and while a page modal is open the overlay is not
 * hit-testable.
 */
import { OVERLAY_REPAIRS_PER_SECOND } from './constants'

/** The host's own declarations, all `!important`. */
const HOST_STYLE: ReadonlyArray<readonly [string, string]> = [
  ['all', 'initial'],
  ['display', 'block'],
  ['position', 'fixed'],
  ['inset', '0px'],
  ['width', '100%'],
  ['height', '100%'],
  ['max-width', 'none'],
  ['max-height', 'none'],
  ['margin', '0px'],
  ['padding', '0px'],
  ['border', '0px'],
  ['background', 'transparent'],
  ['overflow', 'visible'],
  ['pointer-events', 'none'],
  ['opacity', '1'],
  ['visibility', 'visible'],
  ['transform', 'none'],
  ['filter', 'none'],
  ['clip-path', 'none'],
  ['z-index', '2147483647'],
  ['color-scheme', 'normal']
]

/** Attributes the host keeps; any other one the page adds is removed. */
const HOST_ATTRIBUTES: ReadonlySet<string> = new Set(['popover', 'style'])

const REPAIR_WINDOW_MS = 1_000

/** Whether the host is showing in the top layer; `true` when the engine cannot tell. */
function popoverOpen(host: HTMLElement): boolean {
  try {
    return host.matches(':popover-open')
  } catch {
    return true
  }
}

/** The host's dependencies. */
export interface OverlayHostDeps {
  readonly doc: Document
  readonly now: () => number
  /** The page outlasted the repair budget: the overlay is gone for this document. */
  readonly onUnavailable: () => void
}

/** One document's overlay host. */
export class OverlayHost {
  private host: HTMLElement | null = null
  private shadow: ShadowRoot | null = null
  private sheet: CSSStyleSheet | null = null
  private observer: MutationObserver | null = null
  private readonly repairs: number[] = []
  private repairQueued = false
  private lost = false
  /** Attached on purpose: a repair only restores a host that should be in the page. */
  private wanted = false
  private readonly onToggle = (event: Event): void => this.handleToggle(event)

  constructor(private readonly deps: OverlayHostDeps) {}

  /** The page outlasted the repair budget. */
  get unavailable(): boolean {
    return this.lost
  }

  /** Whether `target` is the host – what an event's path holds when it hit the overlay. */
  isHost(target: EventTarget | null): boolean {
    return target !== null && target === this.host
  }

  /** The closed shadow root, attached and shown; `null` when the overlay is unavailable or there is no `<html>` yet. */
  ensure(): ShadowRoot | null {
    if (this.lost || this.deps.doc.documentElement === null) return null
    if (this.host === null) this.create()
    // A host that should be in the page and is not was taken out by the page:
    // putting it back is a repair, on the same budget as the watch's.
    if (!this.isAttached()) {
      if (this.wanted) this.repair()
      else this.attach()
    }
    return this.lost ? null : this.shadow
  }

  /**
   * A `toggle` on the host – from the input guards, which keep it from the
   * page, or from the host's own listener when they are not there (tests).
   * A trusted close is the page's `hidePopover()`: show it again.
   */
  handleToggle(event: Event): void {
    const state = (event as Event & { readonly newState?: string }).newState
    if (event.isTrusted && state === 'closed') this.queueRepair()
  }

  /** Apply `css` to the shadow root (constructable stylesheet only). */
  setCss(css: string): void {
    if (this.sheet === null || typeof this.sheet.replaceSync !== 'function') return
    this.sheet.replaceSync(css)
  }

  /** Take the host out of the page (nothing to show). It is re-attached on the next `ensure`. */
  detach(): void {
    this.wanted = false
    this.observer?.disconnect()
    this.host?.remove()
  }

  /** Remove everything (tests). */
  dispose(): void {
    this.detach()
    this.observer = null
  }

  private create(): void {
    const { doc } = this.deps
    const host = doc.createElement('div')
    const shadow = host.attachShadow({ mode: 'closed' })
    const View = doc.defaultView
    if (View !== null && typeof View.CSSStyleSheet === 'function') {
      this.sheet = new View.CSSStyleSheet()
      shadow.adoptedStyleSheets = [this.sheet]
    }
    this.host = host
    this.shadow = shadow
    this.observer = new MutationObserver(() => this.queueRepair())
  }

  private isAttached(): boolean {
    return this.host !== null && this.host.parentNode === this.deps.doc.documentElement
  }

  /**
   * Append and style the host, watch for the page undoing any of it, then show
   * it – watched first, so whatever a page does in reaction to the show is
   * seen – and re-check that the show took.
   */
  private attach(): void {
    const host = this.host as HTMLElement
    const root = this.deps.doc.documentElement as HTMLElement
    this.observer?.disconnect()
    this.wanted = true
    // Again on every attach: `document.open()` erases it (idempotent otherwise).
    host.addEventListener('toggle', this.onToggle)
    root.appendChild(host)
    this.restyle()
    const observer = this.observer as MutationObserver
    observer.observe(this.deps.doc, { childList: true })
    observer.observe(root, { childList: true })
    observer.observe(host, { attributes: true })
    // Our own writes above are not the page's: drop their records.
    observer.takeRecords()
    this.show()
    if (!this.isAttached() || !this.shown()) this.queueRepair()
  }

  private restyle(): void {
    const host = this.host as HTMLElement
    for (const attribute of [...host.getAttributeNames()]) {
      if (!HOST_ATTRIBUTES.has(attribute)) host.removeAttribute(attribute)
    }
    host.style.cssText = ''
    for (const [name, value] of HOST_STYLE) host.style.setProperty(name, value, 'important')
    if (typeof host.showPopover === 'function') host.popover = 'manual'
  }

  /** In the top layer – or nothing to check where the engine has no Popover API. */
  private shown(): boolean {
    const host = this.host as HTMLElement
    return typeof host.showPopover !== 'function' || popoverOpen(host)
  }

  private show(): void {
    const host = this.host as HTMLElement
    if (this.shown()) return
    try {
      host.showPopover()
    } catch {
      // Refused: `attach` sees it did not take and retries on the repair
      // budget; meanwhile the fixed, max-z-index styles still draw it.
    }
  }

  /** Coalesce every signal of one task into one repair. */
  private queueRepair(): void {
    if (this.repairQueued || this.lost) return
    this.repairQueued = true
    queueMicrotask(() => {
      this.repairQueued = false
      this.repair()
    })
  }

  private needsRepair(): boolean {
    const host = this.host as HTMLElement
    if (!this.isAttached() || !this.shown()) return true
    return host.getAttributeNames().some(name => !HOST_ATTRIBUTES.has(name)) || !this.styled()
  }

  private styled(): boolean {
    const style = (this.host as HTMLElement).style
    return HOST_STYLE.every(
      ([name]) => name === 'all' || style.getPropertyPriority(name) === 'important'
    )
  }

  private repair(): void {
    this.observer?.takeRecords()
    // Not after a deliberate detach: removing a shown popover fires a trusted
    // `toggle` to `closed`, which must not put the host back.
    if (this.lost || !this.wanted || !this.needsRepair() || !this.spend()) return
    if (this.deps.doc.documentElement === null) return
    this.attach()
  }

  /** Spend one repair; `false` – and the overlay gone for this document – when the second's share is used up. */
  private spend(): boolean {
    const now = this.deps.now()
    while (this.repairs.length > 0 && now - this.repairs[0] >= REPAIR_WINDOW_MS) this.repairs.shift()
    if (this.repairs.length >= OVERLAY_REPAIRS_PER_SECOND) {
      this.lost = true
      this.detach()
      this.deps.onUnavailable()
      return false
    }
    this.repairs.push(now)
    return true
  }
}

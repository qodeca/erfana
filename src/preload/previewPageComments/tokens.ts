// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Element tokens of one document: captured and stripped at document start
 * (docs/designs/comments/html-preview-comments.md §6, §9.1 S1, §19 R3-2; tests J-011,
 * SEC-04, SEC-26, SEC-30).
 *
 * The protocol handler serves a copy whose eligible start tags carry
 * `data-erfana-el="<token>"`. A `MutationObserver` registered when the
 * preload starts – before any page script, while `document.documentElement`
 * is still `null` – sees every element the parser inserts, remembers its
 * token in isolated-world maps and removes the attribute at the next
 * microtask checkpoint, which Chromium runs before the first inline,
 * `defer` and module script (spike S1c).
 *
 * The token rule (R3-2), all the preload can enforce – no DOM API tells a
 * parser-inserted node from a script-made one:
 * - a token counts on its FIRST sighting before the preload's own
 *   `DOMContentLoaded` listener runs (`closeWindow`);
 * - a token seen on a second element in one load is void – both copies are
 *   stripped and neither is mapped (a component that copies its attributes
 *   onto an inner node, or a page replaying tokens it read);
 * - an element showing a second, different token voids both;
 * - when the window closes the observer stops: nothing can be accepted any
 *   more, so nothing is worth a callback on every later mutation. A token a
 *   script writes after load stays where the page put it and names nothing,
 *   and none voids an accepted one, so a page that forges or moves tokens
 *   after load only ever names elements nothing maps.
 *
 * Known residuals (S1c, S1d): an already-defined custom element's callbacks
 * and a page `MutationObserver` with `attributeOldValue` can read tokens. That
 * is harmless: a token is not authoritative – main re-locates the element
 * from disk at Save, and binds a load to one frame.
 */
import { MAX_TOKENS_PER_DOCUMENT, TOKEN_ATTRIBUTE, TOKEN_PATTERN } from './constants'

const TOKENED = `[${TOKEN_ATTRIBUTE}]`

/** An element and the token it was served with. */
export interface TokenedElement {
  readonly element: Element
  readonly token: string
}

/** The token maps of one document. */
export class TokenRegistry {
  private readonly byToken = new Map<string, WeakRef<Element>>()
  private readonly byElement = new WeakMap<Element, string>()
  private readonly voided = new Set<string>()
  private observer: MutationObserver | null = null

  /**
   * @param doc - The document to watch.
   * @param accepting - Whether tokens may still be accepted: true when the
   * preload starts while the document is loading (always, in a browser).
   */
  constructor(
    private readonly doc: Document,
    private accepting: boolean
  ) {}

  /** Tokens mapped right now. */
  get size(): number {
    return this.byToken.size
  }

  /** Whether the acceptance window is still open. */
  get isAccepting(): boolean {
    return this.accepting
  }

  /** Start watching, and take whatever is already in the document. */
  start(): void {
    if (this.observer !== null) return
    this.observer = new MutationObserver(records => this.process(records))
    this.observer.observe(this.doc, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [TOKEN_ATTRIBUTE]
    })
    if (this.doc.documentElement !== null) this.scan(this.doc.documentElement)
  }

  /**
   * The preload's `DOMContentLoaded` listener: take the records still queued
   * (the parser's last batch arrives just before the event, S1c), then stop
   * accepting – and watching.
   */
  closeWindow(): void {
    if (this.observer !== null) this.process(this.observer.takeRecords())
    this.accepting = false
    this.stop()
  }

  /** Stop watching (the window closed, or a test is done). */
  stop(): void {
    this.observer?.disconnect()
    this.observer = null
  }

  /** The token `element` was served with, if it was accepted and not voided. */
  tokenOf(element: Element): string | undefined {
    return this.byElement.get(element)
  }

  /** The live element a token names, if any. */
  elementOf(token: string): Element | undefined {
    const element = this.byToken.get(token)?.deref()
    return element !== undefined && element.isConnected ? element : undefined
  }

  /** `element` itself when it has a token, else its nearest ancestor that has one. */
  nearestTokened(element: Element): TokenedElement | undefined {
    for (let cur: Element | null = element; cur !== null; cur = cur.parentElement) {
      const token = this.byElement.get(cur)
      if (token !== undefined) return { element: cur, token }
    }
    return undefined
  }

  private process(records: readonly MutationRecord[]): void {
    for (const record of records) {
      if (record.type === 'attributes') {
        this.sight(record.target as Element)
        continue
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) this.scan(node as Element)
      }
    }
  }

  /** `root` and every tokened element below it. */
  private scan(root: Element): void {
    this.sight(root)
    // A parser-inserted element has no children yet; only a subtree a script
    // inserted in one go needs the query.
    if (root.firstElementChild === null) return
    for (const element of root.querySelectorAll(TOKENED)) this.sight(element)
  }

  private sight(element: Element): void {
    const token = element.getAttribute(TOKEN_ATTRIBUTE)
    if (token === null) return
    element.removeAttribute(TOKEN_ATTRIBUTE)
    if (!this.accepting || !TOKEN_PATTERN.test(token) || this.voided.has(token)) return
    const known = this.byToken.get(token)
    if (known !== undefined) {
      if (known.deref() !== element) this.void(token)
      return
    }
    const own = this.byElement.get(element)
    if (own !== undefined) {
      this.void(own)
      this.void(token)
      return
    }
    if (this.byToken.size >= MAX_TOKENS_PER_DOCUMENT) return
    this.byToken.set(token, new WeakRef(element))
    this.byElement.set(element, token)
  }

  private void(token: string): void {
    this.voided.add(token)
    const element = this.byToken.get(token)?.deref()
    if (element !== undefined) this.byElement.delete(element)
    this.byToken.delete(token)
  }
}

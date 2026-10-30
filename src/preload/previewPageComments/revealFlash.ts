// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Two small timers of the overlay (docs/designs/comments/html-preview-comments.md
 * §7.10, §10.8, §19 R3-4).
 *
 * - {@link RevealFlash}: "Show on page" highlights the element for
 *   {@link REVEAL_FLASH_MS} – a static highlight, so reduced motion needs
 *   nothing – then asks for one more render to take it away.
 * - {@link HelloRepeater}: a frame list that does not match the page's frames
 *   asks main for it again with another `commentHello`, at most once per
 *   {@link HELLO_REPEAT_MIN_MS} and {@link HELLO_REPEAT_MAX} times a document.
 */
import { COMMENT_HELLO_CHANNEL, HELLO_REPEAT_MAX, HELLO_REPEAT_MIN_MS, REVEAL_FLASH_MS } from './constants'

/** The reveal highlight of one frame. */
export class RevealFlash {
  private flash: { readonly element: Element; readonly until: number } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  /** @param ended - Called once a flash is over: render again without it. */
  constructor(
    private readonly now: () => number,
    private readonly ended: () => void
  ) {}

  /** Highlight `element`, replacing any flash still showing. */
  start(element: Element): void {
    this.flash = { element, until: this.now() + REVEAL_FLASH_MS }
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.flash = null
      this.timer = null
      this.ended()
    }, REVEAL_FLASH_MS)
  }

  /** The element highlighted now, if any. */
  current(): Element | null {
    return this.flash !== null && this.flash.until > this.now() ? this.flash.element : null
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}

/** Repeated hellos of one document. */
export class HelloRepeater {
  private hellos = 0
  private lastAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly now: () => number,
    private readonly send: (channel: string, payload: unknown) => void
  ) {}

  /** Ask main for the frame list again, when the budget allows. */
  request(): void {
    const now = this.now()
    if (this.hellos >= HELLO_REPEAT_MAX || now - this.lastAt < HELLO_REPEAT_MIN_MS) return
    this.hellos += 1
    this.lastAt = now
    this.send(COMMENT_HELLO_CHANNEL, {})
  }
}

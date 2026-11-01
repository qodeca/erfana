// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Erfana's menu outside comment mode, asked for from the page (OD-01; K-1,
 * I-18; spec 024 menu matrix § 4).
 *
 * Both routes read the page now and send a `context` pick after the dispatch,
 * only when no page listener cancelled the event: the page owns its keys and
 * its right-click. Nothing here calls `preventDefault` or stops anything.
 *
 * The key is handled on `keydown`, on every platform, because macOS fires no
 * `contextmenu` for Shift+F10. Windows and Linux fire one as well, as the
 * key's default: that one is the same press, so it sends nothing – but a page
 * that cancels it still keeps the key. Windows sends the Menu key's on its
 * release, by which time the menu is up and the keyboard is out of the page.
 *
 * Main opens the menu only for a key press it saw itself (`commentContextGate`):
 * this module is what a real press asks for, not what lets it through.
 */
import { elementPoint, contextKeyPayload, contextPayload, type PickPayload } from './picks'
import type { Point } from './geometry'
import type { TokenRegistry } from './tokens'
import type { PageWords } from './words'

/** A `contextmenu` this soon after the key is the key's own (the Menu key's lands on its release). */
const KEY_ECHO_MS = 1_000

/** What the menu reads from its frame. */
export interface PageMenuDeps {
  readonly win: Window
  readonly tokens: TokenRegistry
  readonly now: () => number
  /** The menu is Erfana's to ask for: comment mode is off, and the frame can hold comments. */
  readonly open: () => boolean
  /** The page's selected words, if any. */
  readonly words: () => PageWords | null
  /** The selection's last line, for a keyboard menu on the words. */
  readonly wordsPoint: () => Point | null
  /** What a keyboard menu with no words is about (menu matrix § 4). */
  readonly keyTarget: () => Element | null
  readonly send: (payload: PickPayload) => void
}

/** One frame's route to the menu outside comment mode. */
export class PageMenu {
  private keyAt = Number.NEGATIVE_INFINITY
  /** The `contextmenu` the last key press fired as its default. */
  private echo: Event | null = null

  constructor(private readonly deps: PageMenuDeps) {}

  /** A trusted Shift+F10 or Menu key press. */
  key(event: KeyboardEvent): void {
    const { deps } = this
    if (!deps.open()) return
    const words = deps.words()
    const element = words?.target ?? deps.keyTarget()
    if (element === null) return
    this.keyAt = deps.now()
    this.echo = null
    const point = (words === null ? null : deps.wordsPoint()) ?? elementPoint(element)
    const payload = contextKeyPayload(deps.tokens, element, words, point, deps.win)
    setTimeout(() => {
      if (!event.defaultPrevented && this.echo?.defaultPrevented !== true) deps.send(payload)
    }, 0)
  }

  /** A trusted `contextmenu`: a right-click, or the key's own echo. */
  contextMenu(event: MouseEvent): void {
    const { deps } = this
    if (!deps.open() || !(event.target instanceof Element)) return
    if (deps.now() - this.keyAt < KEY_ECHO_MS) {
      this.echo = event
      return
    }
    const payload = contextPayload(deps.tokens, event.target, event, deps.words(), deps.win)
    setTimeout(() => {
      if (!event.defaultPrevented) deps.send(payload)
    }, 0)
  }
}

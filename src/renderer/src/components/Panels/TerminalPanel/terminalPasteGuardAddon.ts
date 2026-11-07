// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The paste guard on the paths xterm handles itself (spec 025, 025-FR-009,
 * S-17): a native `paste` event on the terminal (the app menu's Paste, a
 * middle click on Linux) and text dropped on it from outside Erfana's window.
 * The keyboard and context-menu paste go through `useTerminalClipboard`,
 * which applies the same guard before `xterm.paste`.
 *
 * An xterm addon, so it lives and dies with one terminal instance: loaded
 * after `open()` (it needs `terminal.element`), disposed with the terminal.
 * Text that needs no check passes untouched; text that does is held, the
 * guard asks, and it is typed with `terminal.paste` (bracketed, as xterm's
 * own paste) only after a yes.
 *
 * @module TerminalPanel/terminalPasteGuardAddon
 */
import type { ITerminalAddon, Terminal } from '@xterm/xterm'
import { needsPasteCheck, type TerminalTextSource } from '../../../utils/terminalPasteGuard'
import { logger } from '../../../utils/logger'

/** Resolves `true` when the text may be typed. */
export type TerminalTextGuard = (text: string, source: TerminalTextSource) => Promise<boolean>

const CAPTURE = { capture: true } as const

function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') === true
}

export class TerminalPasteGuardAddon implements ITerminalAddon {
  private readonly removers: Array<() => void> = []
  /** A drag started in Erfana's own document; its drop is left alone. */
  private internalDrag = false

  constructor(
    private readonly guard: TerminalTextGuard,
    private readonly doc: Document = document
  ) {}

  activate(terminal: Terminal): void {
    const element = terminal.element
    if (element === undefined) return
    const typeIfAllowed = (text: string, source: TerminalTextSource): void => {
      this.guard(text, source)
        .then(ok => {
          if (ok) terminal.paste(text)
        })
        .catch((error: unknown) => {
          logger.warn('Terminal paste guard failed', { error: error instanceof Error ? error.message : String(error) })
        })
    }

    this.listen(element, 'paste', (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!needsPasteCheck(text)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      typeIfAllowed(text, 'paste')
    })
    this.listen(this.doc, 'dragstart', () => {
      this.internalDrag = true
    })
    this.listen(this.doc, 'dragend', () => {
      this.internalDrag = false
    })
    this.listen(element, 'dragover', (event: DragEvent) => {
      const transfer = event.dataTransfer
      if (this.internalDrag || isFileDrag(event) || transfer?.types.includes('text/plain') !== true) return
      event.preventDefault()
      transfer.dropEffect = 'copy'
    })
    this.listen(element, 'drop', (event: DragEvent) => {
      const internal = this.internalDrag
      this.internalDrag = false
      if (internal || isFileDrag(event)) return
      const text = event.dataTransfer?.getData('text/plain') ?? ''
      if (text === '') return
      event.preventDefault()
      event.stopPropagation()
      terminal.focus()
      typeIfAllowed(text, 'externalDrop')
    })
  }

  dispose(): void {
    for (const remove of this.removers.splice(0)) remove()
  }

  private listen<E extends Event>(target: EventTarget, type: string, listener: (event: E) => void): void {
    const handler = listener as EventListener
    target.addEventListener(type, handler, CAPTURE)
    this.removers.push(() => target.removeEventListener(type, handler, CAPTURE))
  }
}

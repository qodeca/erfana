// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Browser keys on Erfana's own window while a browser tab's toolbar has
 * keyboard focus (spec 025, 025-FR-050, 025-FR-051; ADR 0011 decision 13;
 * solution design § 7).
 *
 * With focus in the tab's own controls (address bar, find bar, toolbar
 * buttons, and the tab's Erfana surfaces) the keys go to Erfana's renderer,
 * where the application menu's accelerators also act: Ctrl/Cmd+R would
 * reload Erfana's window and the zoom keys would zoom it. The renderer tells
 * main which tab holds toolbar focus (`browser-tab:toolbarFocus`); while one
 * does, this `before-input-event` listener on Erfana's window consumes every
 * browser key – so neither the menu nor the renderer's own shortcuts see it –
 * and hands the ones the tab's routing state lets act to that tab
 * ({@link ToolbarKeyTarget}). The menu's force-reload (Ctrl/Cmd+Shift+R) is
 * consumed too. Every other key – typing, Esc, Tab, the reserved keys, the
 * Edit roles – passes to the renderer and the menu unchanged.
 */
import { isKeyPress, matchBrowserKey, type BrowserKeyInput } from '../../../../shared/browser/browserKeys'
import { ConsumedKeys, type PreventableEvent } from './browserKeyRouter'

/** The tab whose toolbar has focus: acts on a browser key, or says it does nothing here. */
export interface ToolbarKeyTarget {
  /**
   * Act on browser key `input` in the tab's current routing state.
   * @returns whether the key acted (false: it does nothing in this state)
   */
  toolbarBrowserKey(input: BrowserKeyInput): boolean
}

/** The part of Erfana window's `webContents` the listener needs. */
export interface AppWindowContents {
  on(event: 'before-input-event', listener: (event: PreventableEvent, input: BrowserKeyInput) => void): unknown
  removeListener(
    event: 'before-input-event',
    listener: (event: PreventableEvent, input: BrowserKeyInput) => void
  ): unknown
}

/** The View menu's force reload: Ctrl/Cmd+Shift+R. Not a browser key, but it would reload Erfana. */
export function isAppMenuForceReload(input: BrowserKeyInput, platform: string): boolean {
  if (!isKeyPress(input) || input.alt || !input.shift) return false
  const mac = platform === 'darwin'
  const primary = mac ? input.meta : input.control
  const other = mac ? input.control : input.meta
  return primary && !other && (input.key.toLowerCase() === 'r' || input.code === 'KeyR')
}

export class AppWindowBrowserKeys {
  private target: ToolbarKeyTarget | null = null
  private readonly consumed = new ConsumedKeys()
  private readonly listener = (event: PreventableEvent, input: BrowserKeyInput): void => this.handle(event, input)

  constructor(
    private readonly contents: AppWindowContents,
    private readonly platform: string
  ) {
    contents.on('before-input-event', this.listener)
  }

  /** The tab whose toolbar now has focus, or `null` when none does. */
  setTarget(target: ToolbarKeyTarget | null): void {
    // Held keys stay remembered: their key-ups still arrive on this window.
    this.target = target
  }

  /** Clear the target if it is `target` (its toolbar lost focus, or the tab closed). */
  clearTarget(target: ToolbarKeyTarget): void {
    if (this.target === target) this.setTarget(null)
  }

  /** Whether some tab's toolbar has focus in this window. */
  hasTarget(): boolean {
    return this.target !== null
  }

  dispose(): void {
    this.target = null
    this.contents.removeListener('before-input-event', this.listener)
  }

  private handle(event: PreventableEvent, input: BrowserKeyInput): void {
    if (this.consumed.isFollowUp(input)) {
      event.preventDefault()
      return
    }
    const target = this.target
    if (target === null || !isKeyPress(input)) return
    const isBrowserKey = matchBrowserKey(input, this.platform) !== null
    if (!isBrowserKey && !isAppMenuForceReload(input, this.platform)) return
    event.preventDefault()
    this.consumed.remember(input)
    if (isBrowserKey) target.toolbarBrowserKey(input)
  }
}

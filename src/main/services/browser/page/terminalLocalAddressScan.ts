// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Local addresses printed in the project's terminals this session, for the
 * empty browser tab (spec 025, 025-FR-063; solution design § 3.5
 * `terminalLocalAddressScan`).
 *
 * A dev server prints where it listens – `http://localhost:5173/`,
 * `http://127.0.0.1:8000` – and the empty tab lists those addresses. Only
 * `http` and `https` addresses on `localhost` and `127.0.0.1` count; terminal
 * colour and hyperlink escape sequences are removed first, and trailing
 * punctuation that ends a sentence is not part of the address. Output arrives
 * in chunks, so the unfinished last line of each terminal is carried into its
 * next chunk (at most {@link CARRY_MAX_CHARS}).
 *
 * Nothing is stored: the list lasts for this run and resets when the project
 * changes. At most {@link MAX_LOCAL_ADDRESSES} are kept, first seen first.
 */

export const MAX_LOCAL_ADDRESSES = 20
/** Longest unfinished line carried from one chunk to the next. */
export const CARRY_MAX_CHARS = 512
/** Longest address kept: the notice text cap (`BROWSER_TEXT_MAX_CHARS`). */
const MAX_ADDRESS_CHARS = 2000

/** CSI and OSC escape sequences (colours, cursor moves, terminal hyperlinks). */
// eslint-disable-next-line no-control-regex -- terminal escape sequences are control characters by definition
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g
const ADDRESS = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?(?:[/?#][^\s"'<>`]*)?/gi
/** Characters that end a sentence or close a bracket rather than end an address. */
const TRAILING = /[.,;:!?)\]}]+$/

/** The local addresses in `text`, in order, normalised by the URL parser. */
export function findLocalAddresses(text: string): string[] {
  const found: string[] = []
  for (const match of text.replace(ESCAPES, '').matchAll(ADDRESS)) {
    const candidate = match[0].replace(TRAILING, '')
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      continue
    }
    if (parsed.port !== '' && Number(parsed.port) > 65_535) continue
    if (parsed.href.length <= MAX_ADDRESS_CHARS) found.push(parsed.href)
  }
  return found
}

/** The addresses seen in one project's terminals this run. */
export class TerminalLocalAddresses {
  private readonly seen = new Set<string>()
  private readonly carry = new Map<string, string>()

  /**
   * Scan one chunk of `terminalId`'s output.
   *
   * @returns the addresses seen for the first time, in order
   */
  scan(terminalId: string, chunk: string): string[] {
    const text = (this.carry.get(terminalId) ?? '') + chunk
    const lastBreak = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'))
    const complete = lastBreak < 0 ? '' : text.slice(0, lastBreak + 1)
    this.carry.set(terminalId, text.slice(lastBreak + 1).slice(-CARRY_MAX_CHARS))
    const fresh: string[] = []
    for (const address of findLocalAddresses(complete)) {
      if (this.seen.has(address) || this.seen.size >= MAX_LOCAL_ADDRESSES) continue
      this.seen.add(address)
      fresh.push(address)
    }
    return fresh
  }

  /** The terminal closed: drop its unfinished line. */
  terminalGone(terminalId: string): void {
    this.carry.delete(terminalId)
  }

  /** Every address seen, first seen first. */
  list(): string[] {
    return [...this.seen]
  }

  /** The project changed: start over. */
  reset(): void {
    this.seen.clear()
    this.carry.clear()
  }
}

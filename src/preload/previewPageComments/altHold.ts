// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether Alt (Option) is held in this document – the floating label shows the
 * element's pixel size ("86×34") only while it is (comments-v2 C-21;
 * differences table D-05).
 *
 * Internal to the page preload: set from the guards' own trusted key and
 * pointer events (`input.ts`), read by the overlay view. Nothing here is sent
 * to main or reachable from the page (PIN-S unchanged).
 */

const held = new WeakMap<Document, boolean>()

/**
 * Record whether Alt is held.
 *
 * @param doc - The document the event reached.
 * @param on - The event's `altKey`.
 * @returns `true` when that changed what the label shows.
 */
export function setAltHeld(doc: Document, on: boolean): boolean {
  if ((held.get(doc) ?? false) === on) return false
  held.set(doc, on)
  return true
}

/** Whether Alt is held in `doc` now. */
export function isAltHeld(doc: Document): boolean {
  return held.get(doc) ?? false
}

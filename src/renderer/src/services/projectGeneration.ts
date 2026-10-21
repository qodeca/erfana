// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project session generation this window last saw in a `project:changed`
 * event. A close the renderer starts on its own (the project folder vanished)
 * sends it along, so the main process ignores that close if a newer project
 * has been opened since.
 */

let lastSeenGeneration: number | undefined

export function noteProjectGeneration(generation: number | undefined): void {
  if (generation !== undefined) lastSeenGeneration = generation
}

export function getLastSeenProjectGeneration(): number | undefined {
  return lastSeenGeneration
}

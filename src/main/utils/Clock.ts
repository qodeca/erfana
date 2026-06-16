// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
export interface Clock {
  now(): number
  nowIso(): string
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString()
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared smoke-check types (SD-019, issue #19 — Wave A).
 *
 * Lives outside the sqlite worker + MCP smoke modules so the two spike
 * concerns stay orthogonal (better-sqlite3 for #23, MCP SDK for #30) and can
 * be reused independently without one importing the other's module.
 *
 * @see specs/designs/sd-019-native-dep-spike.md §5
 */

/**
 * One named assertion run by a smoke module. `detail` carries the empirical
 * value (a path, a row count, an advertised-tool list).
 *
 * `informational` marks a check whose `passed` is an **empirical observation
 * recorded either way**, not a pass/fail gate — it MUST NOT be able to red a
 * required CI check. `sqlite:prebuild-path` is the sole current example: it
 * records which `.node` resolved (SD-019 §2 [F6] / §5) without gating on the
 * `prebuilds/` vs `build/Release/` distinction.
 */
export interface SmokeCheck {
  name: string
  passed: boolean
  detail?: string
  informational?: boolean
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Playwright reporter that emits a single user-visible audit line at the
 * end of every run, listing which capabilities are intentionally gated
 * off (`SKIPPED CAPABILITIES: …`) versus enabled.
 *
 * Why this exists. Some Playwright projects in this repo are gated on
 * env opt-ins because they make real (paid) API calls (`transcription`
 * gated on `ERFANA_E2E_TRANSCRIPTION=1`). Before this reporter the
 * gating was a `test.skip(!OPENAI_API_KEY, …)` inside the test file —
 * skipped tests show up as a green tick in `list` output and downstream
 * dashboards interpret skipped as passing. A regression in the un-keyed
 * code path can ship with zero CI signal. This reporter consolidates
 * the gate state into one grep-friendly line so the gap is auditable.
 *
 * The capability list is intentionally hard-coded — adding a capability
 * means adding an env-gated project plus a row here. That coupling is
 * the point: a new gated capability can't slip in without surfacing.
 */

import type { Reporter, FullResult } from '@playwright/test/reporter'

interface Capability {
  name: string
  enabledWhen: () => boolean
  hint: string
}

const CAPABILITIES: Capability[] = [
  {
    name: 'transcription',
    enabledWhen: () => process.env.ERFANA_E2E_TRANSCRIPTION === '1',
    hint: 'set ERFANA_E2E_TRANSCRIPTION=1 and provide OPENAI_API_KEY'
  }
]

export default class CapabilitySummaryReporter implements Reporter {
  onEnd(_result: FullResult): void {
    const enabled = CAPABILITIES.filter((c) => c.enabledWhen()).map((c) => c.name)
    const skipped = CAPABILITIES.filter((c) => !c.enabledWhen())
    if (skipped.length === 0) {
      console.log(`\n[capability-summary] all capabilities enabled (${enabled.join(', ') || 'none defined'})`)
      return
    }
    const lines = [
      `\n[capability-summary] SKIPPED CAPABILITIES: ${skipped.map((c) => c.name).join(', ')}`,
      ...skipped.map((c) => `[capability-summary]   ${c.name} — ${c.hint}`)
    ]
    if (enabled.length > 0) {
      lines.push(`[capability-summary] enabled: ${enabled.join(', ')}`)
    }
    console.log(lines.join('\n'))
  }
}

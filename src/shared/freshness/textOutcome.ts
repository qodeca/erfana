// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Map a classified text read (`file-watch:readText`) to the outcome a tracker
 * acts on (#478, plan decision 31): a content refusal blocks the tab, a
 * failure is retried, `missing` and `busy` pass through.
 *
 * @module shared/freshness/textOutcome
 */
import type { Eol, ReadOutcome, TextReadReply } from './freshnessTypes'

/** The text, with the line ending it was read with. */
export interface TextVersion {
  readonly text: string
  readonly eol: Eol
}

export function textReadOutcome(reply: TextReadReply): ReadOutcome<TextVersion> {
  switch (reply.status) {
    case 'ok':
      return { status: 'ok', version: { text: reply.text, eol: reply.eol }, stamp: reply.stamp }
    case 'too-large':
    case 'binary':
    case 'unsupported-encoding':
    case 'outside-project':
      return { status: 'blocked', reason: reply.status }
    case 'missing':
    case 'busy':
      return { status: reply.status }
    case 'unreadable':
    case 'unsupported':
      return { status: 'failed' }
  }
}

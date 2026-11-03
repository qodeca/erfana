// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyring notices of a project's first browser tab in this run (spec 025,
 * 025-FR-018; design deck *Keyring*; commit 18).
 *
 * `BrowserProfileService.takeKeyringNotices` hands the notices out once per
 * project and run, so only the first tab ever shows them. They are strip rows
 * of kind `keyring` with one answer, **Dismiss**, and the strip's input guard
 * (`dialogs/guardedStripRow.ts`). One row per kind (025-FR-054), so with both
 * notices due the reset notice shows first and the weak-protection notice
 * takes the row once it is dismissed.
 *
 * - **Weak protection** (Linux without a keyring): shown after each start until
 *   dismissed; **Dismiss** records that in the project, so it never shows there
 *   again.
 * - **Keyring reset**: "Logins were reset because the keyring changed.", once.
 */
import type { Clock } from '../../../../shared/clock'
import type { StripAnswer, StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { redactedLogError } from '../../../utils/redactUserInput'
import { logger } from '../../LoggingService'
import type { KeyringNotices } from '../browserKeyringState'
import { GuardedStripRow } from '../dialogs/guardedStripRow'
import type { AnswerResult } from '../permissions/tabStrip'

/** The weak-protection notice, as the deck writes it (names the sign-in box's checkbox exactly). */
export const KEYRING_WEAK_TEXT =
  'No keyring – cookies and other site data on this computer are stored with weak protection, and Remember for this project ' +
  "isn't available. Set up a keyring such as GNOME Keyring to protect them."
/** The reset notice: the spec-fixed sentence with its full stop, then the next step. */
export const KEYRING_RESET_TEXT = 'Logins were reset because the keyring changed. Sign in to your sites again.'

type Notice = 'reset' | 'weak'

/** What the keyring notices need from the app. */
export interface KeyringStripSetup {
  readonly clock: Pick<Clock, 'now'>
  /** `BrowserProfileService.takeKeyringNotices`: the notices once per project and run. */
  readonly take: () => Promise<KeyringNotices>
  /** `BrowserProfileService.dismissWeakProtectionNotice`. */
  readonly dismissWeak: () => Promise<void>
  readonly newId?: () => string
}

export class KeyringStrip {
  private readonly row: GuardedStripRow
  private queue: Notice[] = []
  private shown: Notice | null = null
  private detached = false

  constructor(
    tabId: string,
    emit: (event: StripEvent) => void,
    private readonly setup: KeyringStripSetup
  ) {
    this.row = new GuardedStripRow({ tabId, clock: setup.clock, emit, newId: setup.newId })
  }

  /** Ask for the project's notices and show the first; resolves once that is decided. Never rejects. */
  async start(): Promise<void> {
    try {
      const notices = await this.setup.take()
      if (this.detached) return
      this.queue = [...(notices.keyringReset ? ['reset' as const] : []), ...(notices.weakProtection ? ['weak' as const] : [])]
      this.next()
    } catch (error) {
      logger.warn('Browser keyring notices could not be read', { error: redactedLogError(error)?.message ?? String(error) })
    }
  }

  /** A strip answer; `null` when `requestId` is not this row. */
  answer(requestId: string, answer: StripAnswer): AnswerResult | null {
    return this.row.answer(requestId, answer, () => {
      const dismissed = this.shown
      this.shown = null
      if (dismissed === 'weak') {
        this.setup.dismissWeak().catch((error: unknown) => {
          logger.warn('Browser keyring notice dismissal was not recorded', { error: redactedLogError(error)?.message ?? String(error) })
        })
      }
      this.next()
    })
  }

  /** The tab closed: the row goes and nothing more shows. */
  detach(): void {
    this.detached = true
    this.queue = []
    this.shown = null
    this.row.hide()
  }

  private next(): void {
    const notice = this.queue.shift()
    if (notice === undefined) return
    this.shown = notice
    this.row.show({
      kind: 'keyring',
      text: notice === 'reset' ? KEYRING_RESET_TEXT : KEYRING_WEAK_TEXT,
      answers: ['dismiss'],
      takesFocus: false
    })
  }
}

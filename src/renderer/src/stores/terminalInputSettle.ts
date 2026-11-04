// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * When to press Enter after pasting a prompt into a terminal (#449).
 *
 * The program in the terminal reads a paste in pieces – on Windows ConPTY hands
 * it over about 1 KiB per read, and slower still on a loaded machine. Enter
 * written on a fixed timer then sits in the input queue behind the rest of the
 * paste and reaches the program in the same read as the paste's last piece. An
 * agent's prompt box takes a carriage return that shares a read with pasted
 * text for a line break in that text, so the prompt was pasted but never sent.
 *
 * A person waits until the paste has appeared before pressing Enter; this does
 * the same. The program redraws as each piece arrives, so the terminal's output
 * shows the paste being taken. Enter goes once that output has gone quiet for
 * twice the longest pause seen while the paste was coming in (so a slow,
 * stop-start delivery is not mistaken for the end), and never sooner than the
 * old fixed delay. A program that never draws anything, or never goes quiet (a
 * spinner, told apart from a slow paste by its short pauses), still gets its
 * Enter after a cap; a slow paste is only cut short by a hard limit.
 */

/** Never press Enter sooner than this after the paste (the previous fixed delay). */
export const ENTER_MIN_DELAY_MS = 200
/** Quiet time that always counts as "the paste has been taken", whatever the pauses. */
export const ENTER_MIN_QUIET_MS = 400
/**
 * With no output at all after the paste, press Enter after this long. Generous
 * because on a loaded Windows host the first piece of a paste can take seconds.
 */
export const ENTER_NO_OUTPUT_DELAY_MS = 3000
/**
 * Output that never pauses longer than ENTER_MIN_QUIET_MS (a spinner, not a
 * paste arriving in pieces) gets its Enter after this long.
 */
export const ENTER_MAX_DELAY_MS = 8000
/** Press Enter after this long whatever the output does (a paste arriving very slowly). */
export const ENTER_HARD_MAX_DELAY_MS = 60_000
/** How often the terminal's output time is read while waiting. */
export const ENTER_POLL_MS = 50

/** Why the wait ended – logged, and asserted on by the tests. */
export type InputSettleReason = 'settled' | 'no-output' | 'cap'

/**
 * Resolve once it is time to press Enter after a paste written at `writtenAt`.
 *
 * @param lastOutputAt - Time of the terminal's latest output, or undefined if it has printed nothing
 * @param writtenAt - `Date.now()` just after the paste was written
 */
export async function waitForInputToSettle(
  lastOutputAt: () => number | undefined,
  writtenAt: number
): Promise<InputSettleReason> {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  let previousOutput = writtenAt
  let longestPause = 0
  await sleep(ENTER_MIN_DELAY_MS)

  for (;;) {
    const now = Date.now()
    const elapsed = now - writtenAt
    const last = lastOutputAt()
    const answered = last !== undefined && last > writtenAt

    if (answered && last > previousOutput) {
      longestPause = Math.max(longestPause, last - previousOutput)
      previousOutput = last
    }

    if (answered && now - last >= Math.max(ENTER_MIN_QUIET_MS, 2 * longestPause)) return 'settled'
    if (!answered && elapsed >= ENTER_NO_OUTPUT_DELAY_MS) return 'no-output'
    // Short pauses only: a spinner, which would never go quiet. Long pauses: a
    // paste still arriving in pieces, which the quiet rule above waits out
    const cap = longestPause > ENTER_MIN_QUIET_MS ? ENTER_HARD_MAX_DELAY_MS : ENTER_MAX_DELAY_MS
    if (elapsed >= cap) return 'cap'

    await sleep(ENTER_POLL_MS)
  }
}

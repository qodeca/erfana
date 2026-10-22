// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer half of terminal flow control (lens review finding [30]).
 *
 * Every batch of output is written with `xterm.write(data, callback)`; the
 * callback fires once xterm has parsed it. The parsed amounts are added up here
 * and reported to main (`terminal:ackOutput`) once per
 * {@link TERMINAL_OUTPUT_ACK_STEP_CHARS}, so a flood costs one ack per 32 KiB
 * instead of one per batch. Main pauses the PTY while too much is unreported
 * and resumes it as the acks come in (`src/main/services/terminalOutputFlow.ts`).
 *
 * A hidden window acks on receipt instead. Chromium throttles timers in a
 * minimised or covered window, and xterm parses in timer slices, so acks
 * after the parse would pause a build or an agent that runs in the background.
 * Output that arrives while hidden is reported at once (as before flow
 * control existed), and when the window becomes hidden everything still being
 * parsed is reported too ({@link OutputAcker.releaseInFlight}); the parse
 * callbacks of those writes then report nothing, so each character is
 * acknowledged exactly once and the counts on both sides stay equal.
 *
 * The remainder below one step is not reported while the terminal runs: the
 * main-side low watermark is above the step, so it cannot hold a PTY paused.
 * `releaseInFlight()` reports it, and is also called when the panel stops
 * listening.
 */
import { TERMINAL_OUTPUT_ACK_STEP_CHARS } from '../../../../../shared/ipc/terminal-schema'

export interface OutputAcker {
  /**
   * Accounts for one batch of `chars` characters. Returns the callback to pass
   * to `xterm.write`, or `undefined` when the batch was acknowledged on
   * receipt (`hidden`).
   */
  received(chars: number, hidden: boolean): (() => void) | undefined
  /**
   * Acknowledges everything written and not yet parsed, plus the unreported
   * remainder, now. Pending parse callbacks then report nothing.
   */
  releaseInFlight(): void
}

export function createOutputAcker(
  terminalId: string,
  send: (terminalId: string, chars: number) => void,
  step: number = TERMINAL_OUTPUT_ACK_STEP_CHARS
): OutputAcker {
  /** Parsed (or acked-on-receipt) and not yet reported. */
  let counted = 0
  /** Written to xterm, parse callback still pending. */
  let inFlight = 0
  /** Bumped by `releaseInFlight`, so older callbacks know they were reported. */
  let epoch = 0

  const report = (): void => {
    if (counted <= 0) return
    const chars = counted
    counted = 0
    send(terminalId, chars)
  }
  const count = (chars: number): void => {
    counted += chars
    if (counted >= step) report()
  }

  return {
    received(chars, hidden) {
      if (hidden) {
        count(chars)
        return undefined
      }
      inFlight += chars
      const mine = epoch
      return () => {
        if (mine !== epoch) return
        inFlight -= chars
        count(chars)
      }
    },
    releaseInFlight() {
      counted += inFlight
      inFlight = 0
      epoch++
      report()
    }
  }
}

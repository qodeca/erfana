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
 * The remainder below one step is never reported while the terminal runs: the
 * main-side low watermark is above the step, so it cannot hold a PTY paused.
 * `flush()` reports it anyway when the panel stops listening.
 */
import { TERMINAL_OUTPUT_ACK_STEP_CHARS } from '../../../../../shared/ipc/terminal-schema'

export interface OutputAcker {
  /** Counts `chars` characters that xterm has finished parsing. */
  parsed(chars: number): void
  /** Reports whatever is counted and not yet reported. */
  flush(): void
}

export function createOutputAcker(
  terminalId: string,
  send: (terminalId: string, bytes: number) => void,
  step: number = TERMINAL_OUTPUT_ACK_STEP_CHARS
): OutputAcker {
  let counted = 0
  const flush = (): void => {
    if (counted <= 0) return
    const bytes = counted
    counted = 0
    send(terminalId, bytes)
  }
  return {
    parsed(chars) {
      counted += chars
      if (counted >= step) flush()
    },
    flush
  }
}

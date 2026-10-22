// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Output batching and flow control for one terminal.
 *
 * node-pty hands over output in small chunks (often a few hundred characters),
 * and one IPC message per chunk swamps the renderer when a program floods the
 * terminal. This module collects the chunks and sends them as one message
 * every {@link TERMINAL_OUTPUT_FLUSH_MS}, or at once when
 * {@link TERMINAL_OUTPUT_BATCH_MAX_CHARS} have built up.
 *
 * Flow control follows the xterm.js guide
 * (https://xtermjs.org/docs/guides/flowcontrol/): the renderer reports how much
 * output xterm has parsed (`terminal:ackOutput`), and above
 * {@link TERMINAL_OUTPUT_HIGH_WATERMARK} unparsed characters the PTY is paused,
 * so the program blocks on its own writes instead of the app buffering without
 * bound. It resumes below {@link TERMINAL_OUTPUT_LOW_WATERMARK}.
 *
 * Amounts are counted in UTF-16 code units (`string.length`) on both sides,
 * which is cheap and consistent; the wire field is still called `bytes`.
 *
 * Nothing is ever dropped or reordered here: every chunk goes out in the order
 * it arrived, `flush()` runs before the exit event is sent, and `dispose()`
 * flushes and resumes a paused PTY so a killed or orphaned shell is never left
 * blocked.
 */

/** Longest a chunk waits before it is sent (one frame at 120 Hz). */
export const TERMINAL_OUTPUT_FLUSH_MS = 8

/** Output that is sent at once instead of waiting for the timer (64 KiB). */
export const TERMINAL_OUTPUT_BATCH_MAX_CHARS = 64 * 1024

/** Unacknowledged output above which the PTY is paused (512 KiB). */
export const TERMINAL_OUTPUT_HIGH_WATERMARK = 512 * 1024

/**
 * Unacknowledged output below which a paused PTY resumes (128 KiB). Kept above
 * the renderer's ack step (`TERMINAL_OUTPUT_ACK_STEP_CHARS`), so the part the
 * renderer has parsed but not yet reported can never hold the PTY paused.
 */
export const TERMINAL_OUTPUT_LOW_WATERMARK = 128 * 1024

/**
 * A pause with no ack for this long is lifted (5 s). A renderer that stops
 * acknowledging (a panel that unmounted without killing its terminal, a
 * reload) must not freeze the program in the terminal for good; the count is
 * reset and flow control starts over.
 */
export const TERMINAL_OUTPUT_STALL_MS = 5_000

/**
 * How often a paused PTY checks that its shell is still alive (50 ms). On
 * POSIX node-pty waits for the output socket to close before it reports an
 * exit, and destroys the socket 200 ms after the shell died. A socket that is
 * still paused then would lose what it holds, so the pause is lifted as soon
 * as the shell is gone and the rest drains well inside that window.
 */
export const TERMINAL_OUTPUT_EXIT_POLL_MS = 50

export interface TerminalOutputFlowOptions {
  /** Sends one batch to the renderer. */
  emit: (data: string) => void
  /**
   * Pauses and resumes the PTY. Left out where pausing is not used (Windows),
   * in which case output is only batched.
   */
  pause?: () => void
  resume?: () => void
  /** Whether the shell is still running; checked while paused. */
  isAlive?: () => boolean
}

export class TerminalOutputFlow {
  private pending = ''
  private flushTimer: NodeJS.Timeout | undefined
  /** Characters sent and not yet acknowledged by the renderer. */
  private unacked = 0
  private paused = false
  private stallTimer: NodeJS.Timeout | undefined
  private exitPoll: NodeJS.Timeout | undefined
  private disposed = false
  /** Set once the shell was found dead while paused: the rest must drain, so it never pauses again. */
  private shellGone = false

  constructor(private readonly options: TerminalOutputFlowOptions) {}

  /** Whether the PTY is paused right now (for tests and diagnostics). */
  get isPaused(): boolean {
    return this.paused
  }

  /** Characters sent that the renderer has not acknowledged yet. */
  get unacknowledged(): number {
    return this.unacked
  }

  /** Queues output; it is sent on the next flush. */
  push(data: string): void {
    if (this.disposed || !data) return
    this.pending += data
    if (this.pending.length >= TERMINAL_OUTPUT_BATCH_MAX_CHARS) {
      this.flush()
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), TERMINAL_OUTPUT_FLUSH_MS)
    }
  }

  /** Sends whatever is queued now, then pauses the PTY if the renderer is too far behind. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    const data = this.pending
    if (!data) return
    this.pending = ''
    this.options.emit(data)
    if (this.disposed || this.shellGone || !this.options.pause) return
    this.unacked += data.length
    if (!this.paused && this.unacked > TERMINAL_OUTPUT_HIGH_WATERMARK) this.setPaused(true)
  }

  /** The renderer has parsed `chars` more characters. */
  ack(chars: number): void {
    if (this.disposed || !this.options.pause) return
    this.unacked = Math.max(0, this.unacked - chars)
    if (!this.paused) return
    if (this.unacked < TERMINAL_OUTPUT_LOW_WATERMARK) {
      this.setPaused(false)
    } else {
      // Still behind, but the renderer is alive: give it the full stall window again
      this.armStallTimer()
    }
  }

  /**
   * Sends what is queued, resumes a paused PTY and stops all timers. Later
   * pushes and acks are ignored. Safe to call more than once.
   */
  dispose(): void {
    if (this.disposed) return
    this.release()
    this.disposed = true
  }

  /**
   * Sends what is queued and lifts a pause, but keeps the flow usable: used
   * right before a kill, which can fail and leave the terminal running.
   */
  release(): void {
    this.flush()
    if (this.paused) this.setPaused(false)
  }

  private setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) {
      this.options.pause?.()
      this.armStallTimer()
      if (this.options.isAlive) {
        this.exitPoll = setInterval(() => {
          if (this.options.isAlive?.()) return
          this.shellGone = true
          this.setPaused(false)
        }, TERMINAL_OUTPUT_EXIT_POLL_MS)
      }
      return
    }
    if (this.stallTimer) clearTimeout(this.stallTimer)
    if (this.exitPoll) clearInterval(this.exitPoll)
    this.stallTimer = undefined
    this.exitPoll = undefined
    this.options.resume?.()
  }

  private armStallTimer(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer)
    this.stallTimer = setTimeout(() => {
      this.stallTimer = undefined
      this.unacked = 0
      this.setPaused(false)
    }, TERMINAL_OUTPUT_STALL_MS)
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Failure-badge entry texts for frames past the caps (issue #124, answer 9).
 *
 * Main writes these finished sentences into a failure entry's
 * `resourceUrlOrHost` (the frame writers, WI-14), and the failure badge shows
 * the entry as it is (WI-16). They live in shared code because main writes them
 * and main cannot import renderer modules; one copy, so the wording cannot
 * drift between the writer and the reader.
 *
 * Every text here fits the failure schema's entry rule: at most 2048
 * characters and no line breaks.
 *
 * @see docs/design/design-issue-124-part2.md §2.7, §2.12
 */
import { PREVIEW_LIMITS } from './preview-limits'

/**
 * The entry for a `srcdoc` frame nested deeper than `MAX_FRAME_DEPTH`.
 *
 * A `srcdoc` frame cannot be stopped before it loads (spike S11), so one past
 * the cap is shown and listed once per page (answer 9). The text says so,
 * because "nested too deep" next to a frame that plainly rendered would read
 * as a broken limit.
 */
export const SRCDOC_TOO_DEEP_ENTRY =
  'srcdoc frame – shown anyway; the depth limit covers src frames only'

/** Which frames a "too many frames" entry counts. */
export type FrameOverLimitKind = 'src' | 'srcdoc'

/**
 * The entry for frames past `MAX_FRAMES_PER_PAGE` on one page, in the singular
 * or the plural.
 *
 * `src` frames past the cap are left empty; `srcdoc` frames cannot be, so they
 * are shown anyway (answer 9). The cap in the text is the guard's own constant,
 * so the two cannot drift apart.
 *
 * @param count - How many frames of this kind went past the cap.
 * @param kind - `src` or `srcdoc` frames.
 * @returns The finished entry text.
 *
 * @example
 * ```ts
 * describeFramesOverLimit(1, 'src')     // '1 frame over the limit of 50 was left empty'
 * describeFramesOverLimit(12, 'src')    // '12 frames over the limit of 50 were left empty'
 * describeFramesOverLimit(10, 'srcdoc') // '10 srcdoc frames over the limit of 50 are shown anyway'
 * ```
 */
export function describeFramesOverLimit(count: number, kind: FrameOverLimitKind): string {
  const limit = PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE
  const one = count === 1
  if (kind === 'srcdoc') {
    return one
      ? `1 srcdoc frame over the limit of ${limit} is shown anyway`
      : `${count} srcdoc frames over the limit of ${limit} are shown anyway`
  }
  return one
    ? `1 frame over the limit of ${limit} was left empty`
    : `${count} frames over the limit of ${limit} were left empty`
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The refused-frame set of one page (issue #124, WI-29; part 2 §2.3, RX2-2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import {
  FRAME_REFUSAL_MAX_ADDRESS_CHARS,
  boundFrameAddress,
  createPreviewFrameRefusals
} from './previewFrameRefusals'

afterEach(() => {
  vi.restoreAllMocks()
})

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const EMOJI = String.fromCodePoint(0x1f600)

function makeSet() {
  const recorded: PreviewFailureInput[] = []
  const refusals = createPreviewFrameRefusals({
    panelId: 'panel-A',
    recordFailure: (input) => {
      recorded.push(input)
    }
  })
  return { refusals, recorded }
}

describe('previewFrameRefusals', () => {
  it('lists one entry per address, whichever layer refused it and however often', () => {
    const { refusals, recorded } = makeSet()

    expect(refusals.record('frame-remote', 'https://example.com/a')).toBe(true)
    expect(refusals.record('frame-remote', 'https://example.com/a')).toBe(false)
    // The guard and the failed-load writer can both see one frame.
    expect(refusals.record('frame-escape', 'https://example.com/a')).toBe(false)

    expect(recorded).toEqual([
      {
        type: 'frame-remote',
        resourceUrlOrHost: 'https://example.com/a',
        reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
      }
    ])
  })

  it('reuses the existing codes: file missing for a missing frame, link blocked for the rest', () => {
    const { refusals, recorded } = makeSet()

    refusals.record('missing-local-file', 'erfana-preview://t/gone.html')
    refusals.record('frame-too-deep', 'erfana-preview://t/deep.html')

    expect(recorded.map((entry) => entry.reasonCode)).toEqual([
      ErrorCode.PREVIEW_LOCAL_FILE_MISSING,
      ErrorCode.PREVIEW_LINK_BLOCKED
    ])
  })

  it('cuts a 100 kB address to the schema length BEFORE it becomes the dedupe key', () => {
    const { refusals, recorded } = makeSet()
    const head = 'https://example.com/' + 'a'.repeat(100_000)

    expect(refusals.record('frame-remote', head + '1')).toBe(true)
    // Differs only past the cut: the same entry.
    expect(refusals.record('frame-remote', head + '2')).toBe(false)

    expect(recorded).toHaveLength(1)
    expect(recorded[0].resourceUrlOrHost).toHaveLength(FRAME_REFUSAL_MAX_ADDRESS_CHARS)
  })

  it('removes line breaks before the dedupe key, so the entry passes the failure schema', () => {
    const { refusals, recorded } = makeSet()

    expect(refusals.record('frame-remote', 'https://example.com/a\r\nb')).toBe(true)
    expect(refusals.record('frame-remote', 'https://example.com/ab')).toBe(false)
    expect(refusals.record('frame-remote', `https://example.com/a${LINE_SEPARATOR}b`)).toBe(false)

    expect(recorded).toEqual([
      expect.objectContaining({ resourceUrlOrHost: 'https://example.com/ab' })
    ])
  })

  it('never cuts through a surrogate pair', () => {
    const prefix = 'a'.repeat(FRAME_REFUSAL_MAX_ADDRESS_CHARS - 1)
    expect(boundFrameAddress(prefix + EMOJI + 'tail')).toBe(prefix)
  })

  it('leaves a short address as it is', () => {
    expect(boundFrameAddress('erfana-preview://t/a.html')).toBe('erfana-preview://t/a.html')
  })

  it('holds at most MAX_FAILURES entries: 1 000 distinct refusals give 100 entries and a count', () => {
    const { refusals, recorded } = makeSet()

    for (let i = 0; i < 1000; i += 1) {
      refusals.record('frame-remote', `https://example.com/${i}`)
    }

    expect(recorded).toHaveLength(PREVIEW.MAX_FAILURES)
    expect(refusals.overflowCount()).toBe(1000 - PREVIEW.MAX_FAILURES)
    // An address already listed is a repeat, not an overflow.
    refusals.record('frame-remote', 'https://example.com/0')
    expect(refusals.overflowCount()).toBe(1000 - PREVIEW.MAX_FAILURES)
  })

  it('logs the overflow count once, when the page ends, and ignores later refusals', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const { refusals, recorded } = makeSet()
    for (let i = 0; i < PREVIEW.MAX_FAILURES + 5; i += 1) {
      refusals.record('frame-remote', `https://example.com/${i}`)
    }
    expect(info).not.toHaveBeenCalled()

    refusals.close()
    refusals.close()

    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][1]).toEqual(
      expect.objectContaining({ panelId: stablePathDigest('panel-A'), count: 5 })
    )
    expect(refusals.record('frame-remote', 'https://example.com/new')).toBe(false)
    expect(recorded).toHaveLength(PREVIEW.MAX_FAILURES)
  })

  it('logs nothing when nothing overflowed', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const { refusals } = makeSet()

    refusals.record('frame-remote', 'https://example.com/a')
    refusals.close()

    expect(info).not.toHaveBeenCalled()
  })
})

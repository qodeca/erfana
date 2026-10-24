// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'

import { LOCAL_WHISPER } from './constants'
import { MODEL_PINS } from './whisper-model-pins'

describe('MODEL_PINS', () => {
  it('has a pin for exactly the supported models', () => {
    expect(Object.keys(MODEL_PINS).sort()).toEqual([...LOCAL_WHISPER.SUPPORTED_MODELS].sort())
  })

  it.each(Object.entries(MODEL_PINS))('%s has a well-formed pin', (_model, pin) => {
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(Number.isInteger(pin.sizeBytes)).toBe(true)
    expect(pin.sizeBytes).toBeGreaterThan(0)
    expect(pin.remoteFilename).toMatch(/^ggml-[\w.-]+\.bin$/)
  })

  it('has distinct hashes (no copy-paste between models)', () => {
    const hashes = Object.values(MODEL_PINS).map((p) => p.sha256)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('feeds the display sizes, so they are the real file sizes', () => {
    for (const model of LOCAL_WHISPER.SUPPORTED_MODELS) {
      expect(LOCAL_WHISPER.MODEL_SIZES[model]).toBe(MODEL_PINS[model].sizeBytes)
    }
  })
})

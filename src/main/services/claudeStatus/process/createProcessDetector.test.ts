// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  createProcessDetector,
  NoopClaudeProcessDetector,
} from './createProcessDetector'
import { MacClaudeProcessDetector } from './MacClaudeProcessDetector'
import { WinClaudeProcessDetector } from './WinClaudeProcessDetector'

describe('createProcessDetector', () => {
  it('returns a MacClaudeProcessDetector on darwin', () => {
    expect(createProcessDetector('darwin')).toBeInstanceOf(MacClaudeProcessDetector)
  })

  it('returns a WinClaudeProcessDetector on win32', () => {
    expect(createProcessDetector('win32')).toBeInstanceOf(WinClaudeProcessDetector)
  })

  it.each<NodeJS.Platform>(['linux'])(
    'returns a no-op detector on %s',
    (platform) => {
      expect(createProcessDetector(platform)).toBeInstanceOf(NoopClaudeProcessDetector)
    }
  )

  it.each<NodeJS.Platform>(['linux'])(
    'the no-op detector on %s reports running:false',
    async (platform) => {
      const detector = createProcessDetector(platform)
      expect(await detector.isClaudeRunning(1234)).toEqual({ running: false })
    }
  )
})

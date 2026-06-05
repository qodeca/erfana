import { describe, it, expect } from 'vitest'
import {
  createProcessDetector,
  NoopClaudeProcessDetector,
} from './createProcessDetector'
import { MacClaudeProcessDetector } from './MacClaudeProcessDetector'

describe('createProcessDetector', () => {
  it('returns a MacClaudeProcessDetector on darwin', () => {
    expect(createProcessDetector('darwin')).toBeInstanceOf(MacClaudeProcessDetector)
  })

  it.each<NodeJS.Platform>(['win32', 'linux'])(
    'returns a no-op detector on %s',
    (platform) => {
      expect(createProcessDetector(platform)).toBeInstanceOf(NoopClaudeProcessDetector)
    }
  )

  it.each<NodeJS.Platform>(['win32', 'linux'])(
    'the no-op detector on %s reports running:false',
    async (platform) => {
      const detector = createProcessDetector(platform)
      expect(await detector.isClaudeRunning(1234)).toEqual({ running: false })
    }
  )
})

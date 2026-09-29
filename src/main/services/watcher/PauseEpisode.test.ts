// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import path from 'path'
import { describe, it, expect } from 'vitest'
import { PauseEpisode, MAX_INTERNAL_CHANGES } from './PauseEpisode'

// Paths built with path.join so separators match the host (Windows included).
const ROOT = path.join(path.sep, 'proj')
const at = (...segments: string[]): string => path.join(ROOT, ...segments)

const OWNER = 1
const OTHER = 2

describe('PauseEpisode (#210)', () => {
  it('counts a foreign structural drop but not a content change', () => {
    const changeOnly = new PauseEpisode(OWNER)
    changeOnly.recordDrop('change', at('notes.md'))
    expect(changeOnly.needsCatchUp()).toBe(false)

    const added = new PauseEpisode(OWNER)
    added.recordDrop('add', at('new.md'))
    expect(added.needsCatchUp()).toBe(true)
    expect(added.uncoveredDrops()).toBe(1)
  })

  it('treats drops before a completed owner read as covered, and a later drop as not', () => {
    const episode = new PauseEpisode(OWNER)
    episode.recordDrop('add', at('a.md'))

    const snapshot = episode.beginTreeRead(OWNER)
    expect(snapshot).not.toBeNull()
    episode.completeTreeRead(snapshot as number)
    expect(episode.needsCatchUp()).toBe(false)
    expect(episode.uncoveredDrops()).toBe(0)

    episode.recordDrop('unlink', at('b.md'))
    expect(episode.needsCatchUp()).toBe(true)
  })

  it('leaves drops uncovered when the read never completes (read rejected)', () => {
    const episode = new PauseEpisode(OWNER)
    episode.recordDrop('add', at('a.md'))

    episode.beginTreeRead(OWNER)

    expect(episode.needsCatchUp()).toBe(true)
  })

  it('does not cover a drop that lands after the read started', () => {
    const episode = new PauseEpisode(OWNER)

    const snapshot = episode.beginTreeRead(OWNER) as number
    episode.recordDrop('addDir', at('late'))
    episode.completeTreeRead(snapshot)

    expect(episode.needsCatchUp()).toBe(true)
  })

  it('ignores a tree read by a window other than the one that paused', () => {
    const episode = new PauseEpisode(OWNER)
    episode.recordDrop('add', at('a.md'))

    expect(episode.beginTreeRead(OTHER)).toBeNull()
    expect(episode.needsCatchUp()).toBe(true)
  })

  it('filters removals under a removed subtree but counts a re-creation there', () => {
    const episode = new PauseEpisode(OWNER)
    episode.noteInternalChange({ path: at('old'), kind: 'removed', subtree: true })

    episode.recordDrop('unlinkDir', at('old'))
    episode.recordDrop('unlink', at('old', 'a.md'))
    expect(episode.needsCatchUp()).toBe(false)

    episode.recordDrop('add', at('old', 'a.md'))
    expect(episode.needsCatchUp()).toBe(true)
  })

  it('filters additions under an added subtree but counts a deletion inside it', () => {
    const episode = new PauseEpisode(OWNER)
    episode.noteInternalChange({ path: at('copied'), kind: 'added', subtree: true })

    episode.recordDrop('addDir', at('copied'))
    episode.recordDrop('add', at('copied', 'a.md'))
    expect(episode.needsCatchUp()).toBe(false)

    episode.recordDrop('unlink', at('copied', 'a.md'))
    expect(episode.needsCatchUp()).toBe(true)
  })

  it('matches an exact added path only, not what appears inside it', () => {
    const episode = new PauseEpisode(OWNER)
    episode.noteInternalChange({ path: at('newdir'), kind: 'added', subtree: false })

    episode.recordDrop('addDir', at('newdir'))
    expect(episode.needsCatchUp()).toBe(false)

    episode.recordDrop('add', at('newdir', 'x.md'))
    expect(episode.needsCatchUp()).toBe(true)
  })

  it('does not treat a sibling sharing the name prefix as inside a subtree', () => {
    const episode = new PauseEpisode(OWNER)
    episode.noteInternalChange({ path: at('copied'), kind: 'added', subtree: true })

    episode.recordDrop('add', at('copied-2', 'x.md'))

    expect(episode.needsCatchUp()).toBe(true)
  })

  it('forces a catch-up once the internal-change cap is exceeded', () => {
    const episode = new PauseEpisode(OWNER)
    for (let i = 0; i < MAX_INTERNAL_CHANGES; i++) {
      episode.noteInternalChange({ path: at(`f${i}.md`), kind: 'added', subtree: false })
    }
    expect(episode.needsCatchUp()).toBe(false)
    expect(episode.isForcedByCap()).toBe(false)

    episode.noteInternalChange({ path: at('one-too-many.md'), kind: 'added', subtree: false })

    expect(episode.needsCatchUp()).toBe(true)
    expect(episode.isForcedByCap()).toBe(true)
    expect(episode.uncoveredDrops()).toBe(0)

    // Already forced: later drops are not counted
    episode.recordDrop('add', at('after-cap.md'))
    expect(episode.uncoveredDrops()).toBe(0)
  })
})

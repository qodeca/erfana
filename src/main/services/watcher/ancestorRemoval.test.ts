// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import path from 'path'
import { watchedUnderRemovedFolders } from './ancestorRemoval'

const p = (...segments: string[]): string => path.join(path.sep, 'proj', ...segments)

describe('watchedUnderRemovedFolders', () => {
  const watched = [p('docs', 'open.md'), p('docs', 'deep', 'nested.md'), p('docs-old', 'a.md'), p('top.md')]

  it('returns every watched file under a removed folder, at any depth', () => {
    expect(watchedUnderRemovedFolders(watched, [p('docs')])).toEqual([
      p('docs', 'open.md'),
      p('docs', 'deep', 'nested.md')
    ])
  })

  it('does not match a sibling that only shares a name prefix', () => {
    expect(watchedUnderRemovedFolders(watched, [p('doc')])).toEqual([])
  })

  it('does not match the removal of the watched file itself', () => {
    expect(watchedUnderRemovedFolders(watched, [p('top.md')])).toEqual([])
  })

  it('handles several removals in one batch', () => {
    expect(watchedUnderRemovedFolders(watched, [p('docs', 'deep'), p('docs-old')])).toEqual([
      p('docs', 'deep', 'nested.md'),
      p('docs-old', 'a.md')
    ])
  })

  it.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'ignores case on case-insensitive platforms',
    () => {
      expect(watchedUnderRemovedFolders(watched, [p('DOCS')])).toHaveLength(2)
    }
  )
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * file-schema tests – the tree node and file stats shapes.
 */
import { describe, it, expect } from 'vitest'
import { FileNodeSchema, FileStatsSchema } from './file-schema'

describe('FileNodeSchema', () => {
  it('accepts a nested tree with the optional fields', () => {
    const tree = {
      name: 'docs',
      path: '/p/docs',
      type: 'directory',
      children: [
        { name: 'a.md', path: '/p/docs/a.md', type: 'file', extension: '.md', isSymlink: false }
      ]
    }
    expect(FileNodeSchema.parse(tree)).toEqual(tree)
  })

  it('rejects an unknown type', () => {
    expect(FileNodeSchema.safeParse({ name: 'x', path: '/x', type: 'socket' }).success).toBe(false)
  })

  it('rejects an invalid node nested in children', () => {
    const bad = { name: 'd', path: '/d', type: 'directory', children: [{ name: 'x', type: 'file' }] }
    expect(FileNodeSchema.safeParse(bad).success).toBe(false)
  })
})

describe('FileStatsSchema', () => {
  it('accepts size and two dates', () => {
    const stats = { size: 3, modified: new Date(1), created: new Date(0) }
    expect(FileStatsSchema.parse(stats)).toEqual(stats)
  })

  it('rejects a date sent as a string', () => {
    expect(
      FileStatsSchema.safeParse({ size: 3, modified: '2026-01-01', created: new Date() }).success
    ).toBe(false)
  })
})

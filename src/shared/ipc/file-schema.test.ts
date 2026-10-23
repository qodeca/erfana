// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * file-schema tests – the tree node and file stats shapes.
 */
import { describe, it, expect } from 'vitest'
import type { z } from 'zod'
import {
  CheckConflictRequestSchema,
  CloseProjectRequestSchema,
  CopyItemRequestSchema,
  CreateEntryRequestSchema,
  FileNodeSchema,
  FileStatsSchema,
  MoveItemRequestSchema,
  OpenProjectByPathRequestSchema,
  PathRequestSchema,
  ReadDirectoryRequestSchema,
  RenameRequestSchema,
  ValidatePathRequestSchema,
  WriteFileRequestSchema,
  payloadArgs
} from './file-schema'

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

  it('carries why a folder was left lazy: ignored or capped, nothing else', () => {
    const lazy = { name: 'dist', path: '/p/dist', type: 'directory', children: [], lazy: 'ignored' }
    expect(FileNodeSchema.parse(lazy)).toEqual(lazy)
    expect(FileNodeSchema.parse({ ...lazy, lazy: 'capped' })).toEqual({ ...lazy, lazy: 'capped' })
    expect(FileNodeSchema.safeParse({ ...lazy, lazy: true }).success).toBe(false)
    expect(FileNodeSchema.safeParse({ ...lazy, lazy: 'other' }).success).toBe(false)
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

describe('file request schemas', () => {
  // Every request is a strict object: a key that is not listed is refused, not ignored
  const valid: Array<[string, z.ZodType, Record<string, unknown>]> = [
    ['ReadDirectoryRequestSchema', ReadDirectoryRequestSchema, { dirPath: 'p' }],
    ['PathRequestSchema', PathRequestSchema, { filePath: 'p/a.md' }],
    ['WriteFileRequestSchema', WriteFileRequestSchema, { filePath: 'p/a.md', content: 'x' }],
    ['CreateEntryRequestSchema', CreateEntryRequestSchema, { dirPath: 'p', name: 'a.md' }],
    ['RenameRequestSchema', RenameRequestSchema, { oldPath: 'p/a.md', newName: 'b.md' }],
    ['MoveItemRequestSchema', MoveItemRequestSchema, { sourcePath: 'p/a', targetParentPath: 'p/b' }],
    ['CopyItemRequestSchema', CopyItemRequestSchema, { sourcePath: 'p/a', targetParentPath: 'p/b' }],
    ['CheckConflictRequestSchema', CheckConflictRequestSchema, { targetParentPath: 'p', itemName: 'a' }],
    ['OpenProjectByPathRequestSchema', OpenProjectByPathRequestSchema, { projectPath: 'p' }],
    ['ValidatePathRequestSchema', ValidatePathRequestSchema, { filePath: 'p/a.md' }]
  ]

  it.each(valid)('%s accepts its request and refuses a stray key', (_name, schema, request) => {
    expect(schema.safeParse(request).success).toBe(true)
    expect(schema.safeParse({ ...request, projectRoot: 'other' }).success).toBe(false)
  })

  it.each(valid)('%s refuses a bare value in place of the object', (_name, schema, request) => {
    expect(schema.safeParse(Object.values(request)[0]).success).toBe(false)
    expect(schema.safeParse(undefined).success).toBe(false)
    expect(schema.safeParse(null).success).toBe(false)
  })

  it.each(valid)('%s refuses a request with its first field missing', (_name, schema, request) => {
    const [first, ...others] = Object.keys(request)
    const rest = Object.fromEntries(others.map((key) => [key, request[key]]))
    expect(first).toBeDefined()
    expect(schema.safeParse(rest).success).toBe(false)
  })

  it('payloadArgs wraps a request in a one-element tuple', () => {
    const args = payloadArgs(PathRequestSchema)
    expect(args.safeParse([{ filePath: 'p' }]).success).toBe(true)
    expect(args.safeParse([]).success).toBe(false)
    expect(args.safeParse([{ filePath: 'p' }, 'second']).success).toBe(false)
  })

  describe('WriteFileRequestSchema', () => {
    const base = { filePath: 'p/a.md', content: '' }

    it('takes createParentDirs only as a literal true', () => {
      expect(WriteFileRequestSchema.safeParse({ ...base, createParentDirs: true }).success).toBe(true)
      for (const bad of [false, 'yes', 1, null]) {
        expect(WriteFileRequestSchema.safeParse({ ...base, createParentDirs: bad }).success).toBe(false)
      }
    })

    it('takes the generation as an integer', () => {
      expect(WriteFileRequestSchema.safeParse({ ...base, generation: 0 }).success).toBe(true)
      expect(WriteFileRequestSchema.safeParse({ ...base, generation: 12 }).success).toBe(true)
      for (const bad of [1.5, '1', null, Number.NaN]) {
        expect(WriteFileRequestSchema.safeParse({ ...base, generation: bad }).success).toBe(false)
      }
    })

    it('requires the content to be a string', () => {
      expect(WriteFileRequestSchema.safeParse({ filePath: 'p/a.md' }).success).toBe(false)
      expect(WriteFileRequestSchema.safeParse({ filePath: 'p/a.md', content: 3 }).success).toBe(false)
    })
  })

  describe('names', () => {
    it.each(['', '.', '..', 'a/b', 'a\\b', 'a\0b', 'x'.repeat(256)])('refuses the entry name %j', (name) => {
      expect(CreateEntryRequestSchema.safeParse({ dirPath: 'p', name }).success).toBe(false)
      expect(RenameRequestSchema.safeParse({ oldPath: 'p/a', newName: name }).success).toBe(false)
    })

    it('accepts an ordinary name', () => {
      expect(CreateEntryRequestSchema.safeParse({ dirPath: 'p', name: 'notes v2.md' }).success).toBe(true)
    })
  })

  it('trims the project path and refuses one that is empty after trimming', () => {
    expect(OpenProjectByPathRequestSchema.parse({ projectPath: '  p  ' })).toEqual({ projectPath: 'p' })
    expect(OpenProjectByPathRequestSchema.safeParse({ projectPath: '   ' }).success).toBe(false)
  })

  it('takes the close request whole or not at all', () => {
    const optional = CloseProjectRequestSchema.optional()
    expect(optional.safeParse(undefined).success).toBe(true)
    expect(optional.safeParse({}).success).toBe(true)
    expect(optional.safeParse({ expectedGeneration: 2 }).success).toBe(true)
    expect(optional.safeParse({ expectedGeneration: 'x' }).success).toBe(false)
    expect(optional.safeParse({ other: 1 }).success).toBe(false)
    expect(optional.safeParse(3).success).toBe(false)
  })
})

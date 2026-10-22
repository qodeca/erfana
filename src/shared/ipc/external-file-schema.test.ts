// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * External file request schemas – strict objects, no project root, and the
 * batch shape that lets one request ask the user once.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  EXTERNAL_MOVE_BATCH_MAX,
  ExternalFileCopyRequestSchema,
  ExternalFileMoveBatchRequestSchema,
  ExternalFileMoveBatchResponseSchema,
  ExternalFileMoveRequestSchema,
  ExternalFileValidateRequestSchema
} from './external-file-schema'

const abs = (...parts: string[]): string => path.resolve(path.sep, 'erfana-schema-test', ...parts)

describe('single-file requests', () => {
  const requests = [
    ['validate', ExternalFileValidateRequestSchema, { sourcePath: abs('in', 'a.md') }],
    ['copy', ExternalFileCopyRequestSchema, { sourcePath: abs('in', 'a.md'), targetFolder: abs('proj') }],
    ['move', ExternalFileMoveRequestSchema, { sourcePath: abs('in', 'a.md'), targetFolder: abs('proj') }]
  ] as const

  it.each(requests)('%s accepts its request', (_name, schema, request) => {
    expect(schema.safeParse(request).success).toBe(true)
  })

  it.each(requests)('%s refuses a project root and any other key', (_name, schema, request) => {
    expect(schema.safeParse({ ...request, projectRoot: abs('proj') }).success).toBe(false)
    expect(schema.safeParse({ ...request, other: 1 }).success).toBe(false)
  })

  it.each(requests)('%s refuses a relative path', (_name, schema, request) => {
    expect(schema.safeParse({ ...request, sourcePath: 'relative/a.md' }).success).toBe(false)
  })

  it.each(requests)('%s refuses positional arguments', (_name, schema, request) => {
    expect(schema.safeParse(Object.values(request)).success).toBe(false)
    expect(schema.safeParse(abs('in', 'a.md')).success).toBe(false)
  })

  it('copy and move take a known conflict strategy only', () => {
    const base = { sourcePath: abs('in', 'a.md'), targetFolder: abs('proj') }
    for (const schema of [ExternalFileCopyRequestSchema, ExternalFileMoveRequestSchema]) {
      expect(schema.safeParse({ ...base, conflictResolution: 'replace' }).success).toBe(true)
      expect(schema.safeParse({ ...base, conflictResolution: 'keepBoth' }).success).toBe(true)
      expect(schema.safeParse({ ...base, conflictResolution: 'overwrite' }).success).toBe(false)
    }
  })
})

describe('ExternalFileMoveBatchRequestSchema', () => {
  const targetFolder = abs('proj')
  const items = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ sourcePath: abs('in', `${index}.md`) }))

  it('accepts one file up to the limit', () => {
    expect(ExternalFileMoveBatchRequestSchema.safeParse({ items: items(1), targetFolder }).success).toBe(true)
    expect(
      ExternalFileMoveBatchRequestSchema.safeParse({ items: items(EXTERNAL_MOVE_BATCH_MAX), targetFolder }).success
    ).toBe(true)
  })

  it('refuses an empty batch and one over the limit', () => {
    expect(ExternalFileMoveBatchRequestSchema.safeParse({ items: [], targetFolder }).success).toBe(false)
    expect(
      ExternalFileMoveBatchRequestSchema.safeParse({ items: items(EXTERNAL_MOVE_BATCH_MAX + 1), targetFolder })
        .success
    ).toBe(false)
  })

  it('refuses the same file twice', () => {
    const twice = [{ sourcePath: abs('in', 'a.md') }, { sourcePath: abs('in', 'a.md') }]
    expect(ExternalFileMoveBatchRequestSchema.safeParse({ items: twice, targetFolder }).success).toBe(false)
  })

  it('carries a conflict strategy per file', () => {
    const parsed = ExternalFileMoveBatchRequestSchema.safeParse({
      items: [
        { sourcePath: abs('in', 'a.md'), conflictResolution: 'keepBoth' },
        { sourcePath: abs('in', 'b.md'), conflictResolution: 'replace' },
        { sourcePath: abs('in', 'c.md') }
      ],
      targetFolder
    })
    expect(parsed.success).toBe(true)
    const bad = ExternalFileMoveBatchRequestSchema.safeParse({
      items: [{ sourcePath: abs('in', 'a.md'), conflictResolution: 'overwrite' }],
      targetFolder
    })
    expect(bad.success).toBe(false)
  })

  it('refuses a stray key at either level, a relative path and a missing target', () => {
    expect(
      ExternalFileMoveBatchRequestSchema.safeParse({ items: items(1), targetFolder, projectRoot: abs('x') }).success
    ).toBe(false)
    expect(
      ExternalFileMoveBatchRequestSchema.safeParse({
        items: [{ sourcePath: abs('in', 'a.md'), other: 1 }],
        targetFolder
      }).success
    ).toBe(false)
    expect(
      ExternalFileMoveBatchRequestSchema.safeParse({ items: [{ sourcePath: 'rel.md' }], targetFolder }).success
    ).toBe(false)
    expect(
      ExternalFileMoveBatchRequestSchema.safeParse({ items: items(1), targetFolder: 'rel' }).success
    ).toBe(false)
    expect(ExternalFileMoveBatchRequestSchema.safeParse({ items: items(1) }).success).toBe(false)
  })

  it('refuses paths in place of items, and positional arguments', () => {
    expect(
      ExternalFileMoveBatchRequestSchema.safeParse({ items: [abs('in', 'a.md')], targetFolder }).success
    ).toBe(false)
    expect(ExternalFileMoveBatchRequestSchema.safeParse([items(1), targetFolder]).success).toBe(false)
  })
})

describe('ExternalFileMoveBatchResponseSchema', () => {
  it('holds one result per file, or the reason the whole request was refused', () => {
    expect(
      ExternalFileMoveBatchResponseSchema.safeParse({
        results: [{ success: true, path: abs('proj', 'a.md') }, { success: false, errorCode: 'X' }]
      }).success
    ).toBe(true)
    expect(
      ExternalFileMoveBatchResponseSchema.safeParse({ results: [], error: 'No project is open', errorCode: 'NO_PROJECT' })
        .success
    ).toBe(true)
    expect(ExternalFileMoveBatchResponseSchema.safeParse({ error: 'x' }).success).toBe(false)
  })
})

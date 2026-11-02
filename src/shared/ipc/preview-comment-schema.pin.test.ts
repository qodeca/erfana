// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * IPC schema snapshot (spec 024, 024-FR-020; architecture note
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md
 * § 6 commit 4, § 8 C26).
 *
 * CHARACTERISATION PIN. It freezes the wire shape of every HTML Preview
 * comment payload as v0.23.1 ships it: each zod schema of
 * `preview-comment-schema.ts` and `preview-comment-page-schema.ts` as JSON
 * Schema (input side – what a receiver accepts), the messages of its custom
 * refinements (JSON Schema cannot express those), and every exported limit and
 * pattern. Update the snapshot only in a `feat:` commit that names the C-xx or
 * OD-xx it serves – never in a `refactor:` commit, where a change here means
 * the move changed the wire.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as pageSchema from './preview-comment-page-schema'
import * as commentSchema from './preview-comment-schema'

/** The `_zod` internals a walk reads: a definition, and its checks. */
interface ZodInternals {
  readonly _zod: { readonly def: Record<string, unknown> & { readonly checks?: readonly unknown[] } }
}

const isZod = (value: unknown): value is ZodInternals =>
  typeof value === 'object' && value !== null && '_zod' in value

/** The message a refinement fails with, or `(no message)`. */
function refinementMessage(check: ZodInternals): string {
  const { error } = check._zod.def as { error?: unknown }
  if (typeof error !== 'function') return '(no message)'
  const issue: unknown = (error as (input: unknown) => unknown)({ code: 'custom', input: undefined })
  if (typeof issue === 'string') return issue
  if (typeof issue === 'object' && issue !== null && 'message' in issue) return String(issue.message)
  return '(no message)'
}

/**
 * Every custom refinement's message in `schema` and the schemas inside it, in
 * one fixed walk order (definition keys in their own order).
 */
function refinements(schema: ZodInternals): string[] {
  const out: string[] = []
  const seen = new Set<unknown>()
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isZod(value)) {
      if (Object.getPrototypeOf(value) === Object.prototype) Object.values(value).forEach(visit)
      return
    }
    const { def } = value._zod
    for (const check of def.checks ?? []) {
      if (isZod(check) && check._zod.def.check === 'custom') out.push(refinementMessage(check))
    }
    for (const [key, child] of Object.entries(def)) if (key !== 'checks') visit(child)
  }
  visit(schema)
  return out
}

/** A module's exports as a stable, JSON-safe shape, sorted by name. */
function describeModule(module: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const name of Object.keys(module).sort()) {
    const value = module[name]
    if (value instanceof z.ZodType) {
      out[name] = {
        jsonSchema: z.toJSONSchema(value, { io: 'input' }),
        refinements: refinements(value as unknown as ZodInternals)
      }
    } else if (value instanceof RegExp) {
      out[name] = { regexp: value.source, flags: value.flags }
    } else {
      out[name] = value
    }
  }
  return out
}

describe('preview comment IPC schemas (characterisation)', () => {
  it('PIN-C-001 the page schemas (preview-comment-page-schema.ts) keep their wire shape', () => {
    expect(describeModule(pageSchema)).toMatchSnapshot()
  })

  it('PIN-C-002 the comment schemas (preview-comment-schema.ts) keep their wire shape', () => {
    expect(describeModule(commentSchema)).toMatchSnapshot()
  })

  it('PIN-C-003 the walk sees every schema and the refinements JSON Schema leaves out', () => {
    // Guards the snapshot itself: a walk that silently found nothing would pin nothing.
    const described = describeModule(commentSchema)
    const schemas = Object.values(described).filter(v => typeof v === 'object' && v !== null && 'jsonSchema' in v)
    expect(schemas.length).toBeGreaterThan(25)
    expect(refinements(commentSchema.CommentSaveSettledSchema as unknown as ZodInternals)).toEqual([
      'a failed write names its code, a landed one none',
      'a settled write is no longer pending',
      'a write is named by its own key'
    ])
    expect(refinements(pageSchema.CommentPickSchema as unknown as ZodInternals)).toContain('a pin pick names its key')
  })
})

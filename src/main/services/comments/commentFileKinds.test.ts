// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The comment file-kind registry (spec 024 architecture note 001 § 3, § 8 C1, C18, C24). */
import { describe, expect, it } from 'vitest'
import type { CommentFileKind } from '../../../shared/comments/fileKind'
import { htmlKind } from '../../../shared/comments/htmlKind'
import { CommentFileKindRegistry, commentFileKinds, frozenCommentFileKinds } from './commentFileKinds'

/** A kind with only what the registry reads; its methods are never called here. */
function stubKind(id: string, extensions: readonly string[], agentNote: readonly string[] = ['note to agents: test.']): CommentFileKind {
  return { ...htmlKind, id, extensions, agentNote }
}

describe('commentFileKinds (production)', () => {
  it('is HTML only, and frozen before anything else can run (the .txt kind is never in it)', () => {
    expect(commentFileKinds.frozen).toBe(true)
    expect(commentFileKinds.extensions()).toEqual(['.html', '.htm'])
    expect(commentFileKinds.kindById('html')).toBe(htmlKind)
    expect(commentFileKinds.kindById('txt')).toBeUndefined()
    expect(() => commentFileKinds.register(stubKind('txt', ['.txt']))).toThrow(/frozen/)
  })

  it('maps a name by its extension in any ASCII case, and nothing else', () => {
    for (const name of ['index.html', 'A.HTM', '/p/x.Html', '.html']) expect(commentFileKinds.kindOfName(name)).toBe(htmlKind)
    // The Kelvin sign folds to `k` in toLowerCase; it must not make an extension match.
    const kelvin = frozenCommentFileKinds([stubKind('md', ['.markdown'])])
    expect(kelvin.kindOfName('a.mar\u212Adown')).toBeUndefined()
    expect(kelvin.kindOfName('a.MARKDOWN')?.id).toBe('md')
    for (const name of ['html', 'a.html.', 'a.html ', 'a.htmlx', 'notes.txt']) expect(commentFileKinds.kindOfName(name)).toBeUndefined()
  })
})

describe('CommentFileKindRegistry.register', () => {
  it('refuses a taken id, a taken or malformed extension, no extension and a bad agent note', () => {
    const registry = new CommentFileKindRegistry()
    registry.register(htmlKind)
    expect(() => registry.register(stubKind('html', ['.x']))).toThrow(/already registered/)
    expect(() => registry.register(stubKind('h2', ['.htm']))).toThrow(/another kind/)
    for (const bad of ['md', '.MD', '.m d', '']) expect(() => registry.register(stubKind('md', [bad]))).toThrow(/lower-case/)
    expect(() => registry.register(stubKind('md', []))).toThrow(/no extension/)
    expect(() => registry.register(stubKind('md', ['.md'], ['note to agents: a -- b']))).toThrow(/"md": agent note line 1/)
    expect(registry.extensions()).toEqual(['.html', '.htm'])
    registry.register(stubKind('md', ['.md', '.markdown']))
    expect(registry.kindOfName('README.md')?.id).toBe('md')
    expect(registry.frozen).toBe(false)
    registry.freeze()
    expect(registry.frozen).toBe(true)
  })
})

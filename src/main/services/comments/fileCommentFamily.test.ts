// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * 024-AC-028 item 5 (024-NFR-005; architecture note 001 § 8 C18): each channel
 * family serves a fixed set of file kinds, the requested and the real name map
 * to the same kind, and the `.txt` conformance kind is in no production
 * registry. Also: the renderer's mirrored list of commentable extensions
 * covers every registered one (024-FR-026, C6).
 */
import { symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COMMENTABLE_EXTENSIONS, isCommentableFileName } from '../../../shared/comments/commentableExtensions'
import { ErrorCode } from '../../../shared/errors'
import { commentFileKinds, fileCommentKinds, frozenCommentFileKinds } from './commentFileKinds'
import { createCommentUnsavedSources } from './commentUnsavedSources'
import { FileCommentService } from './FileCommentService'
import { fakeWatches, makeProject, PANEL, TEST_REVIEWER, type TempProject } from './__test-helpers__/fileCommentHarness'
import { createParagraphKind } from './__test-helpers__/paragraphKind'
import { createInProcessKindJobs } from './kindCommentJobs'

describe('024-AC-028 item 5: channel families are bound to fixed kinds', () => {
  it('the txt test kind is in no production registry', () => {
    for (const registry of [commentFileKinds, fileCommentKinds]) {
      expect(registry.kindById('txt')).toBeUndefined()
      expect(registry.kindOfName('notes.txt')).toBeUndefined()
      expect(registry.frozen).toBe(true)
    }
  })

  it('the file-comment family does not serve the HTML Preview\'s kind, and the HTML family serves only HTML', () => {
    expect(fileCommentKinds.kindOfName('index.html')).toBeUndefined()
    expect(commentFileKinds.extensions()).toEqual(['.html', '.htm'])
  })

  it('a frozen registry takes no kind after startup', () => {
    expect(() => fileCommentKinds.register(createParagraphKind())).toThrow(/frozen/)
  })

  it('every registered extension is in the renderer\'s commentable list', () => {
    for (const extension of [...commentFileKinds.extensions(), ...fileCommentKinds.extensions()]) {
      expect(COMMENTABLE_EXTENSIONS).toContain(extension)
    }
    expect(isCommentableFileName('C:\\proj\\Plan.MD')).toBe(true)
    expect(isCommentableFileName('/proj/notes.txt')).toBe(false)
    expect(isCommentableFileName('/proj/.md')).toBe(false)
  })

  describe('the requested and the real name map to the same kind', () => {
    let project: TempProject
    beforeEach(async () => {
      project = await makeProject()
    })
    afterEach(async () => project.dispose())

    it('a .txt name linked to a file of another kind is refused, and nothing is listed', async ctx => {
      const txt = createParagraphKind()
      const other = createParagraphKind({}, { id: 'note', extensions: ['.note'] })
      const service = new FileCommentService({
        kinds: frozenCommentFileKinds([txt, other]),
        unsaved: { hasAny: async () => false },
        identity: () => TEST_REVIEWER,
        send: () => {},
        jobs: createInProcessKindJobs(txt),
        watch: fakeWatches().factory
      })
      await project.write('real.note', 'Para.\n')
      try {
        await symlink(project.path('real.note'), project.path('alias.txt'))
      } catch {
        ctx.skip() // creating a symlink needs a privilege this host does not grant
      }
      const caller = { windowId: 1, root: project.root, realRoot: project.root }
      expect(await service.list(caller, { panelId: PANEL, filePath: project.path('alias.txt') })).toEqual({
        ok: false,
        code: ErrorCode.COMMENT_PATH_REFUSED,
        reason: 'kind-mismatch'
      })
      expect(service.watchCount).toBe(0)
    })
  })
})

describe('024-FR-026 every window\'s unsaved files', () => {
  it('hasAny sees a dirty file in any window; has stays per window', async () => {
    const root = resolve('/proj')
    const at = (name: string): string => join(root, name)
    const sources = createCommentUnsavedSources({ projectRoot: () => root, realpath: async path => path })
    await sources.set(1, [at('a.md')])
    await sources.set(2, [at('b.md')])
    expect(await sources.hasAny(at('b.md'))).toBe(true)
    expect(await sources.has(1, at('b.md'))).toBe(false)
    expect(await sources.hasAny(at('c.md'))).toBe(false)
    sources.forget(2)
    expect(await sources.hasAny(at('b.md'))).toBe(false)
  })
})

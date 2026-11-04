// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The reveal's folder rules (#453): which folders a tab switch opens, which it
 * closes again, and which become the person's.
 */
import { describe, it, expect } from 'vitest'
import type { FileNode } from '../../../../shared/ipc/file-schema'
import { claimForUser, planReveal, resolveReveal, revealPathsEqual } from './revealActiveFile'

const P = '/proj'

describe('resolveReveal', () => {
  /** The folders a reveal opens, on a POSIX platform with no tree read yet. */
  const folders = (projectPath: string | null, filePath: string | null, filter: 'all' | 'markdown' = 'all') =>
    resolveReveal(projectPath, filePath, filter, null, 'darwin')?.folders ?? null

  it('lists the folders down to the file, root first', () => {
    expect(folders(P, `${P}/src/services/toast.ts`)).toEqual([P, `${P}/src`, `${P}/src/services`])
  })

  it('needs only the root for a file at the top level', () => {
    expect(folders(P, `${P}/README.md`)).toEqual([P])
  })

  it('handles Windows separators', () => {
    expect(resolveReveal('C:\\proj', 'C:\\proj\\docs\\guide.md', 'all', null, 'win32')).toEqual({
      folders: ['C:\\proj', 'C:\\proj\\docs'],
      file: 'C:\\proj\\docs\\guide.md'
    })
  })

  it('reveals nothing for a file outside the project', () => {
    expect(folders(P, '/elsewhere/notes.md')).toBeNull()
    expect(folders(P, '/projector/notes.md')).toBeNull()
    expect(folders(P, P)).toBeNull()
  })

  it('reveals nothing the Markdown filter hides, and Markdown files through it', () => {
    expect(folders(P, `${P}/assets/logo.png`, 'markdown')).toBeNull()
    expect(folders(P, `${P}/site/index.html`, 'markdown')).toBeNull()
    expect(folders(P, `${P}/docs/Guide.MD`, 'markdown')).toEqual([P, `${P}/docs`])
    expect(folders(P, `${P}/assets/logo.png`)).toEqual([P, `${P}/assets`])
  })

  it('reveals nothing without a project or a file', () => {
    expect(folders(null, `${P}/a.md`)).toBeNull()
    expect(folders(P, null)).toBeNull()
  })

  describe('another spelling of the same path (pathsEqual rules)', () => {
    const WIN_ROOT = 'C:\\Proj'
    const tree: FileNode = {
      name: 'Proj', path: WIN_ROOT, type: 'directory', children: [
        { name: 'src', path: 'C:\\Proj\\src', type: 'directory', children: [
          { name: 'Toast.md', path: 'C:\\Proj\\src\\Toast.md', type: 'file', extension: '.md' }
        ] }
      ]
    }

    it('on Windows, finds the tree’s row for a path in other case and separators', () => {
      expect(resolveReveal(WIN_ROOT, 'c:/proj/src/toast.md', 'all', tree, 'win32')).toEqual({
        folders: [WIN_ROOT, 'C:\\Proj\\src'],
        file: 'C:\\Proj\\src\\Toast.md'
      })
    })

    it('on Windows, counts a differently cased path as inside the project', () => {
      expect(resolveReveal(WIN_ROOT, 'C:\\PROJ\\notes.md', 'all', null, 'win32')?.folders).toEqual([WIN_ROOT])
    })

    it('on Linux, keeps case: another case is another path', () => {
      expect(resolveReveal('/Proj', '/proj/src/toast.md', 'all', null, 'linux')).toBeNull()
      expect(resolveReveal('/Proj', '/Proj//src/toast.md', 'all', null, 'linux')?.folders).toEqual(['/Proj', '/Proj//src'])
    })

    describe('on macOS, where the disk ignores case and Unicode form', () => {
      const MAC_ROOT = '/Users/a/Proj'
      // 'Zażółć' with the accents composed (NFC), as the tree reads it
      const NFC_DIR = 'Za\u017C\u00F3\u0142\u0107'
      const macTree: FileNode = {
        name: 'Proj', path: MAC_ROOT, type: 'directory', children: [
          { name: 'docs', path: `${MAC_ROOT}/docs`, type: 'directory', children: [
            { name: 'README.md', path: `${MAC_ROOT}/docs/README.md`, type: 'file', extension: '.md' }
          ] },
          { name: NFC_DIR, path: `${MAC_ROOT}/${NFC_DIR}`, type: 'directory', children: [
            { name: 'a.md', path: `${MAC_ROOT}/${NFC_DIR}/a.md`, type: 'file', extension: '.md' }
          ] }
        ]
      }

      it('finds the tree’s row for a path in another letter case', () => {
        expect(resolveReveal(MAC_ROOT, `${MAC_ROOT}/Docs/readme.md`, 'all', macTree, 'darwin')).toEqual({
          folders: [MAC_ROOT, `${MAC_ROOT}/docs`],
          file: `${MAC_ROOT}/docs/README.md`
        })
      })

      it('counts a project root in another letter case as the project', () => {
        expect(resolveReveal(MAC_ROOT, '/Users/a/proj/docs/README.md', 'all', macTree, 'darwin')?.file).toBe(
          `${MAC_ROOT}/docs/README.md`
        )
      })

      it('finds the tree’s row for a path with decomposed accents (NFD)', () => {
        const nfd = `${MAC_ROOT}/${NFC_DIR.normalize('NFD')}/a.md`
        expect(nfd).not.toBe(`${MAC_ROOT}/${NFC_DIR}/a.md`)
        expect(resolveReveal(MAC_ROOT, nfd, 'all', macTree, 'darwin')).toEqual({
          folders: [MAC_ROOT, `${MAC_ROOT}/${NFC_DIR}`],
          file: `${MAC_ROOT}/${NFC_DIR}/a.md`
        })
      })

      it('prefers the exact spelling when a case-sensitive volume holds both', () => {
        const both: FileNode = {
          name: 'Proj', path: MAC_ROOT, type: 'directory', children: [
            { name: 'Notes.md', path: `${MAC_ROOT}/Notes.md`, type: 'file', extension: '.md' },
            { name: 'notes.md', path: `${MAC_ROOT}/notes.md`, type: 'file', extension: '.md' }
          ]
        }
        expect(resolveReveal(MAC_ROOT, `${MAC_ROOT}/notes.md`, 'all', both, 'darwin')?.file).toBe(`${MAC_ROOT}/notes.md`)
        expect(resolveReveal(MAC_ROOT, `${MAC_ROOT}/Notes.md`, 'all', both, 'darwin')?.file).toBe(`${MAC_ROOT}/Notes.md`)
      })
    })

    it('keeps the tab’s spelling below a folder the tree has not read', () => {
      expect(resolveReveal(WIN_ROOT, 'c:/proj/src/deep/x.md', 'all', tree, 'win32')).toEqual({
        folders: [WIN_ROOT, 'C:\\Proj\\src', 'c:/proj/src/deep'],
        file: 'c:/proj/src/deep/x.md'
      })
    })
  })
})

describe('revealPathsEqual', () => {
  it('folds case and Unicode form on macOS only', () => {
    const nfc = '/p/caf\u00E9.md'
    const nfd = nfc.normalize('NFD')
    expect(revealPathsEqual('/p/Docs', '/p/docs', 'darwin')).toBe(true)
    expect(revealPathsEqual(nfc, nfd, 'darwin')).toBe(true)
    expect(revealPathsEqual('/p/Docs', '/p/docs', 'linux')).toBe(false)
    expect(revealPathsEqual(nfc, nfd, 'linux')).toBe(false)
    expect(revealPathsEqual('C:\\P\\Docs', 'c:/p/docs', 'win32')).toBe(true)
  })

  it('never matches an empty path', () => {
    expect(revealPathsEqual('', '', 'darwin')).toBe(false)
    expect(revealPathsEqual('/p', '', 'darwin')).toBe(false)
  })
})

describe('planReveal', () => {
  it('opens every closed folder the file needs, and owns only those', () => {
    const plan = planReveal(new Set([P]), new Set(), [P, `${P}/src`, `${P}/src/a`])
    expect([...plan.expanded].sort()).toEqual([P, `${P}/src`, `${P}/src/a`])
    expect([...plan.owned].sort()).toEqual([`${P}/src`, `${P}/src/a`])
  })

  it('keeps the same set when every folder is already open', () => {
    const expanded = new Set([P, `${P}/docs`])
    const plan = planReveal(expanded, new Set(), [P, `${P}/docs`])
    expect(plan.expanded).toBe(expanded)
    expect(plan.owned.size).toBe(0)
  })

  it('closes the folders it opened for the previous tab on the next switch', () => {
    const expanded = new Set([P, `${P}/docs`, `${P}/src`, `${P}/src/a`])
    const plan = planReveal(expanded, new Set([`${P}/src`, `${P}/src/a`]), [P, `${P}/docs`])
    expect([...plan.expanded].sort()).toEqual([P, `${P}/docs`])
    expect(plan.owned.size).toBe(0)
  })

  it('closes them even when the new tab cannot be revealed', () => {
    const plan = planReveal(new Set([P, `${P}/src`]), new Set([`${P}/src`]), null)
    expect([...plan.expanded]).toEqual([P])
  })

  it('never closes a folder the person opened', () => {
    const plan = planReveal(new Set([P, `${P}/docs`]), new Set(), null)
    expect([...plan.expanded].sort()).toEqual([P, `${P}/docs`])
  })

  it('keeps a reveal-opened folder the next file also needs, still owned', () => {
    const expanded = new Set([P, `${P}/src`, `${P}/src/a`])
    const plan = planReveal(expanded, new Set([`${P}/src`, `${P}/src/a`]), [P, `${P}/src`, `${P}/src/b`])
    expect([...plan.expanded].sort()).toEqual([P, `${P}/src`, `${P}/src/b`])
    expect([...plan.owned].sort()).toEqual([`${P}/src`, `${P}/src/b`])
  })

  it('drops an owned folder the person already closed, and reopens it when needed', () => {
    const plan = planReveal(new Set([P]), new Set([`${P}/src`]), [P, `${P}/src`])
    expect([...plan.expanded].sort()).toEqual([P, `${P}/src`])
    expect([...plan.owned]).toEqual([`${P}/src`])
  })
})

describe('claimForUser', () => {
  const owned = new Set([`${P}/src`, `${P}/src/services`])

  it('hands over a reveal-opened folder the person worked inside', () => {
    const before = new Set([P, `${P}/src`, `${P}/src/services`])
    const after = new Set([...before, `${P}/src/components`])
    expect([...claimForUser(owned, before, after)]).toEqual([`${P}/src/services`])
  })

  it('counts closing a folder inside as working inside', () => {
    const before = new Set([P, `${P}/src`, `${P}/src/services`])
    const after = new Set([P, `${P}/src`])
    expect(claimForUser(owned, before, after).size).toBe(0)
  })

  it('stops owning a folder the person closed themselves', () => {
    const before = new Set([P, `${P}/src`, `${P}/src/services`])
    const after = new Set([P, `${P}/src/services`])
    expect([...claimForUser(owned, before, after)]).toEqual([`${P}/src/services`])
  })

  it('leaves the owned set alone for a change elsewhere', () => {
    const before = new Set([P, `${P}/src`, `${P}/src/services`])
    const after = new Set([...before, `${P}/docs`])
    expect(claimForUser(owned, before, after)).toBe(owned)
  })

  it('does nothing when the reveal owns nothing', () => {
    const none = new Set<string>()
    expect(claimForUser(none, new Set([P]), new Set([P, `${P}/x`]))).toBe(none)
  })
})

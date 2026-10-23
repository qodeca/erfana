// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File links on a truncated project tree (#320 review): links come from the
 * tree on hover, with no disk search; a click searches the project, offers
 * the tree's and the search's matches together and tells the picker the list
 * may be incomplete. A bare name the tree lacks is a link whose click
 * searches for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ILink, Terminal } from '@xterm/xterm'
import type { FileNode } from '../../../shared/ipc/file-schema'

const findByName = vi.hoisted(() => vi.fn())
const validatePath = vi.hoisted(() => vi.fn())
vi.mock('../services/fileGateway', () => ({ fileGateway: { findByName, validatePath } }))
vi.mock('../services/terminalGateway', () => ({
  terminalGateway: { getInfo: vi.fn(async () => ({ success: true, info: { cwd: '/project' } })) }
}))
vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { clearNameSearchCache, useTerminalFileLinks } from './useTerminalFileLinks'

const terminalShowing = (line: string): Terminal =>
  ({
    cols: 80,
    buffer: {
      active: {
        getLine: (i: number) => (i === 0 ? { isWrapped: false, translateToString: () => line } : undefined)
      }
    },
    registerLinkProvider: vi.fn(() => ({ dispose: () => {} }))
  }) as unknown as Terminal

const tree: FileNode[] = [
  { name: 'Button.tsx', path: '/project/src/Button.tsx', type: 'file', extension: '.tsx' },
  { name: 'big', path: '/project/big', type: 'directory', children: [], lazy: 'capped' }
]

beforeEach(() => {
  clearNameSearchCache()
  validatePath.mockReset().mockResolvedValue({ exists: false })
  findByName.mockReset().mockResolvedValue({ paths: ['/project/big/Button.tsx'], truncated: false })
})

interface Callbacks {
  onShowPicker: ReturnType<typeof vi.fn>
  onFileOpen: ReturnType<typeof vi.fn>
  onNameNotFound: ReturnType<typeof vi.fn>
}

async function linksFor(line: string, treeTruncated: boolean, callbacks: Callbacks): Promise<ILink[]> {
  const { result } = renderHook(() =>
    useTerminalFileLinks({
      terminalRef: { current: terminalShowing(line) },
      terminalId: 't1',
      projectRoot: '/project',
      files: tree,
      treeTruncated,
      ...callbacks
    })
  )
  await waitFor(() => expect(result.current.linkProvider).not.toBeNull())
  let links: ILink[] | undefined
  await result.current.linkProvider!.provideLinks(1, (found) => (links = found))
  return links ?? []
}

const callbacks = (): Callbacks => ({
  onShowPicker: vi.fn(async () => null),
  onFileOpen: vi.fn(),
  onNameNotFound: vi.fn()
})

describe('useTerminalFileLinks on a truncated tree', () => {
  it('shows the link from the tree without searching, and searches on the click (round 3, item 3)', async () => {
    const cb = callbacks()
    const links = await linksFor('see Button.tsx:3', true, cb)

    expect(links).toHaveLength(1)
    expect(findByName).not.toHaveBeenCalled()

    await links[0].activate(new MouseEvent('click'), links[0].text)

    expect(findByName).toHaveBeenCalledWith({ dirPath: '/project', name: 'Button.tsx' })
    const [candidates, , options] = cb.onShowPicker.mock.calls[0] as unknown as [Array<{ path: string }>, string, unknown]
    expect(candidates.map((c) => c.path).sort()).toEqual(['/project/big/Button.tsx', '/project/src/Button.tsx'])
    expect(options).toEqual({ incomplete: true })
  })

  it('makes a bare name the tree lacks a link whose click searches for it', async () => {
    findByName.mockResolvedValue({ paths: ['/project/big/Card.tsx'], truncated: false })
    const cb = callbacks()
    const links = await linksFor('see Card.tsx:7', true, cb)

    expect(links).toHaveLength(1)
    expect(findByName).not.toHaveBeenCalled()
    await links[0].activate(new MouseEvent('click'), links[0].text)

    const [candidates] = cb.onShowPicker.mock.calls[0] as unknown as [Array<{ path: string }>]
    expect(candidates.map((c) => c.path)).toEqual(['/project/big/Card.tsx'])
  })

  it('makes no search link of version, number or address tokens (round 4, item 1)', async () => {
    for (const line of [
      'Released v1.2 and 1.2.3 on 24.20.0',
      ' Tests  544 passed  Duration  1.74s (transform 12.3ms)',
      'pi is 3.14 and the ratio is 0.5x',
      'Listening on 127.0.0.1:3000'
    ]) {
      expect(await linksFor(line, true, callbacks())).toEqual([])
    }
    expect(findByName).not.toHaveBeenCalled()
  })

  it('passes cutShort when the search did not finish', async () => {
    findByName.mockResolvedValue({ paths: [], truncated: true })
    const cb = callbacks()
    const links = await linksFor('see Card.tsx:7', true, cb)

    await links[0].activate(new MouseEvent('click'), links[0].text)

    expect(cb.onNameNotFound).toHaveBeenCalledWith('Card.tsx', { cutShort: true })
  })

  it('says so when the clicked name is not found', async () => {
    findByName.mockResolvedValue({ paths: [], truncated: false })
    const cb = callbacks()
    const links = await linksFor('see Card.tsx:7', true, cb)

    await links[0].activate(new MouseEvent('click'), links[0].text)

    expect(cb.onNameNotFound).toHaveBeenCalledWith('Card.tsx', { cutShort: false })
    expect(cb.onShowPicker).not.toHaveBeenCalled()
    expect(cb.onFileOpen).not.toHaveBeenCalled()
  })

  it('on a complete tree opens a single match without searching, and makes no link of an unknown name', async () => {
    const cb = callbacks()
    const links = await linksFor('see Button.tsx:3', false, cb)
    await links[0].activate(new MouseEvent('click'), links[0].text)
    expect(findByName).not.toHaveBeenCalled()
    expect(cb.onShowPicker).not.toHaveBeenCalled()
    expect(cb.onFileOpen).toHaveBeenCalledWith('/project/src/Button.tsx', 3, undefined)

    expect(await linksFor('see Card.tsx:7', false, callbacks())).toEqual([])
  })
})

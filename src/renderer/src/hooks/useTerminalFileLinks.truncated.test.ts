// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A file link on a truncated project tree (#320 review, item 4): a bare name
 * that the tree knows is searched for on disk as well, and the picker is told
 * the list may be incomplete.
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

const LINE = 'see Button.tsx:3'
const fakeTerminal = {
  cols: 80,
  buffer: {
    active: {
      getLine: (i: number) => (i === 0 ? { isWrapped: false, translateToString: () => LINE } : undefined)
    }
  },
  registerLinkProvider: vi.fn(() => ({ dispose: () => {} }))
} as unknown as Terminal

const tree: FileNode[] = [
  { name: 'Button.tsx', path: '/project/src/Button.tsx', type: 'file', extension: '.tsx' },
  { name: 'big', path: '/project/big', type: 'directory', children: [], lazy: 'capped' }
]

beforeEach(() => {
  clearNameSearchCache()
  validatePath.mockReset().mockResolvedValue({ exists: false })
  findByName.mockReset().mockResolvedValue({ paths: ['/project/big/Button.tsx'], truncated: false })
})

async function linksFor(treeTruncated: boolean, onShowPicker: ReturnType<typeof vi.fn>): Promise<ILink[]> {
  const { result } = renderHook(() =>
    useTerminalFileLinks({
      terminalRef: { current: fakeTerminal },
      terminalId: 't1',
      projectRoot: '/project',
      files: tree,
      treeTruncated,
      onFileOpen: vi.fn(),
      onShowPicker
    })
  )
  await waitFor(() => expect(result.current.linkProvider).not.toBeNull())
  let links: ILink[] | undefined
  await result.current.linkProvider!.provideLinks(1, (found) => (links = found))
  return links ?? []
}

describe('useTerminalFileLinks on a truncated tree', () => {
  it('offers the tree match and the one found on disk, and says the list may be incomplete', async () => {
    const onShowPicker = vi.fn(async () => null)
    const links = await linksFor(true, onShowPicker)

    expect(links).toHaveLength(1)
    await links[0].activate(new MouseEvent('click'), links[0].text)

    expect(findByName).toHaveBeenCalledWith({ dirPath: '/project', name: 'Button.tsx' })
    const [candidates, , options] = onShowPicker.mock.calls[0] as unknown as [Array<{ path: string }>, string, unknown]
    expect(candidates.map((c) => c.path).sort()).toEqual(['/project/big/Button.tsx', '/project/src/Button.tsx'])
    expect(options).toEqual({ incomplete: true })
  })

  it('opens a single match on a complete tree without searching', async () => {
    const onShowPicker = vi.fn(async () => null)
    const links = await linksFor(false, onShowPicker)

    await links[0].activate(new MouseEvent('click'), links[0].text)

    expect(findByName).not.toHaveBeenCalled()
    expect(onShowPicker).not.toHaveBeenCalled()
  })
})

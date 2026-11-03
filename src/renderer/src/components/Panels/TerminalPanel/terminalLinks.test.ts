// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { openTerminalLink, wantsSystemBrowser, warnTerminalLinkNotOpened, type TerminalLinkDeps } from './terminalLinks'

vi.mock('../../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

function deps(mac: boolean, tabOpens = true): TerminalLinkDeps & {
  openExternal: ReturnType<typeof vi.fn>
  openInTab: ReturnType<typeof vi.fn>
} {
  return {
    isMac: () => mac,
    openExternal: vi.fn(() => Promise.resolve()),
    openInTab: vi.fn(() => Promise.resolve(tabOpens))
  }
}

const click = (mods: Partial<Pick<MouseEvent, 'metaKey' | 'ctrlKey'>> = {}): MouseEvent =>
  ({ metaKey: false, ctrlKey: false, ...mods }) as MouseEvent

describe('wantsSystemBrowser', () => {
  it('reads Cmd on macOS and Ctrl elsewhere', () => {
    expect(wantsSystemBrowser({ metaKey: true, ctrlKey: false }, true)).toBe(true)
    expect(wantsSystemBrowser({ metaKey: false, ctrlKey: true }, true)).toBe(false)
    expect(wantsSystemBrowser({ metaKey: false, ctrlKey: true }, false)).toBe(true)
    expect(wantsSystemBrowser({ metaKey: true, ctrlKey: false }, false)).toBe(false)
  })
})

describe('openTerminalLink (025-AC-009)', () => {
  it.each(['http://localhost:4100/', 'https://github.test/qodeca/erfana'])('opens %s in a browser tab on a plain click', async url => {
    const d = deps(true)
    await openTerminalLink(url, click(), d)
    expect(d.openInTab).toHaveBeenCalledWith(url)
    expect(d.openExternal).not.toHaveBeenCalled()
  })

  it('opens the OS browser on Cmd-click (macOS) and Ctrl-click (elsewhere), with no tab', async () => {
    const mac = deps(true)
    await openTerminalLink('https://github.test/', click({ metaKey: true }), mac)
    expect(mac.openExternal).toHaveBeenCalledWith('https://github.test/')
    expect(mac.openInTab).not.toHaveBeenCalled()
    const other = deps(false)
    await openTerminalLink('https://github.test/', click({ ctrlKey: true }), other)
    expect(other.openExternal).toHaveBeenCalledWith('https://github.test/')
    expect(other.openInTab).not.toHaveBeenCalled()
  })

  it('falls back to the OS browser when there is no editor area to open a tab in', async () => {
    const d = deps(false, false)
    await openTerminalLink('https://github.test/', click(), d)
    expect(d.openInTab).toHaveBeenCalled()
    expect(d.openExternal).toHaveBeenCalledWith('https://github.test/')
  })

  it('sends any other scheme down the checked external-open path', async () => {
    const d = deps(false)
    await openTerminalLink('mailto:a@b.test', click(), d)
    await openTerminalLink('not a url', click(), d)
    expect(d.openInTab).not.toHaveBeenCalled()
    expect(d.openExternal).toHaveBeenCalledTimes(2)
  })

  it('passes an external-open refusal to the caller', async () => {
    const d = deps(false)
    d.openExternal.mockRejectedValueOnce(new Error('refused'))
    await expect(openTerminalLink('https://x.test/', click({ ctrlKey: true }), d)).rejects.toThrow('refused')
  })

  it('logs a failure without the URL', async () => {
    const { logger } = await import('../../../utils/logger')
    warnTerminalLinkNotOpened(new Error('refused'))
    warnTerminalLinkNotOpened('odd')
    expect(logger.warn).toHaveBeenCalledWith('Terminal link not opened', { error: 'refused' })
    expect(logger.warn).toHaveBeenCalledWith('Terminal link not opened', { error: 'odd' })
  })
})

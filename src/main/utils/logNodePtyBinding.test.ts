// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { info, warn } = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))
vi.mock('../services/LoggingService', () => ({ logger: { info, warn } }))

import { describeNodePtyBinding, logNodePtyBinding } from './logNodePtyBinding'

describe('logNodePtyBinding', () => {
  beforeEach(() => {
    info.mockClear()
    warn.mockClear()
  })

  it('logs only the part under node_modules', () => {
    expect(describeNodePtyBinding('../build/Release/')).toBe('node_modules/node-pty/build/Release/conpty.node')
    expect(describeNodePtyBinding('./prebuilds/win32-x64/')).toBe(
      'node_modules/node-pty/prebuilds/win32-x64/conpty.node'
    )
  })

  it('logs the loaded binding on win32', () => {
    logNodePtyBinding('win32', () => () => ({ dir: '../build/Release/' }))
    expect(info).toHaveBeenCalledWith('node-pty native binding loaded', {
      binding: 'node_modules/node-pty/build/Release/conpty.node'
    })
  })

  it('does nothing off win32', () => {
    const load = vi.fn()
    logNodePtyBinding('darwin', load)
    expect(load).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('warns instead of throwing when the loader fails', () => {
    expect(() =>
      logNodePtyBinding('win32', () => () => {
        throw new Error('nope')
      })
    ).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})

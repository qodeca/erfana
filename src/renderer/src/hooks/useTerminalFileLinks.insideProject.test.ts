// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { isLinkableFile } from './useTerminalFileLinks'

describe('isLinkableFile', () => {
  it('accepts a file inside the open project', () => {
    expect(isLinkableFile({ exists: true, insideProject: true }, 'proj')).toBe(true)
  })

  it('refuses a file outside the open project', () => {
    expect(isLinkableFile({ exists: true, insideProject: false }, 'proj')).toBe(false)
  })

  it('accepts any existing file when no project is open', () => {
    expect(isLinkableFile({ exists: true, insideProject: false }, null)).toBe(true)
    expect(isLinkableFile({ exists: true, insideProject: false }, undefined)).toBe(true)
  })

  it('counts an answer without insideProject as inside', () => {
    expect(isLinkableFile({ exists: true }, 'proj')).toBe(true)
  })

  it('refuses a file that does not exist', () => {
    expect(isLinkableFile({ exists: false, insideProject: true }, 'proj')).toBe(false)
  })
})

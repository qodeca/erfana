// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * untrustedToolMessage (#250): the one wording source for an unsafe LibreOffice
 * – main's conversion refusal, the Settings hint and the import refusal.
 */
import { describe, it, expect } from 'vitest'
import { untrustedToolMessage } from './errors'
import { UNSAFE_TOOL_REASONS } from './unsafeTool'

describe('untrustedToolMessage', () => {
  it.each([
    ['project', 'soffice is in the open project. Remove that folder from PATH'],
    ['temp', 'soffice is in a temporary folder. Remove that folder from PATH'],
    ['network', 'soffice would be looked up on a network share listed in PATH. Remove the network share from PATH'],
    ['relative', 'soffice comes from a relative PATH entry. Remove that entry from PATH'],
    ['unresolvable', 'soffice could not be checked, because its real location cannot be resolved. Reinstall it'],
    ['ambiguous', 'soffice has copies in more than one PATH folder, and Erfana cannot tell which one would run. Remove the extra copy']
  ] as const)('names the %s reason and its fix', (reason, text) => {
    expect(untrustedToolMessage('soffice', reason).startsWith(`Erfana will not run LibreOffice: ${text}`)).toBe(true)
  })

  it('explains a helper as the program LiteParse uses to find LibreOffice', () => {
    expect(untrustedToolMessage('which', 'project')).toBe(
      'Erfana will not run LibreOffice: the which program LiteParse uses to find LibreOffice is in the open project. ' +
        'Remove that folder from PATH, then try again.'
    )
  })

  it('has wording for every reason and never a path', () => {
    for (const reason of UNSAFE_TOOL_REASONS) {
      const text = untrustedToolMessage('soffice', reason)
      expect(text).toMatch(/^Erfana will not run LibreOffice: soffice .+\. .+\.$/)
      expect(text).not.toMatch(/[\\/]/)
    }
  })
})

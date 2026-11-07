// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The browser view's pinned settings (spec 025, 025-NFR-001, S-3). */
import { describe, expect, it } from 'vitest'
import type { Session } from 'electron'

import {
  BROWSER_WEB_PREFERENCES,
  BROWSER_WEB_PREFERENCES_LINUX,
  adoptedBrowserViewOptions,
  buildBrowserWebPreferences
} from './browserWebPreferences'

const SESSION = { name: 'browser' } as unknown as Session

/** The 025-NFR-001 list and the S-3 additions, written out again on purpose. */
const EXPECTED = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  navigateOnDragDrop: false,
  safeDialogs: true,
  devTools: true,
  disableHtmlFullscreenWindowResize: true,
  focusOnNavigation: false,
  autoplayPolicy: 'document-user-activation-required',
  backgroundThrottling: true,
  images: true,
  javascript: true,
  spellcheck: true
}

describe('BROWSER_WEB_PREFERENCES', () => {
  it('is the 025-NFR-001 literal with the S-3 keys, frozen', () => {
    expect(BROWSER_WEB_PREFERENCES).toEqual(EXPECTED)
    expect(Object.isFrozen(BROWSER_WEB_PREFERENCES)).toBe(true)
    expect(Object.isFrozen(BROWSER_WEB_PREFERENCES_LINUX)).toBe(true)
  })

  it.each(['darwin', 'win32'] as const)('constructs exactly the literal plus the session on %s', (platform) => {
    const { session, ...rest } = buildBrowserWebPreferences(SESSION, platform)
    expect(session).toBe(SESSION)
    expect(rest).toEqual(BROWSER_WEB_PREFERENCES)
  })

  it('constructs the Linux literal, spell check off, on Linux (S-4)', () => {
    const { session, ...rest } = buildBrowserWebPreferences(SESSION, 'linux')
    expect(session).toBe(SESSION)
    expect(rest).toEqual({ ...EXPECTED, spellcheck: false })
    expect(BROWSER_WEB_PREFERENCES_LINUX).toEqual({ ...EXPECTED, spellcheck: false })
  })

  it('has no preload and no Blink feature switch', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const built = buildBrowserWebPreferences(SESSION, platform)
      expect('preload' in built).toBe(false)
      expect('enableBlinkFeatures' in built).toBe(false)
      expect('additionalArguments' in built).toBe(false)
    }
  })
})

describe('adoptedBrowserViewOptions', () => {
  const CONTENTS = { id: 7 }

  it.each(['darwin', 'win32'] as const)('wraps a page-opened webContents with the whole literal again, and no session, on %s', (platform) => {
    const options = adoptedBrowserViewOptions(CONTENTS, platform)
    expect(options.webContents).toBe(CONTENTS)
    expect(options.webPreferences).toEqual(EXPECTED)
    expect('session' in options.webPreferences).toBe(false)
  })

  it('gives the Linux literal on Linux, as a fresh copy each time', () => {
    const first = adoptedBrowserViewOptions(CONTENTS, 'linux')
    expect(first.webPreferences).toEqual({ ...EXPECTED, spellcheck: false })
    expect(first.webPreferences).not.toBe(BROWSER_WEB_PREFERENCES_LINUX)
    expect(adoptedBrowserViewOptions(CONTENTS, 'linux').webPreferences).not.toBe(first.webPreferences)
  })
})

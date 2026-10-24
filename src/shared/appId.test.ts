// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The runtime AppUserModelID must equal the installer's. electron-builder's NSIS template stamps
 * `appId` on the Start menu and desktop shortcuts; if the running app reports a different ID,
 * Windows shows it as a second taskbar icon and toast notifications lose the app name and icon.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { APP_ID } from './constants'

describe('APP_ID', () => {
  it('equals appId in electron-builder.yml', () => {
    const raw = readFileSync(join(__dirname, '../../electron-builder.yml'), 'utf8')
    const config = load(raw) as { appId?: string }
    expect(APP_ID).toBe(config.appId)
  })
})

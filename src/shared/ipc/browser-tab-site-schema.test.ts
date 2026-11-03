// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The certificate page and sign-in row payload parts (025-FR-021,
 * 025-FR-022), alone and inside the state and strip events.
 */
import { describe, expect, it } from 'vitest'
import { StripRowSchema, TabStateEventSchema } from './browser-tab-schema'
import { CertificateWarningSchema, SignInRowSchema } from './browser-tab-site-schema'

const WARNING = { decisionId: 'd1', host: 'selfsigned.test', code: -202, shownAt: 0 }
const SIGN_IN = { username: 'u', savedPassword: true, insecure: false, rejected: null, remember: 'noKeyring' }

describe('browser-tab-site-schema', () => {
  it('accepts a certificate warning and refuses a bad id, a positive code or an extra key', () => {
    expect(CertificateWarningSchema.safeParse(WARNING).success).toBe(true)
    expect(CertificateWarningSchema.safeParse({ ...WARNING, decisionId: 'd 1' }).success).toBe(false)
    expect(CertificateWarningSchema.safeParse({ ...WARNING, code: 5 }).success).toBe(false)
    expect(CertificateWarningSchema.safeParse({ ...WARNING, fingerprint: 'ab' }).success).toBe(false)
  })

  it('accepts a sign-in row and never carries a password', () => {
    expect(SignInRowSchema.safeParse(SIGN_IN).success).toBe(true)
    expect(SignInRowSchema.safeParse({ ...SIGN_IN, rejected: 'saved', remember: 'available' }).success).toBe(true)
    expect(SignInRowSchema.safeParse({ ...SIGN_IN, password: 'secret' }).success).toBe(false)
    expect(SignInRowSchema.safeParse({ ...SIGN_IN, remember: 'maybe' }).success).toBe(false)
  })

  it('is part of the state event and of a strip row', () => {
    const row = { requestId: 'r1', kind: 'signIn', text: 'Sign in to a.test', answers: ['signIn', 'cancel'], takesFocus: true, signIn: SIGN_IN }
    expect(StripRowSchema.safeParse(row).success).toBe(true)
    const state = {
      tabId: 'browser-tab-1',
      committedUrl: null,
      pendingUrl: null,
      origin: null,
      title: '',
      canGoBack: false,
      canGoForward: false,
      loading: false,
      zoomPercent: 100,
      widthPreset: 'full',
      security: 'warningUp',
      inUse: { camera: false, microphone: false, screen: false },
      erfanaPage: 'certificate',
      certificate: WARNING,
      devToolsOpen: false
    }
    expect(TabStateEventSchema.safeParse(state).success).toBe(true)
  })
})

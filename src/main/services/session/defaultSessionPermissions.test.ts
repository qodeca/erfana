// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The global setup stubs senderValidation; this suite needs the real predicate.
vi.unmock('../../ipc/senderValidation')

const isDev = vi.hoisted(() => ({ value: false }))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return isDev.value
    }
  }
}))

import { installDefaultSessionPermissions } from './defaultSessionPermissions'
import { RENDERER_FILE_URL } from '../../ipc/senderValidation'

// electron-vite declares ELECTRON_RENDERER_URL read-only; this file sets and clears it.
const writableEnv: Record<string, string | undefined> = process.env

type RequestHandler = (
  wc: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details: Record<string, unknown>
) => void
type CheckHandler = (
  wc: unknown,
  permission: string,
  origin: string,
  details: Record<string, unknown>
) => boolean

function install(): { request: RequestHandler; check: CheckHandler } {
  let request!: RequestHandler
  let check!: CheckHandler
  installDefaultSessionPermissions({
    setPermissionRequestHandler: (h: RequestHandler) => (request = h),
    setPermissionCheckHandler: (h: CheckHandler) => (check = h)
  } as never)
  return { request, check }
}

function ask(
  permission: string,
  details: Record<string, unknown>
): { request: boolean; check: boolean } {
  const { request, check } = install()
  let granted: boolean | undefined
  request(null, permission, (g) => (granted = g), details)
  // The sync check reports one kind per call; a mixed request has no single kind.
  const kinds = (details.mediaTypes as string[] | undefined) ?? []
  const mediaType = kinds.length === 1 ? kinds[0] : undefined
  return {
    request: granted === true,
    check: check(null, permission, 'x', {
      requestingUrl: details.requestingUrl,
      isMainFrame: details.isMainFrame,
      ...(mediaType ? { mediaType } : {})
    })
  }
}

describe('default session permissions', () => {
  const originalDevUrl = process.env['ELECTRON_RENDERER_URL']

  beforeEach(() => {
    isDev.value = false
    delete writableEnv.ELECTRON_RENDERER_URL
  })

  afterEach(() => {
    if (originalDevUrl === undefined) delete writableEnv.ELECTRON_RENDERER_URL
    else writableEnv.ELECTRON_RENDERER_URL = originalDevUrl
  })

  const app = { requestingUrl: RENDERER_FILE_URL, isMainFrame: true }

  it('installs both handlers', () => {
    const set = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
    installDefaultSessionPermissions(set as never)
    expect(set.setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    expect(set.setPermissionCheckHandler).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['camera from the bundled app page', 'media', { ...app, mediaTypes: ['video'] }, true],
    [
      'camera from the app page with a route hash',
      'media',
      { ...app, requestingUrl: `${RENDERER_FILE_URL}#/settings`, mediaTypes: ['video'] },
      true
    ],
    ['microphone', 'media', { ...app, mediaTypes: ['audio'] }, false],
    ['camera plus microphone', 'media', { ...app, mediaTypes: ['video', 'audio'] }, false],
    ['media with no kind given', 'media', { ...app, mediaTypes: [] }, false],
    [
      'camera from another file',
      'media',
      { requestingUrl: 'file:///tmp/other.html', isMainFrame: true, mediaTypes: ['video'] },
      false
    ],
    [
      'camera from a web page',
      'media',
      { requestingUrl: 'https://example.com/', isMainFrame: true, mediaTypes: ['video'] },
      false
    ],
    [
      'camera from a sub frame',
      'media',
      { ...app, isMainFrame: false, mediaTypes: ['video'] },
      false
    ],
    ['camera with no URL', 'media', { isMainFrame: true, mediaTypes: ['video'] }, false],
    ['screen capture', 'display-capture', app, false],
    ['geolocation', 'geolocation', app, false],
    ['notifications', 'notifications', app, false],
    ['clipboard read', 'clipboard-read', app, false],
    ['fullscreen', 'fullscreen', app, false],
    ['open external', 'openExternal', app, false],
    ['usb', 'usb', app, false]
  ])('%s', (_name, permission, details, expected) => {
    const result = ask(permission as string, details as Record<string, unknown>)
    expect(result.request).toBe(expected)
    expect(result.check).toBe(expected)
  })

  it('in dev, trusts the dev-server origin and still denies others', () => {
    isDev.value = true
    writableEnv.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const media = { isMainFrame: true, mediaTypes: ['video'] }

    expect(ask('media', { ...media, requestingUrl: 'http://localhost:5173/' }).request).toBe(true)
    expect(ask('media', { ...media, requestingUrl: 'http://localhost:9999/' }).request).toBe(false)
    expect(ask('media', { ...media, requestingUrl: RENDERER_FILE_URL }).request).toBe(false)
  })
})

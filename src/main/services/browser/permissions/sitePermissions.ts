// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What a site permission prompt asks and says (spec 025, 025-FR-019; design
 * `docs/designs/browser/site-prompts.html`, permission kind).
 *
 * Pure helpers shared by the permission broker and its tests:
 *
 * - {@link sitePermissionsFor} turns an Electron permission request into the
 *   permissions the prompt names (a `media` request for video and audio is
 *   one prompt for the camera and the microphone).
 * - {@link siteOrigin} reads the origin a decision is saved under. Only
 *   `http`, `https` and `erfana-local` pages have one; an opaque origin
 *   (`null`, `data:`, `about:blank`) has none, and its request is denied.
 * - {@link permissionPromptText} composes the row's sentence from formatted
 *   origins and fixed words: "{frame}, inside {page}, wants to use your
 *   camera". The origin comes from the engine, never from the page.
 */
import type { SitePermission, StripAnswer } from '../../../../shared/ipc/browser-tab-schema'
import { BROWSER_LOCAL_SCHEME } from '../browserLocalScheme'

/** Permissions whose answer is never saved: screen sharing always asks, as in Chrome. */
export const NEVER_SAVED: ReadonlySet<SitePermission> = new Set<SitePermission>(['screen'])

/** Permissions that offer **Allow once** next to **Allow**. */
const ALLOW_ONCE: ReadonlySet<SitePermission> = new Set<SitePermission>(['camera', 'microphone'])

/** The fixed order a prompt names permissions in. */
const ORDER: readonly SitePermission[] = ['camera', 'microphone', 'screen', 'location', 'notifications', 'clipboardRead']

const SINGLE_PHRASE: Readonly<Record<SitePermission, string>> = {
  camera: 'wants to use your camera',
  microphone: 'wants to use your microphone',
  screen: 'wants to see your screen',
  location: 'wants to know your location',
  notifications: 'wants to show notifications',
  clipboardRead: 'wants to see what you copy'
}

/** The part of Electron's request details this module reads. */
export interface PermissionRequestDetails {
  readonly mediaTypes?: readonly ('video' | 'audio')[]
  readonly securityOrigin?: string
  readonly requestingUrl?: string
}

/** The permissions an Electron permission request asks for; empty when it asks for nothing this module prompts for. */
export function sitePermissionsFor(permission: string, details: PermissionRequestDetails): SitePermission[] {
  switch (permission) {
    case 'media': {
      const types = details.mediaTypes ?? []
      const asked: SitePermission[] = []
      if (types.includes('video')) asked.push('camera')
      if (types.includes('audio')) asked.push('microphone')
      return asked
    }
    case 'geolocation':
    case 'geolocation-approximate':
      return ['location']
    case 'clipboard-read':
      return ['clipboardRead']
    case 'display-capture':
      return ['screen']
    case 'notifications':
      return ['notifications']
    default:
      return []
  }
}

/** `permissions` in the fixed order, without repeats. */
export function orderedPermissions(permissions: Iterable<SitePermission>): SitePermission[] {
  const set = new Set(permissions)
  return ORDER.filter((p) => set.has(p))
}

/**
 * The origin `url` belongs to, as decisions are keyed: `scheme://host[:port]`
 * for `http`, `https` and `erfana-local`; `null` for anything else or an
 * address that does not parse.
 */
export function siteOrigin(url: string | undefined | null): string | null {
  if (url === undefined || url === null || url === '') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin
  // Node's URL does not know the scheme is registered as standard, so it
  // reports the origin as opaque; the host is still the origin's identity.
  if (parsed.protocol === `${BROWSER_LOCAL_SCHEME}:` && parsed.host !== '') return `${parsed.protocol}//${parsed.host}`
  return null
}

/** The origin a request comes from: the media request's security origin, else the requesting frame's address. */
export function requestingOrigin(details: PermissionRequestDetails): string | null {
  return siteOrigin(details.securityOrigin) ?? siteOrigin(details.requestingUrl)
}

/** Whether the prompt for `permissions` offers **Allow once**. */
export function offersAllowOnce(permissions: readonly SitePermission[]): boolean {
  return permissions.length > 0 && permissions.every((p) => ALLOW_ONCE.has(p))
}

/** The answers of a permission row, in display order (design: Block, Allow once, Allow, then Dismiss). */
export function permissionAnswers(permissions: readonly SitePermission[]): StripAnswer[] {
  return offersAllowOnce(permissions) ? ['block', 'allowOnce', 'allow', 'dismiss'] : ['block', 'allow', 'dismiss']
}

/** "wants to use your camera and microphone", or the one permission's phrase. */
export function requestPhrase(permissions: readonly SitePermission[]): string {
  const ordered = orderedPermissions(permissions)
  if (ordered.length === 2 && ordered[0] === 'camera' && ordered[1] === 'microphone') {
    return 'wants to use your camera and microphone'
  }
  return ordered.map((p) => SINGLE_PHRASE[p]).join(' and ')
}

/**
 * The asker as the row names it: the requesting origin, followed by
 * ", inside {top origin}," when a frame of another origin asks (the design's
 * one frame grammar, asker first).
 */
export function askerText(requesting: string, inside: string | null): string {
  return inside === null ? requesting : `${requesting}, inside ${inside},`
}

/** The permission row's sentence. */
export function permissionPromptText(
  requesting: string,
  inside: string | null,
  permissions: readonly SitePermission[]
): string {
  return `${askerText(requesting, inside)} ${requestPhrase(permissions)}`
}

/** The 4-second notice of fullscreen or pointer lock (025-FR-019); its fixed sentence carries the full stop. */
export function lockNoticeText(kind: 'fullscreen' | 'pointerLock', origin: string): string {
  return kind === 'fullscreen'
    ? `${origin} is now full screen. Press Esc to exit.`
    : `${origin} has hidden your pointer. Press Esc to exit.`
}

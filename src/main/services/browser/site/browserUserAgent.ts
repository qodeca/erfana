// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the built-in browser presents as its browser (spec 025, 025-FR-024;
 * solution design § 3.5 `browserUserAgent`, § 5).
 *
 * One Chromium-only identity for every page, frame, worker and popup of a
 * browser session: the user-agent string of a Chrome of the bundled
 * Chromium's major version, in Chrome's reduced form, and the client-hint
 * metadata Chromium itself would build for that version (the GREASE brand,
 * the `Chromium` brand, the platform facts), with no Electron or Erfana token.
 *
 * Two routes carry it, because neither reaches everything on Electron 44:
 *
 * - `session.setUserAgent` ({@link browserUserAgent}, `browserSessionPolicy`)
 *   covers the tabs Erfana loads itself. It does not reach a page-opened
 *   window: Electron wraps a `window.open` child without the session's user
 *   agent, so its first navigation and its `navigator` carry Electron's
 *   default ("… ERFANA/<version> … Electron/<version> …", measured on 44.9.3).
 * - The DevTools protocol ({@link BrowserUserAgentOverride}): every target of a
 *   browser CDP session gets the override before it runs –
 *   `Emulation.setUserAgentOverride` on frame targets (tab, popup, frame) and
 *   `Network.setUserAgentOverride` on workers, whose own requests otherwise
 *   carry no `Sec-CH-UA` at all (measured on 44.9.3). `cdpAllowList.ts` pins
 *   both methods to exactly {@link currentBrowserUserAgentOverride}.
 *
 * High-entropy values follow Chromium's `embedder_support` where Node can
 * read the same fact. One cannot: Chrome's Windows `platformVersion` is the
 * registry's UniversalApiContract version, which the main process cannot
 * read without a child process; it is sent empty, as on Linux.
 */
import { platform as osPlatform, arch as osArch } from 'node:process'

/** One `navigator.userAgentData` brand (CDP `Emulation.UserAgentBrandVersion`). */
export interface UserAgentBrand {
  readonly brand: string
  readonly version: string
}

/** CDP `Emulation.UserAgentMetadata`: what `Sec-CH-UA-*` and `navigator.userAgentData` report. */
export interface UserAgentMetadata {
  readonly brands: readonly UserAgentBrand[]
  readonly fullVersionList: readonly UserAgentBrand[]
  readonly platform: string
  readonly platformVersion: string
  readonly architecture: string
  readonly model: string
  readonly mobile: boolean
  readonly bitness: string
  readonly wow64: boolean
  readonly formFactors: readonly string[]
}

/** The parameters of `Emulation.setUserAgentOverride` and `Network.setUserAgentOverride`. */
export interface BrowserUserAgentOverride {
  readonly userAgent: string
  readonly userAgentMetadata: UserAgentMetadata
}

/** The facts the identity is built from. */
export interface UserAgentFacts {
  readonly platform: NodeJS.Platform
  /** `process.versions.chrome`. */
  readonly chromeVersion: string
  /** `process.arch`. */
  readonly arch: string
  /** `process.getSystemVersion()` (Electron), e.g. `15.2.0` on macOS; empty when unknown. */
  readonly systemVersion: string
}

/** Chromium's GREASE characters and versions (`GetGreasedUserAgentBrandVersion`). */
const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'] as const
const GREASE_VERSIONS = ['8', '99', '24'] as const
/** `blink::kDesktopFormFactor`. */
const DESKTOP_FORM_FACTOR = 'Desktop'

/** The Chrome platform token of the reduced user agent Chrome itself sends. */
function platformToken(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7'
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64'
  return 'X11; Linux x86_64'
}

/** The leading number of `chromeVersion`, or `0` when it has none. */
function majorOf(chromeVersion: string): number {
  const major = /^\d+/.exec(chromeVersion)?.[0]
  return major === undefined ? 0 : Number(major)
}

/**
 * The user agent of a Chrome of the bundled Chromium's major version, in
 * Chrome's reduced form (minor, build and patch are `0`), with no Electron or
 * Erfana token (025-FR-024).
 *
 * @param chromeVersion `process.versions.chrome`
 */
export function browserUserAgent(platform: NodeJS.Platform, chromeVersion: string): string {
  return `Mozilla/5.0 (${platformToken(platform)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorOf(chromeVersion)}.0.0.0 Safari/537.36`
}

/**
 * The brand list Chromium builds for an unbranded (Chromium) build of
 * `major`: the GREASE brand, then `Chromium`, shuffled by the major version
 * as the seed (`GenerateBrandVersionList`, `GetRandomOrder` for two entries).
 *
 * @param version the version each real brand carries: the major, or the full version
 * @param full whether the GREASE brand carries a full version (`99.0.0.0`)
 */
export function chromiumBrands(major: number, version: string, full: boolean): UserAgentBrand[] {
  const greaseVersion = GREASE_VERSIONS[major % GREASE_VERSIONS.length]!
  const grease: UserAgentBrand = {
    brand: `Not${GREASE_CHARS[major % GREASE_CHARS.length]!}A${GREASE_CHARS[(major + 1) % GREASE_CHARS.length]!}Brand`,
    version: full ? `${greaseVersion}.0.0.0` : greaseVersion
  }
  const list = [grease, { brand: 'Chromium', version }]
  const shuffled: UserAgentBrand[] = []
  list.forEach((entry, i) => {
    shuffled[(major + i) % list.length] = entry
  })
  return shuffled
}

/** Chromium's `GetPlatformForUAMetadata` for the desktop platforms. */
function metadataPlatform(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  return 'Linux'
}

/** Chromium's `GetCpuArchitecture`: `arm` or `x86`. */
function metadataArchitecture(arch: string): string {
  return arch.startsWith('arm') ? 'arm' : 'x86'
}

/** Chromium's `GetPlatformVersion`: `major.minor.bugfix` on macOS, empty on Linux (and on Windows, see the module note). */
function metadataPlatformVersion(platform: NodeJS.Platform, systemVersion: string): string {
  if (platform !== 'darwin') return ''
  const parts = systemVersion.split('.')
  return [0, 1, 2].map(i => (parts[i] === undefined || parts[i] === '' ? '0' : parts[i])).join('.')
}

/** The whole identity for `facts`. */
export function browserUserAgentOverride(facts: UserAgentFacts): BrowserUserAgentOverride {
  const major = majorOf(facts.chromeVersion)
  return {
    userAgent: browserUserAgent(facts.platform, facts.chromeVersion),
    userAgentMetadata: {
      brands: chromiumBrands(major, String(major), false),
      fullVersionList: chromiumBrands(major, facts.chromeVersion, true),
      platform: metadataPlatform(facts.platform),
      platformVersion: metadataPlatformVersion(facts.platform, facts.systemVersion),
      architecture: metadataArchitecture(facts.arch),
      model: '',
      mobile: false,
      bitness: facts.arch === 'ia32' || facts.arch === 'arm' ? '32' : '64',
      wow64: false,
      formFactors: [DESKTOP_FORM_FACTOR]
    }
  }
}

/**
 * The command that carries the identity to a CDP target of `targetType`:
 * `Network` for a worker (`worker`, `shared_worker`, `service_worker`), which
 * has no `Emulation` domain; `Emulation` for a page or a frame.
 */
export function userAgentOverrideMethod(targetType: string): 'Network.setUserAgentOverride' | 'Emulation.setUserAgentOverride' {
  return targetType.endsWith('worker') ? 'Network.setUserAgentOverride' : 'Emulation.setUserAgentOverride'
}

/** Electron adds `getSystemVersion` to `process`; Node (unit tests) does not have it. */
function systemVersion(): string {
  const read = (process as { getSystemVersion?: () => string }).getSystemVersion
  return typeof read === 'function' ? read.call(process) : ''
}

let current: BrowserUserAgentOverride | null = null

/** This process's identity, built once and frozen. */
export function currentBrowserUserAgentOverride(): BrowserUserAgentOverride {
  if (current === null) {
    const built = browserUserAgentOverride({
      platform: osPlatform,
      chromeVersion: process.versions.chrome ?? '0',
      arch: osArch,
      systemVersion: systemVersion()
    })
    current = deepFreeze(built)
  }
  return current
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

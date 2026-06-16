// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Screenshot IPC Schema
 *
 * Defines Zod schemas and TypeScript types for screenshot capture IPC.
 * Used by both main process (ScreenshotService) and renderer (TerminalPanel).
 *
 * @see Issue #86 - Screenshot capture buttons for terminal panel
 * @see Issue #164 - Windows Phase 3 screenshot parity (cross-platform support)
 */

import { z } from 'zod'

/**
 * Screenshot capture mode (#164 round-2 F#31, D4).
 *
 * Split into four variants so the renderer can't pass a `windowId`-less
 * `'window'` request to the Windows desktopCapturer backend, and the
 * `SCREENSHOT_WINDOW_NOT_FOUND` runtime fallback for "missing windowId"
 * disappears as a type-system guarantee.
 *
 * - `'screen'`: capture a whole display (primary, or `displayId` when given).
 * - `'window'`: capture a specific Windows window — `windowId` is required.
 * - `'window-native'`: trigger macOS's native `screencapture -iw` picker;
 *   the OS handles selection, so no `windowId` is needed at request time.
 * - `'area'`: interactive rectangular area selection.
 */
export const ScreenshotModeSchema = z.enum(['screen', 'window', 'window-native', 'area'])
export type ScreenshotMode = z.infer<typeof ScreenshotModeSchema>

/**
 * Display bounds information
 */
export const DisplayBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})
export type DisplayBounds = z.infer<typeof DisplayBoundsSchema>

/**
 * Display information for multi-monitor support
 * @see Issue #86 enhancement - multi-monitor support
 */
export const DisplayInfoSchema = z.object({
  id: z.number(),
  label: z.string(),
  isPrimary: z.boolean(),
  bounds: DisplayBoundsSchema
})
export type DisplayInfo = z.infer<typeof DisplayInfoSchema>

/**
 * Response payload for screenshot:getDisplays IPC channel
 */
export const GetDisplaysResponseSchema = z.object({
  displays: z.array(DisplayInfoSchema)
})
export type GetDisplaysResponse = z.infer<typeof GetDisplaysResponseSchema>

/**
 * Upper bound on `thumbnailDataUrl` size (#164 round-2 F#33). 600 KB is
 * generous for a 320x180 PNG even at high colour depth but tight enough to
 * reject a malicious capturer pushing multi-MB data URLs back into the
 * renderer.
 */
export const THUMBNAIL_DATA_URL_MAX = 600_000

/**
 * Window source for window-picker mode (Windows / cross-platform desktopCapturer).
 *
 * `id` is the opaque `DesktopCapturerSource.id` returned by Electron, e.g.
 * `"window:42:0"`. The renderer passes this back unmodified in the next
 * capture request.
 *
 * `thumbnailDataUrl` is a `data:image/png;base64,...` data URL produced from
 * `source.thumbnail.toDataURL()`. When the request asks
 * `includeThumbnails: false` this is an empty string so the picker can render
 * a name-first list and lazy-load thumbnails later. Bounded to
 * {@link THUMBNAIL_DATA_URL_MAX} bytes and refined to either empty (lazy
 * mode) or a `data:image/` prefix.
 *
 * `width` / `height` are the actual pixel dimensions from
 * `source.thumbnail.getSize()`. Electron only guarantees that the thumbnail
 * is "no larger than" the requested size (it can be smaller on HiDPI when
 * the source is downscaled), so surfacing the real values lets the picker
 * size its grid cells correctly (#164 lens-review F[33]).
 */
export const WindowSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  thumbnailDataUrl: z
    .string()
    .max(THUMBNAIL_DATA_URL_MAX)
    .refine((s) => s === '' || s.startsWith('data:image/'), {
      message: 'thumbnailDataUrl must be empty or a data:image/ URL'
    }),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative()
})
export type WindowSource = z.infer<typeof WindowSourceSchema>

/**
 * Optional request parameters for `screenshot:enumerateWindows`.
 *
 * Both fields are optional so legacy callers continue to work — the IPC
 * handler treats `undefined` as "default behaviour" (thumbnails included,
 * cap at `WINDOW_PICKER.MAX_SOURCES`).
 *
 * @see Issue #164 (lens-review F[11]) - pagination + thumbnail opt-out.
 */
export const EnumerateWindowsRequestSchema = z
  .object({
    includeThumbnails: z.boolean().optional(),
    maxSources: z.number().int().positive().optional()
  })
  .strict()
export type EnumerateWindowsRequest = z.infer<typeof EnumerateWindowsRequestSchema>

/**
 * Response payload for `screenshot:enumerateWindows`.
 *
 * `availability` (#164 F[34]) tells the renderer how this platform handles
 * window selection. Branching on it is cleaner than inferring from
 * `sources.length === 0`:
 *
 * - `'enumerable'`: the desktopCapturer backend returned a usable list.
 * - `'native-picker'`: macOS — `sources` is intentionally empty because the
 *   OS native picker handles selection inside the binary call.
 * - `'unsupported'`: this platform has no capturer (Linux per D1, or any
 *   future unsupported platform).
 *
 * `truncated` is `true` when the source set exceeded `maxSources` (or
 * `WINDOW_PICKER.MAX_SOURCES` by default) and was clipped to fit.
 */
/**
 * Cross-field invariant: only `'enumerable'` may carry a populated `sources`
 * array. `'native-picker'` and `'unsupported'` are restricted to an empty
 * tuple so a future schema regression that returned `sources` for the wrong
 * availability is caught at validation (#164 round-2 F#11).
 */
export const EnumerateWindowsResponseSchema = z.discriminatedUnion('availability', [
  z.object({
    availability: z.literal('enumerable'),
    sources: z.array(WindowSourceSchema),
    truncated: z.boolean()
  }),
  z.object({
    availability: z.literal('native-picker'),
    sources: z.tuple([]),
    truncated: z.boolean()
  }),
  z.object({
    availability: z.literal('unsupported'),
    sources: z.tuple([]),
    truncated: z.boolean()
  })
])
export type EnumerateWindowsResponse = z.infer<typeof EnumerateWindowsResponseSchema>

/**
 * Maximum permitted coordinate / dimension for any area-selection rectangle,
 * in CSS pixels relative to the overlay window's viewport. Sized to cover
 * any realistic 2026 display configuration (8K = 7680x4320; Windows virtual
 * desktops add margin for negative-left monitors) with headroom, but
 * tight enough to reject pathological values from a compromised overlay
 * that would otherwise reach `nativeImage.crop` and risk a large allocation
 * in `toPNG`.
 *
 * @see Issue #164 (lens-review F[24]) - defence-in-depth on schema bounds.
 */
export const AREA_SELECTION_MAX_PX = 65535

/**
 * Area-selection rectangle posted back from the overlay renderer.
 *
 * Coordinates are CSS pixels within the overlay window's own viewport
 * (which spans exactly one Display). After Phase 1's per-display overlays
 * the coordinates are unambiguously viewport-local, so `nonnegative` for
 * the origin and `positive` for the size are correct invariants. The main
 * process converts them to physical pixels using the display's
 * `scaleFactor` before cropping.
 *
 * The upper bound `.max(AREA_SELECTION_MAX_PX)` is defence-in-depth: a
 * compromised overlay could otherwise post `MAX_SAFE_INTEGER` and reach
 * the cropping path with values that would balloon main-process memory.
 *
 * @see Issue #164 (lens-review F[24])
 */
export const AreaSelectionSchema = z.object({
  displayId: z.number(),
  x: z.number().int().nonnegative().max(AREA_SELECTION_MAX_PX),
  y: z.number().int().nonnegative().max(AREA_SELECTION_MAX_PX),
  width: z.number().int().positive().max(AREA_SELECTION_MAX_PX),
  height: z.number().int().positive().max(AREA_SELECTION_MAX_PX)
})
export type AreaSelection = z.infer<typeof AreaSelectionSchema>

/**
 * Request payload for screenshot:capture IPC channel.
 *
 * Modelled as a Zod discriminated union on `mode` (#164 lens-review F[10],
 * round-2 F#10 / F#31 / D4). The compiler now distinguishes screen /
 * window-native / window / area at the type level so a renderer can't
 * pass `displayId` to area mode or call Windows without a `windowId`. The
 * `'window'` variant carries `windowId: string` as REQUIRED (the
 * desktopCapturer backend cannot resolve a missing id at runtime) and
 * `'window-native'` carries no extra fields (macOS's native picker resolves
 * inside the binary).
 *
 * Each variant is `.strict()` so a stray extra key (e.g. a renderer that
 * accidentally smuggles `displayId` into a window-mode request) is rejected
 * at validation instead of silently stripped (#164 round-2 F#10).
 *
 * Note: terminalId is not included — it's captured client-side at click time
 * to ensure the correct terminal receives the path even if the user switches
 * terminals during interactive selection.
 */
export const ScreenshotCaptureRequestSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('screen'),
      /** Optional display id; primary display when omitted. */
      displayId: z.number().int().optional()
    })
    .strict(),
  z
    .object({
      mode: z.literal('window'),
      /** `DesktopCapturerSource.id` from the in-app picker. Required. */
      windowId: z.string().min(1)
    })
    .strict(),
  z
    .object({
      mode: z.literal('window-native')
    })
    .strict(),
  z
    .object({
      mode: z.literal('area')
    })
    .strict()
])
export type ScreenshotCaptureRequest = z.infer<typeof ScreenshotCaptureRequestSchema>

/**
 * Capabilities response describing what the running platform can do.
 *
 * Computed in main from `process.platform` so the source of truth lives
 * with the dispatcher. The renderer hook calls `getCapabilities()` on
 * mount and consumes it instead of branching on `getPlatform()`
 * (#164 lens-review F[31]).
 *
 * - `supported`: `true` if the platform has any working capturer
 *   (`darwin` or `win32`; everything else returns `false` per D1 — Erfana
 *   no longer ships on Linux).
 * - `hasNativeWindowPicker`: `true` on macOS, where the native
 *   `screencapture -iw` provides its own picker. Renderer-side picker
 *   dialog stays hidden in this case.
 * - `areaCaptureMode`: `'native'` on macOS (screencapture -is), `'overlay'`
 *   on Windows (in-app `AreaSelectOverlay`). The renderer doesn't switch
 *   on this today but it's surfaced for future telemetry / docs.
 */
export const ScreenshotCapabilitiesSchema = z.object({
  supported: z.boolean(),
  hasNativeWindowPicker: z.boolean(),
  areaCaptureMode: z.enum(['native', 'overlay', 'unsupported'])
})
export type ScreenshotCapabilities = z.infer<typeof ScreenshotCapabilitiesSchema>

/**
 * Error codes for screenshot capture failures.
 *
 * Note: CANCELLED is not a true error — it means user pressed Escape.
 * This is a normal user action, not an error condition.
 */
export const ScreenshotErrorCodeSchema = z.enum([
  'SCREENSHOT_PERMISSION_DENIED',
  'SCREENSHOT_TIMEOUT',
  'SCREENSHOT_CANCELLED',
  'SCREENSHOT_FAILED',
  'SCREENSHOT_NOT_SUPPORTED',
  'SCREENSHOT_OVERLAY_FAILED',
  'SCREENSHOT_WINDOW_NOT_FOUND',
  'SCREENSHOT_DISPLAY_NOT_FOUND'
])
export type ScreenshotErrorCode = z.infer<typeof ScreenshotErrorCodeSchema>

/**
 * Response payload from screenshot:capture IPC channel.
 *
 * Pattern deviation: This response uses success/error pattern instead of
 * throwing errors because CANCELLED is a legitimate non-error outcome
 * (user pressed Escape during selection).
 */
export const ScreenshotCaptureResponseSchema = z.object({
  success: z.boolean(),
  filePath: z.string().optional(),
  error: z.string().optional(),
  errorCode: ScreenshotErrorCodeSchema.optional()
})
export type ScreenshotCaptureResponse = z.infer<typeof ScreenshotCaptureResponseSchema>

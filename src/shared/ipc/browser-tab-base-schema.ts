// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's IPC caps, ids and bounded primitives (spec 025,
 * naming contract "IPC payload schemas"), shared by every `browser-tab-*`
 * schema module. Re-exported from `browser-tab-schema.ts`, which most
 * callers import; the primitives (`urlString`, `text`, …) are for the schema
 * modules only.
 */
import { z } from 'zod'

/** Longest address or typed input accepted, in UTF-16 code units (Chromium's display cap is 2 MB; this is the bar's). */
export const BROWSER_URL_MAX_CHARS = 8192
/** Longest find text. */
export const BROWSER_FIND_MAX_CHARS = 1000
/** Longest local file path. */
export const BROWSER_PATH_MAX_CHARS = 32_767
/** Longest page title sent to the renderer (already cleaned in main, design § 3.5). */
export const BROWSER_TITLE_MAX_CHARS = 200
/** Largest site icon sent to the renderer: a PNG of at most 32 px (design § 3.5). */
export const BROWSER_ICON_MAX_BYTES = 64 * 1024
/** Largest still image sent to the renderer (a downscaled raw bitmap, design § 6.1). */
export const BROWSER_STILL_MAX_BYTES = 64 * 1024 * 1024
/** Longest display text of a strip row, notice or label. */
export const BROWSER_TEXT_MAX_CHARS = 2000
/** Most history suggestions per answer (025-FR-063 keeps 100 addresses). */
export const BROWSER_SUGGEST_MAX_ROWS = 100
/** Largest pixel coordinate or size accepted. */
export const BROWSER_MAX_PX = 100_000

/** A tab id: `browser-tab-<counter>`, assigned by main. */
export const BrowserTabIdSchema = z.string().regex(/^browser-tab-\d{1,9}$/, 'Invalid browser tab id')
/** A capture id: 128 random bits as lower-case hex, minted by main at confirm. */
export const CaptureIdSchema = z.string().regex(/^[0-9a-f]{32}$/, 'Invalid capture id')
/** An opaque main-minted id for a strip request, a context menu or a certificate decision. */
export const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id')

/** A non-empty address, capped at {@link BROWSER_URL_MAX_CHARS}. */
export const urlString = z.string().min(1).max(BROWSER_URL_MAX_CHARS)
/** Display text, capped at {@link BROWSER_TEXT_MAX_CHARS}. */
export const text = z.string().max(BROWSER_TEXT_MAX_CHARS)
/** A pixel coordinate. */
export const px = z.number().min(-BROWSER_MAX_PX).max(BROWSER_MAX_PX)
/** A pixel size. */
export const size = z.number().min(0).max(BROWSER_MAX_PX)
/** A count. */
export const count = z.number().int().min(0).max(1_000_000)
/** Bytes, at most `max` of them. */
export const bytes = (max: number): z.ZodType<Uint8Array> =>
  z.instanceof(Uint8Array).refine(b => b.byteLength <= max, `At most ${max} bytes`)

export const BrowserRectSchema = z.object({ x: px, y: px, width: size, height: size }).strict()
export type BrowserRect = z.infer<typeof BrowserRectSchema>


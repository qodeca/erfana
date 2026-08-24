// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Wire contract for the image-export feature (issue #73).
 *
 * Two protocols live here, and the split matters:
 *
 * 1. **The renderer-facing contract** (`ImageExportRequestSchema` /
 *    `ImageExportResponseSchema`). The renderer sends a path and a target and
 *    gets back a small structured result. NO IMAGE BYTES CROSS THIS BOUNDARY
 *    in either direction: the main process reads the file fresh from disk at
 *    export time (requirement 2) and writes/copies the output itself, so a
 *    50 MB source never becomes a ~67 MB base64 IPC payload.
 * 2. **The harness protocol** (`HarnessRenderSchema` / `HarnessResultSchema`).
 *    Main ↔ the hidden rasterize window only. It is not exposed on the app
 *    renderer's bridge and its channels are frame-scoped.
 *
 * The bounds block {@link IMAGE_EXPORT} also lives here rather than in
 * `src/shared/constants.ts`: the schemas below reference it, and
 * `src/shared/constants.ts` is already 446 lines.
 *
 * @see src/shared/ipc/image-export-channels.ts for the channel names
 * @see docs/error-codes.md for the `IMAGE_EXPORT_*` codes
 */
import { z } from 'zod'
import { ErrorCode } from '../errors'
import { EXPORTABLE_IMAGE_PATH, IMAGE_MIME_VALUES } from './image-formats'

/**
 * Hard bounds for the export pipeline.
 *
 * `MAX_IMAGE_SIZE` (the 50 MB source cap) is deliberately NOT redeclared here
 * — it is imported from `src/main/services/file/imageRead.ts`, which owns it.
 */
export const IMAGE_EXPORT = {
  /** Hardest bound on output pixels; 64 MP ~ 256 MB RGBA inside the harness. */
  MAX_OUTPUT_PIXELS: 64_000_000,
  /** 14 400 pt = 200 in, the PDF page-size ceiling, expressed in CSS px. */
  MAX_PDF_PAGE_PX: 19_200,
  /**
   * MediaBox tolerance in points — exactly one CSS pixel (1 px = 0.75 pt).
   * Shared by the runtime gate and the e2e assertion.
   *
   * Not a round number picked for comfort: Chromium's `printToPDF` quantizes
   * the CSS `@page` size onto a 1/300 in grid, so for any dimension where
   * `px % 8 === 6` the produced MediaBox comes back 0.54 pt LARGER than
   * requested. A 0.5 pt tolerance is therefore tighter than Chromium's own
   * output grid can express, and refused roughly one pixel size in eight, per
   * axis, in every format (issue #73). The gate exists to catch letterboxing,
   * scaling and multi-page output — all of which are off by whole page
   * fractions, not by a sub-pixel rounding artefact — so one CSS pixel is still
   * far too tight to admit any of them.
   */
  PDF_MEDIABOX_TOLERANCE_PT: 0.75,
  /** SVG rasterization factor (requirement 4 — no size dialog is offered). */
  SVG_RASTER_SCALE: 2,
  /** CSS default replaced-element size when an SVG declares neither size nor viewBox. */
  SVG_DEFAULT_WIDTH: 300,
  SVG_DEFAULT_HEIGHT: 150,
  /** How much of an SVG is decoded and scanned for its intrinsic size. */
  SVG_HEADER_WINDOW_BYTES: 65_536,
  /** Hard iteration cap for the GIF sub-block walk. */
  MAX_GIF_BLOCKS: 100_000,
  /** Hard iteration cap for the JPEG SOF marker walk. */
  MAX_JPEG_MARKERS: 512,
  /** Budget from window creation to the harness `ready` signal. */
  WINDOW_LOAD_TIMEOUT_MS: 10_000,
  /** Budget for one rasterize round trip. */
  RENDER_TIMEOUT_MS: 30_000,
  /** Budget for `printToPDF`. */
  PDF_TIMEOUT_MS: 30_000
} as const

/** The three things the user can do with an image. */
export const IMAGE_EXPORT_TARGETS = ['png', 'pdf', 'clipboard'] as const

/** One of {@link IMAGE_EXPORT_TARGETS}. */
export type ImageExportTarget = (typeof IMAGE_EXPORT_TARGETS)[number]

/** Longest destination/source path accepted, comfortably over every OS limit. */
export const MAX_IMAGE_EXPORT_PATH_LENGTH = 4096

// ---------------------------------------------------------------------------
// Renderer → main
// ---------------------------------------------------------------------------

/**
 * Request payload for `image-export:run`.
 *
 * `.strict()` so a renderer cannot smuggle extra keys past validation. The
 * extension allow-list lives in the regex, which is why "unsupported format"
 * needs no error code of its own — it is simply an invalid request.
 */
export const ImageExportRequestSchema = z
  .object({
    /** Absolute path to the source image. Confined to the open project main-side. */
    filePath: z
      .string()
      .min(1)
      .max(MAX_IMAGE_EXPORT_PATH_LENGTH)
      .regex(EXPORTABLE_IMAGE_PATH, { message: 'Unsupported image format' }),
    /** What to do with the rasterized pixels. */
    target: z.enum(IMAGE_EXPORT_TARGETS)
  })
  .strict()

export type ImageExportRequest = z.infer<typeof ImageExportRequestSchema>

// ---------------------------------------------------------------------------
// Main → renderer
// ---------------------------------------------------------------------------

/**
 * Every error code this feature can return.
 *
 * A subset of {@link ErrorCode}, enumerated so the response schema rejects a
 * code from another domain leaking onto this channel.
 */
export const IMAGE_EXPORT_ERROR_CODES = [
  ErrorCode.IMAGE_EXPORT_CANCELLED,
  ErrorCode.IMAGE_EXPORT_INVALID_REQUEST,
  ErrorCode.IMAGE_EXPORT_BUSY,
  ErrorCode.IMAGE_EXPORT_SOURCE_UNREADABLE,
  ErrorCode.IMAGE_EXPORT_SOURCE_TOO_LARGE,
  ErrorCode.IMAGE_EXPORT_DECODE_FAILED,
  ErrorCode.IMAGE_EXPORT_OUTPUT_TOO_LARGE,
  ErrorCode.IMAGE_EXPORT_SVG_TOO_LARGE,
  ErrorCode.IMAGE_EXPORT_PDF_PAGE_TOO_LARGE,
  ErrorCode.IMAGE_EXPORT_PDF_GEOMETRY_FAILED,
  ErrorCode.IMAGE_EXPORT_ICO_SIZE_MISMATCH,
  ErrorCode.IMAGE_EXPORT_SOURCE_COLLISION,
  ErrorCode.IMAGE_EXPORT_WRITE_FAILED,
  ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED,
  ErrorCode.IMAGE_EXPORT_FAILED
] as const

export const ImageExportErrorCodeSchema = z.enum(IMAGE_EXPORT_ERROR_CODES)

/** One of {@link IMAGE_EXPORT_ERROR_CODES}. */
export type ImageExportErrorCode = (typeof IMAGE_EXPORT_ERROR_CODES)[number]

/**
 * What the export had to CHOOSE, when there really was a choice.
 *
 * Emitted only when the choice is real — a single-frame GIF and a single-size
 * ICO produce nothing, because "first frame of 1" is noise. A parser that
 * returned `null` also omits the clause rather than guessing. The renderer
 * turns this into the toast's qualifier, so a missing clause is silence and
 * never a lie.
 */
export const ImageExportSelectionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('gif-frame'),
      /** Total frames in the source; the export is always frame 0. */
      frameCount: z.number().int().min(2)
    })
    .strict(),
  z
    .object({
      kind: z.literal('ico-size'),
      /** The exported width — the HARNESS-reported size, already gated against the directory. */
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      /** How many sizes the icon file offered. */
      sizeCount: z.number().int().min(2)
    })
    .strict(),
  z
    .object({
      kind: z.literal('svg-scaled'),
      scale: z.literal(IMAGE_EXPORT.SVG_RASTER_SCALE),
      width: z.number().int().positive(),
      height: z.number().int().positive()
    })
    .strict()
])

export type ImageExportSelection = z.infer<typeof ImageExportSelectionSchema>

/**
 * Response for `image-export:run`.
 *
 * `error` is REQUIRED on the failure branch and is always
 * `ERROR_MESSAGES[errorCode]`, produced at a single mapping point inside
 * `ImageExportService`. Without that rule every toast would read
 * "Unknown error": no renderer module imports `ERROR_MESSAGES` for this, and
 * `getUserFriendlyMessage` only maps an `AppError`.
 */
export const ImageExportResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    target: z.enum(IMAGE_EXPORT_TARGETS),
    /** Absent for the clipboard target — nothing was written to disk. */
    filePath: z.string().optional(),
    /** The dimensions actually produced, as reported by the harness. */
    output: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    }),
    selection: ImageExportSelectionSchema.optional()
  }),
  z.object({
    success: z.literal(false),
    errorCode: ImageExportErrorCodeSchema,
    /** Always `ERROR_MESSAGES[errorCode]`; safe to show verbatim. */
    error: z.string().min(1)
  })
])

export type ImageExportResponse = z.infer<typeof ImageExportResponseSchema>

/**
 * The renderer-side bridge contract (`window.api.imageExport`).
 *
 * Declared here so the preload implementation and its typing cannot drift,
 * following `ClipboardBridge`.
 */
export interface ImageExportBridge {
  /** Export the image at `filePath` to `target`. Never rejects; failures are in the response. */
  run(request: ImageExportRequest): Promise<ImageExportResponse>
}

// ---------------------------------------------------------------------------
// Main ↔ hidden rasterize window (never exposed to the app renderer)
// ---------------------------------------------------------------------------

/**
 * Raw bytes on the harness wire.
 *
 * `z.custom` rather than `z.instanceof(Uint8Array)`: the latter infers
 * `Uint8Array<ArrayBuffer>`, which a Node `Buffer` (`Uint8Array<ArrayBufferLike>`)
 * does not satisfy — and a `Buffer` straight from `fs.readFile` is exactly what
 * main sends. Structured clone carries either across IPC unchanged.
 */
const BytesSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
  message: 'Expected raw bytes'
})

/**
 * One rasterize instruction.
 *
 * Every DECISION is already made by the time this is sent — which frame, what
 * size, what background, where the pixels go. The harness is a dumb pixel
 * pump, which is what makes the rest of this feature unit-testable.
 */
export const HarnessRenderSchema = z.object({
  /** Per-export nonce; echoed on the result and matched main-side. */
  token: z.string().uuid(),
  /** MIME type for the `Blob` wrapper; drawn from the shared format map. */
  mimeType: z.enum(IMAGE_MIME_VALUES),
  /** The authoritative bytes, read fresh from disk in main. */
  bytes: BytesSchema,
  /** `'svg'` loads via `<img>` only; `'bitmap'` prefers `createImageBitmap`. */
  mode: z.enum(['bitmap', 'svg']),
  /** Explicit canvas size (SVG only). `null` means "use the decoded intrinsic size". */
  targetSize: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    })
    .nullable(),
  /** `'white'` flattens alpha before delivery — required for PDF and the clipboard. */
  background: z.enum(['transparent', 'white']),
  /** `'bytes'` posts a PNG back; `'page'` leaves the canvas result in the DOM for printToPDF. */
  deliver: z.enum(['bytes', 'page']),
  /** Defence-in-depth bound; main has already checked the declared dimensions. */
  maxPixels: z.number().int().positive()
})

export type HarnessRender = z.infer<typeof HarnessRenderSchema>

/** Why the harness could not produce pixels. */
export const HARNESS_FAILURE_REASONS = ['decode', 'too-large', 'encode'] as const

export type HarnessFailureReason = (typeof HARNESS_FAILURE_REASONS)[number]

/** One rasterize result. `pngBytes` is absent when `deliver` was `'page'`. */
export const HarnessResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    token: z.string().uuid(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    pngBytes: BytesSchema.optional()
  }),
  z.object({
    ok: z.literal(false),
    token: z.string().uuid(),
    reason: z.enum(HARNESS_FAILURE_REASONS)
  })
])

export type HarnessResult = z.infer<typeof HarnessResultSchema>

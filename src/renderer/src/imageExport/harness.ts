// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The rasterize harness: a dumb pixel pump inside a hidden Chromium page.
 *
 * This is the ONLY part of the image-export feature that cannot be unit
 * tested. It needs `createImageBitmap`, `OffscreenCanvas` and a real image
 * decoder, none of which jsdom has, so it is covered by the e2e suite and the
 * manual checklist instead and is excluded from the coverage target on that
 * basis. That is also why it is kept deliberately stupid: every DECISION —
 * which frame, which size, what background, where the pixels go — is made by a
 * pure function in the main process and arrives here as an explicit
 * instruction. This file only carries them out.
 *
 * ## Why an untrusted SVG is safe here
 *
 * An SVG is loaded ONLY as `<img src=blob:...>`, which is Chromium's secure
 * static mode: no script execution, no external resource loading. SVG text
 * never enters the DOM, never reaches a parser, and never becomes an
 * `<object>` or `<embed>` (which WOULD execute script). That rule is enforced
 * by three things, none of which is a comment: the page's CSP
 * (`default-src 'none'`, `object-src 'none'`, `img-src blob:`), the session's
 * deny-all request filter installed before this page's first byte, and an
 * ESLint boundary over this folder that bans `innerHTML`, `DOMParser`,
 * `document.write` and the creation of `object` / `embed` / `iframe` elements.
 *
 * @see src/main/services/imageExport/ImageRasterizeWindow.ts for the other end
 * @see src/shared/ipc/image-export-schema.ts for the instruction shape
 */
import type { HarnessFailureReason, HarnessRender } from '../../../shared/ipc/image-export-schema'

/** The three verbs `src/preload/imageExport.ts` exposes. */
interface HarnessApi {
  ready(): void
  onRender(callback: (instruction: unknown) => void): void
  postResult(result: HarnessOutcome): void
}

/** What this page posts back. `pngBytes` is omitted for `deliver: 'page'`. */
type HarnessOutcome =
  | { ok: true; width: number; height: number; pngBytes?: Uint8Array }
  | { ok: false; reason: HarnessFailureReason }

/** A decoded image plus the size it decoded to, and how to let it go. */
interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

/** Thrown internally so one `catch` can map every failure to a reason. */
class HarnessFailure extends Error {
  constructor(readonly reason: HarnessFailureReason) {
    super(reason)
  }
}

const api = (window as unknown as { imageExportApi: HarnessApi }).imageExportApi

/**
 * Decode via `<img>` + an object URL.
 *
 * The only path an SVG ever takes, and the fallback when `createImageBitmap`
 * refuses a format (ICO and BMP are the likely candidates). `targetSize` is
 * applied as concrete attributes first, because an SVG that declares no
 * intrinsic size has nothing else to rasterize against.
 */
async function decodeViaImgElement(
  blob: Blob,
  targetSize: HarnessRender['targetSize']
): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob)
  const image = new Image()
  if (targetSize) {
    image.width = targetSize.width
    image.height = targetSize.height
  }
  image.src = url

  try {
    await image.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new HarnessFailure('decode')
  }

  return {
    source: image,
    width: targetSize?.width ?? image.naturalWidth,
    height: targetSize?.height ?? image.naturalHeight,
    release: () => URL.revokeObjectURL(url)
  }
}

/**
 * Decode a raster image.
 *
 * `createImageBitmap` is primary because the HTML spec pins it to the default
 * image — the FIRST frame of an animated GIF or WebP — which is exactly what
 * requirement 5 promises, deterministically rather than by luck.
 * `imageOrientation: 'from-image'` is passed explicitly so an EXIF-rotated
 * JPEG comes out the way the panel displays it, and so this path and the
 * `<img>` fallback cannot disagree about rotation.
 */
async function decodeBitmap(
  blob: Blob,
  targetSize: HarnessRender['targetSize']
): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close()
    }
  } catch {
    return decodeViaImgElement(blob, targetSize)
  }
}

/** Draw the decoded image onto a fresh canvas at exactly `width` x `height`. */
function paint(
  decoded: DecodedImage,
  width: number,
  height: number,
  background: HarnessRender['background']
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new HarnessFailure('encode')

  context.imageSmoothingEnabled = false
  if (background === 'white') {
    // printBackground does NOT flatten an image's own alpha, so the white has
    // to go under the pixels here or a transparent PNG prints as black on the
    // Windows clipboard and as a dark fringe in the PDF.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  context.drawImage(decoded.source, 0, 0, width, height)
  return canvas
}

/**
 * Replace the document with the flattened canvas result at exactly its own
 * size, and pin the page geometry to match.
 *
 * The page always embeds the CANVAS output, never the original blob — that is
 * what makes PDF and clipboard share one flattened pixel source, and it is the
 * only thing that flattens an alpha SVG, which otherwise never touches a
 * canvas on the way to a PDF.
 */
async function showAsPage(canvas: OffscreenCanvas, width: number, height: number): Promise<void> {
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  // Deliberately NOT revoked: printToPDF runs after this resolves, and the
  // window is destroyed immediately afterwards, which releases it.
  const url = URL.createObjectURL(blob)

  const style = document.createElement('style')
  style.textContent = `@page { size: ${width}px ${height}px; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff }
img { display: block; position: absolute; top: 0; left: 0 }`

  const image = new Image(width, height)
  image.src = url
  await image.decode()

  // APPEND, never replace: the head carries this page's CSP `<meta>`, and
  // wiping it reads to anyone auditing the page as the harness disarming its
  // own policy mid-export. (It would not: a policy joins the document's policy
  // list when the meta is parsed and removing the element does not retract it.
  // The point is that the element stays visible.) An ICO retry renders twice
  // into the same window and appends a second `@page` rule; equal specificity,
  // so the later one - the retry's - wins, which is the size that must apply.
  document.head.append(style)
  document.body.replaceChildren(image)
}

/** Carry out one instruction. */
async function rasterize(instruction: HarnessRender): Promise<HarnessOutcome> {
  // The cast is the DOM lib's generic-typed-array narrowing, not a shortcut:
  // `BlobPart` requires `ArrayBufferView<ArrayBuffer>`, while a structured-cloned
  // `Uint8Array` types as `Uint8Array<ArrayBufferLike>`. Same bytes either way.
  const blob = new Blob([instruction.bytes as BlobPart], { type: instruction.mimeType })
  const decoded =
    instruction.mode === 'svg'
      ? await decodeViaImgElement(blob, instruction.targetSize)
      : await decodeBitmap(blob, instruction.targetSize)

  let canvas: OffscreenCanvas | null = null
  try {
    const width = instruction.targetSize?.width ?? decoded.width
    const height = instruction.targetSize?.height ?? decoded.height
    if (!width || !height) throw new HarnessFailure('decode')
    // Checked BEFORE allocating: main has already vetted the declared
    // dimensions, so this is defence in depth against a header that lied.
    if (width * height > instruction.maxPixels) throw new HarnessFailure('too-large')

    canvas = paint(decoded, width, height, instruction.background)

    if (instruction.deliver === 'page') {
      await showAsPage(canvas, width, height)
      return { ok: true, width, height }
    }

    const out = await canvas.convertToBlob({ type: 'image/png' })
    return { ok: true, width, height, pngBytes: new Uint8Array(await out.arrayBuffer()) }
  } finally {
    decoded.release()
    if (canvas) {
      // Dropping the dimensions frees the backing store immediately rather
      // than at the next GC, which matters at 64 megapixels.
      canvas.width = 0
      canvas.height = 0
    }
  }
}

api.onRender((raw) => {
  const instruction = raw as HarnessRender
  rasterize(instruction)
    .then((outcome) => api.postResult(outcome))
    .catch((error) => {
      api.postResult({
        ok: false,
        reason: error instanceof HarnessFailure ? error.reason : 'decode'
      })
    })
})

api.ready()

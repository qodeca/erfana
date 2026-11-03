// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A held capture made into its three files (spec 025, 025-FR-033 to
 * 025-FR-038, 025-FR-053; solution design § 6.2). Pure: the encoder, the
 * names and the fence token come from the caller.
 *
 * - The context file: capture facts from numbers, fixed notes and Erfana's
 *   own paths; every page string in the untrusted block (`contextFile.ts`).
 * - The screenshot: the image taken at the pick, with the outline drawn on a
 *   copy around the picked element's box as it was at the pick (a refined
 *   element's snapshot box), so the image always shows the page as picked;
 *   no outline for an element off-screen or of zero size (025-FR-035); a
 *   crosshair at the pick point for a `<canvas>` or a closed shadow root.
 * - The element crop: the box plus 24 CSS px a side, clipped to the
 *   viewport, without the outline (025-FR-034).
 */
import { captureFileNames } from '../../../../shared/browser/captureFiles'
import {
  renderContextFile,
  type CaptureNote,
  type ConsoleEntry,
  type FailedRequest,
  type UntrustedContent
} from '../../../../shared/browser/contextFile'
import type { WidthPresetRecord } from '../../../../shared/browser/widthPresets'
import type { LogSnapshot } from '../cdp/browserLogBuffer'
import { boxChanged, cropBox, scaleBox, visibilityNote, type Box, type Point } from '../pick/pickGeometry'
import { copyBitmap, cropBitmap, drawCrosshair, drawOutline, type Bitmap, type Rgb } from './captureImage'
import type { ElementFacts } from './captureFacts'
import { CAPTURES_REL } from './CaptureStore'
import type { SourceHints } from './sourceHints'

/** The crop's margin around the element, in CSS px (025-FR-034). */
export const CROP_MARGIN_CSS_PX = 24

/** What was taken at the pick and never changes afterwards (025-FR-053). */
export interface CaptureMoment {
  readonly time: Date
  readonly utcOffsetMinutes: number
  /** The viewport image at the device pixel ratio, without the engine highlight. */
  readonly image: Bitmap
  /** The top-level viewport in CSS px. */
  readonly viewport: { readonly width: number; readonly height: number }
  readonly widthPreset: WidthPresetRecord
  /** Click position, or the last mouse position, or the element's centre (CSS px, top-level viewport). */
  readonly pickPoint: Point
  readonly url: string
  readonly title: string
  readonly logs: LogSnapshot
}

/** The element being sent: its facts, its hints, and its box at the pick. */
export interface CaptureElement {
  readonly tag: string
  readonly facts: ElementFacts
  readonly hints: SourceHints
  /** The box at the pick (the snapshot), drawn on the stored image. */
  readonly snapshotBox: Box | null
}

export interface RenderedCapture {
  readonly context: { readonly name: string; readonly text: string }
  readonly screenshot: { readonly name: string; readonly png: Uint8Array }
  readonly crop: { readonly name: string; readonly png: Uint8Array }
}

export interface RenderOptions {
  readonly randomId: string
  readonly token: string
  readonly outline: Rgb
  readonly encodePng: (bitmap: Bitmap) => Uint8Array
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** A log time as the context file writes it: `HH:MM:SS.mmm` UTC, as the golden file does. */
export function logTime(timeMs: number): string {
  const d = new Date(timeMs)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
}

function consoleEntries(logs: LogSnapshot): ConsoleEntry[] {
  return logs.console.map((c) => ({ time: logTime(c.timeMs), frameOrigin: c.frameOrigin, level: c.level, message: c.message }))
}

function failedRequests(logs: LogSnapshot): FailedRequest[] {
  return logs.failedRequests.map((r) => ({ time: logTime(r.timeMs), frameOrigin: r.frameOrigin, status: r.status, url: r.url }))
}

const ZERO_BOX: Box = { x: 0, y: 0, width: 0, height: 0 }

/** The notes of the capture facts besides the ones `contextFile.ts` derives. */
export function captureNotes(moment: CaptureMoment, element: CaptureElement, box: Box): CaptureNote[] {
  const notes: CaptureNote[] = []
  const visibility = visibilityNote(box, { x: 0, y: 0, ...moment.viewport })
  if (visibility !== null) notes.push(visibility)
  if (element.facts.closedShadow) notes.push('insideClosedShadowRoot')
  if (element.hints.sourceNotFound) notes.push('sourceNotFound')
  if (moment.logs.truncated) notes.push('logsTruncated')
  if (element.snapshotBox !== null && element.facts.boxInView !== null && boxChanged(element.snapshotBox, element.facts.boxInView)) {
    notes.push('pageChangedAfterPick')
  }
  return notes
}

function untrusted(moment: CaptureMoment, element: CaptureElement): UntrustedContent {
  const { facts, hints } = element
  return {
    url: moment.url,
    title: moment.title,
    selectorChain: facts.selectors,
    frameChain: facts.frameOrigins,
    outerHtml: facts.outerHtml,
    computedStyles: facts.styles,
    layoutChain: facts.layout,
    matchedRules: facts.matchedRules,
    sourceAttributes: hints.sourceAttributes,
    react: hints.react,
    coveredBy: facts.coveredBy,
    console: consoleEntries(moment.logs),
    failedRequests: failedRequests(moment.logs)
  }
}

/** The device pixel ratio of the stored image. */
export function devicePixelRatio(moment: CaptureMoment): number {
  return moment.viewport.width > 0 ? moment.image.width / moment.viewport.width : 1
}

/** The screenshot: the stored image with the outline (and crosshair) drawn on a copy. */
export function screenshotBitmap(moment: CaptureMoment, element: CaptureElement, outline: Rgb): Bitmap {
  const dpr = devicePixelRatio(moment)
  const shot = copyBitmap(moment.image)
  const box = element.snapshotBox ?? element.facts.boxInView
  if (box !== null) {
    const note = visibilityNote(box, { x: 0, y: 0, ...moment.viewport })
    if (note !== 'offScreen' && note !== 'zeroSize') drawOutline(shot, scaleBox(box, dpr), outline)
  }
  if (element.tag.toLowerCase() === 'canvas' || element.facts.closedShadow) {
    drawCrosshair(shot, { x: moment.pickPoint.x * dpr, y: moment.pickPoint.y * dpr }, outline)
  }
  return shot
}

/** The element crop; around the pick point when the element shows nowhere. */
export function cropOf(moment: CaptureMoment, box: Box | null): Bitmap {
  const dpr = devicePixelRatio(moment)
  const around = box !== null && box.width > 0 && box.height > 0 ? box : { ...moment.pickPoint, width: 0, height: 0 }
  const css = cropBox(around, CROP_MARGIN_CSS_PX, moment.viewport) ?? { x: 0, y: 0, width: 1, height: 1 }
  return cropBitmap(moment.image, scaleBox(css, dpr)) ?? { data: new Uint8Array(4), width: 1, height: 1 }
}

/** Render the three files of one send. Throws on a malformed id, token or path. */
export function renderCapture(moment: CaptureMoment, element: CaptureElement, options: RenderOptions): RenderedCapture {
  const names = captureFileNames(moment.time, options.randomId)
  const box = element.facts.boxInView ?? element.snapshotBox ?? ZERO_BOX
  const text = renderContextFile({
    token: options.token,
    facts: {
      captureTime: moment.time,
      utcOffsetMinutes: moment.utcOffsetMinutes,
      viewport: moment.viewport,
      widthPreset: moment.widthPreset,
      devicePixelRatio: devicePixelRatio(moment),
      elementBox: box,
      elementBoxInFrame: element.facts.boxInFrame,
      pickPoint: moment.pickPoint,
      notes: captureNotes(moment, element, box),
      ...(element.hints.resolvedSource === undefined ? {} : { resolvedSource: element.hints.resolvedSource }),
      screenshotPath: `${CAPTURES_REL}/${names.screenshot}`,
      cropPath: `${CAPTURES_REL}/${names.crop}`
    },
    page: untrusted(moment, element)
  })
  return {
    context: { name: names.context, text },
    screenshot: { name: names.screenshot, png: options.encodePng(screenshotBitmap(moment, element, options.outline)) },
    crop: { name: names.crop, png: options.encodePng(cropOf(moment, element.snapshotBox ?? element.facts.boxInView)) }
  }
}

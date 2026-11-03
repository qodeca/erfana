// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Fixtures for the capture unit tests: a capture moment, an element chain,
 * facts and hints, each overridable.
 */
import type { ChainEntry, ElementChain } from '../../pick/pickElement'
import type { Bitmap } from '../captureImage'
import type { ElementFacts } from '../captureFacts'
import type { CaptureElement, CaptureMoment } from '../captureRender'
import type { SourceHints } from '../sourceHints'

/** An opaque white BGRA image. */
export function whiteImage(width: number, height: number): Bitmap {
  return { data: new Uint8Array(width * height * 4).fill(255), width, height }
}

export function moment(over: Partial<CaptureMoment> = {}): CaptureMoment {
  return {
    time: new Date(Date.UTC(2026, 10, 2, 21, 5, 9)),
    utcOffsetMinutes: 60,
    image: whiteImage(200, 100),
    viewport: { width: 100, height: 50 },
    widthPreset: { kind: 'preset', name: 'Full width' },
    pickPoint: { x: 30, y: 20 },
    url: 'https://app.test/page',
    title: 'Page',
    logs: { console: [], failedRequests: [], truncated: false },
    ...over
  } as CaptureMoment
}

export function entry(tagName: string, over: Partial<ChainEntry> = {}): ChainEntry {
  return {
    name: { tagName, id: null, classAttr: null },
    attrs: [],
    shadow: null,
    boxInFrame: { x: 10, y: 10, width: 20, height: 10 },
    boxInView: { x: 10, y: 10, width: 20, height: 10 },
    node: { sessionKey: '', backendNodeId: 1, frameId: 'top' },
    ...over
  }
}

export function chain(entries: ChainEntry[], over: Partial<ElementChain> = {}): ElementChain {
  return { entries, selectors: ['main > button'], closedShadow: false, frameOrigins: ['https://app.test'], connected: true, ...over }
}

export function facts(over: Partial<ElementFacts> = {}): ElementFacts {
  return {
    selectors: ['main > button'],
    closedShadow: false,
    frameOrigins: ['https://app.test'],
    outerHtml: '<button>Save</button>',
    styles: [['display', 'inline-block']],
    layout: [],
    matchedRules: [],
    coveredBy: null,
    boxInView: { x: 10, y: 10, width: 20, height: 10 },
    boxInFrame: { x: 10, y: 10, width: 20, height: 10 },
    connected: true,
    ...over
  }
}

export function hints(over: Partial<SourceHints> = {}): SourceHints {
  return { sourceAttributes: [], react: null, sourceNotFound: false, ...over }
}

export function element(over: Partial<CaptureElement> = {}): CaptureElement {
  return { tag: 'button', facts: facts(), hints: hints(), snapshotBox: { x: 10, y: 10, width: 20, height: 10 }, ...over }
}

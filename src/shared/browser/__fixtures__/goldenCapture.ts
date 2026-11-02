// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The fixed capture behind the golden context file
 * (`e2e/fixtures/browser/context-file.golden.md`, 025-FR-033). Test-only:
 * imported by `../contextFile.test.ts`, and by the e2e parser test when it lands.
 */
import type { ContextFileInput } from '../contextFile'

export const GOLDEN_TOKEN = '0123456789abcdef0123456789abcdef'

export const GOLDEN_CAPTURE: ContextFileInput = {
  token: GOLDEN_TOKEN,
  facts: {
    captureTime: new Date(Date.UTC(2026, 10, 2, 21, 5, 9)),
    utcOffsetMinutes: 60,
    viewport: { width: 1280, height: 800 },
    widthPreset: { kind: 'preset', name: 'Full width' },
    devicePixelRatio: 2,
    elementBox: { x: 100, y: 200.5, width: 176, height: 32 },
    elementBoxInFrame: { x: 20, y: 40.5, width: 176, height: 32 },
    pickPoint: { x: 188, y: 216 },
    notes: ['partlyOffScreen'],
    resolvedSource: { path: 'src/components/Hero.tsx', line: 42 },
    screenshotPath: '.erfana/browser/captures/20261102-210509Z-a1b2c3d4.png',
    cropPath: '.erfana/browser/captures/20261102-210509Z-a1b2c3d4-crop.png'
  },
  page: {
    url: 'http://localhost:5173/pricing?plan=pro',
    title: 'Pricing – Acme',
    selectorChain: ['main > section.hero > button.cta'],
    frameChain: ['http://localhost:5173'],
    outerHtml: '<button class="cta" data-source="src/components/Hero.tsx:42">Start ``free`` trial</button>',
    computedStyles: [
      ['display', 'inline-flex'],
      ['padding', '8px 16px'],
      ['color', 'rgb(255, 255, 255)']
    ],
    layoutChain: [
      { tag: 'section', display: 'flex', position: 'relative', overflow: 'hidden', width: '1280px', height: '480px' }
    ],
    matchedRules: [{ stylesheetUrl: 'http://localhost:5173/assets/index.css', line: 12, text: '.cta { padding: 8px 16px; }' }],
    sourceAttributes: [['data-source', 'src/components/Hero.tsx:42']],
    react: { component: 'Hero', ownerChain: ['App', 'PricingPage'], source: 'src/components/Hero.tsx:42' },
    coveredBy: null,
    console: [{ time: '21:05:01.120', frameOrigin: 'http://localhost:5173', level: 'warning', message: 'Deprecated prop' }],
    failedRequests: [{ time: '21:05:02.004', frameOrigin: 'http://localhost:5173', status: '404', url: 'http://localhost:5173/api/plan' }]
  }
}

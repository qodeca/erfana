// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renders the README banner and the social preview from their design card
 * (design/product/github-presentation/index.html; #139 design, step 3).
 *
 * The card is the source of truth: it is built only from design/tokens.css
 * and the bundled Cascadia Mono, so these PNGs are the shipping tokens, and a
 * token change is one `npm run docs:brand` away from new artwork.
 *
 * Each artwork element is screenshotted at deviceScaleFactor 2, so an
 * 800×200 layout becomes a 1600×400 PNG and the 640×320 social card becomes
 * GitHub's recommended 1280×640. Paths are fixed; the script takes no input.
 */

import { mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CARD = path.join(ROOT, 'design/product/github-presentation/index.html')
const OUT_DIR = path.join(ROOT, 'docs/assets/readme')

/** Element id in the card → output file, expected pixel size and byte budget. */
export const ARTWORK = [
  { id: 'gp-banner-dark', file: 'banner-dark.png', width: 1600, height: 400, maxKB: 150 },
  { id: 'gp-banner-light', file: 'banner-light.png', width: 1600, height: 400, maxKB: 150 },
  { id: 'gp-social', file: 'social-preview.png', width: 1280, height: 640, maxKB: 300 }
]

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  let failed = false
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1000, height: 800 } })
    await page.goto(pathToFileURL(CARD).href, { waitUntil: 'load' })
    // The wordmark must be drawn in the bundled face, never a fallback.
    await page.evaluate(() => document.fonts.ready)
    const bundled = await page.evaluate(() => document.fonts.check("700 60px 'Cascadia Mono'"))
    if (!bundled) throw new Error('Cascadia Mono Bold did not load; refusing to render with a fallback face')

    for (const art of ARTWORK) {
      const el = page.locator(`#${art.id}`)
      const icon = el.locator('img')
      await icon.evaluate(img => img.complete && img.naturalWidth > 0 ? null : new Promise((resolve, reject) => {
        img.addEventListener('load', resolve, { once: true })
        img.addEventListener('error', () => reject(new Error('icon failed to load')), { once: true })
      }))
      const target = path.join(OUT_DIR, art.file)
      // Clip to the layout box on whole CSS pixels: an element screenshot at a
      // fractional page offset comes out one device row taller.
      const box = await el.evaluate(node => {
        const r = node.getBoundingClientRect()
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: node.offsetWidth, height: node.offsetHeight }
      })
      const clip = { x: Math.round(box.x), y: Math.round(box.y), width: box.width, height: box.height }
      const buf = await page.screenshot({ path: target, clip, fullPage: true, animations: 'disabled' })
      const width = buf.readUInt32BE(16)
      const height = buf.readUInt32BE(20)
      const kb = Math.round(statSync(target).size / 1024)
      const ok = width === art.width && height === art.height && kb <= art.maxKB
      if (!ok) failed = true
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${path.relative(ROOT, target)} ${width}x${height} ${kb} KB (budget ${art.maxKB} KB)`)
    }
  } finally {
    await browser.close()
  }
  if (failed) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err.message)
    process.exit(1)
  })
}

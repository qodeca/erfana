// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Source-level contract for the preview-page preload (sd-074b §5.1).
 *
 * This preload runs inside the sealed page's process, so what it does NOT do is
 * the security property worth pinning. Asserted against the source rather than
 * the bundle so it fails in unit tests, before a build.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PREVIEW_PAGE_LINK_CHANNEL } from '../main/services/preview/previewLinkBridge'

const RAW = readFileSync(join(__dirname, 'previewPage.ts'), 'utf8')

/**
 * The source with comments removed.
 *
 * The contract is about what the CODE does; the file's own documentation
 * explains why it avoids `contextBridge` and `preventDefault`, and matching
 * those words in prose would fail the very test that documents them.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('previewPage preload contract', () => {
  /**
   * The channel name exists TWICE on purpose: the preload must stay
   * self-contained, because `electron.vite.config.ts` fails the build if two
   * preload entries share a module by value (#73). Nothing else pins the two
   * copies together, and a drift between them makes every preview link go inert
   * with no error anywhere — silence being the exact failure this feature was
   * built to remove (lens review F31).
   *
   * A value import is fine HERE: the build constraint applies to the preload
   * bundle, not to its test.
   */
  it('inlines the same channel name the main process listens on', () => {
    expect(SOURCE).toContain(`'${PREVIEW_PAGE_LINK_CHANNEL}'`)
  })

  it('exposes nothing to the page — no contextBridge', () => {
    expect(SOURCE).not.toContain('contextBridge')
  })

  it('does not reach into the frame API', () => {
    expect(SOURCE).not.toContain('webFrame')
  })

  it('is send-only: it never invokes main and never listens to it', () => {
    // An `invoke` or an `on` would turn a one-way reporter into a two-way
    // bridge, which is the thing the sealed box does not have.
    expect(SOURCE).not.toContain('ipcRenderer.invoke')
    expect(SOURCE).not.toContain('ipcRenderer.on')
    expect(SOURCE).toContain('ipcRenderer.send')
  })

  it('requires a genuine user gesture', () => {
    expect(SOURCE).toContain('event.isTrusted')
  })

  it('never cancels the page’s own click handling', () => {
    // The page must keep winning; the browser navigation is already refused.
    expect(SOURCE).not.toContain('preventDefault')
  })

  it('inlines its channel name rather than importing shared code', () => {
    // A value import from a shared module makes Rollup hoist a chunk a
    // sandboxed preload cannot require (#73 build guard).
    const imports = SOURCE.match(/^import .*/gm) ?? []
    expect(imports).toEqual(["import { ipcRenderer } from 'electron'"])
  })
})

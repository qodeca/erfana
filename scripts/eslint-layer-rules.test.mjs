// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The layer-import rules in eslint.config.mjs, proven to fire.
 *
 * shared imports nothing from main, renderer, preload or electron; renderer
 * imports nothing from main and only types from preload; main imports nothing
 * from renderer or preload. Each case lints a one-line source as if it lived at
 * a real path, so a config edit that drops a rule (flat config replaces a rule
 * wholesale, so this is easy to do by accident) turns this red.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })

const LAYER = /Layer rule/

/** Lint messages for `code` linted as if it were the file at `rel` */
async function lint(rel, code) {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, rel) })
  return result.messages
}

/** Only the layer-rule messages */
async function layerMessages(rel, code) {
  return (await lint(rel, code)).filter((m) => LAYER.test(m.message))
}

const SHARED = 'src/shared/ipc/probe.ts'
const MAIN = 'src/main/services/probe.ts'
const RENDERER = 'src/renderer/src/utils/probe.ts'
const HARNESS = 'src/renderer/src/imageExport/probe.ts'

describe('layer import rules', () => {
  it.each([
    ['main', "import { a } from '../../main/a'\nexport { a }"],
    ['renderer', "import type { a } from '../../renderer/src/a'\nexport type { a }"],
    ['preload', "import type { a } from '../../preload/index'\nexport type { a }"],
    ['electron', "import { app } from 'electron'\nexport { app }"]
  ])('src/shared may not import %s', async (_layer, code) => {
    expect(await layerMessages(SHARED, code)).toHaveLength(1)
  })

  it('src/shared may import its own siblings', async () => {
    expect(await layerMessages(SHARED, "import { a } from './a'\nexport { a }")).toHaveLength(0)
  })

  it.each([
    ['renderer', "import { a } from '../../renderer/src/a'\nexport { a }"],
    ['preload', "import type { a } from '../../preload/index'\nexport type { a }"]
  ])('src/main may not import %s', async (_layer, code) => {
    expect(await layerMessages(MAIN, code)).toHaveLength(1)
  })

  it('src/main may import shared, and still may not take ipcMain', async () => {
    expect(await layerMessages(MAIN, "import { a } from '../../shared/a'\nexport { a }")).toHaveLength(0)
    const messages = await lint(MAIN, "import { ipcMain } from 'electron'\nexport { ipcMain }")
    expect(messages.some((m) => /ipcMain/.test(m.message))).toBe(true)
  })

  it.each([RENDERER, HARNESS])('%s may not import main', async (file) => {
    expect(await layerMessages(file, "import { a } from '../../../../main/a'\nexport { a }")).toHaveLength(1)
  })

  it.each([RENDERER, HARNESS])('%s may import preload as a type only', async (file) => {
    const value = "import { a } from '../../../../preload/index'\nexport { a }"
    const type = "import type { a } from '../../../../preload/index'\nexport type { a }"
    expect(await layerMessages(file, value)).toHaveLength(1)
    expect(await layerMessages(file, type)).toHaveLength(0)
  })
})

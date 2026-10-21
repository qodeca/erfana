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
const MAIN_TEST = 'src/main/services/probe.test.ts'
const MAIN_REGISTRY = 'src/main/ipc/registry.ts'
const PRELOAD = 'src/preload/probe.ts'
const RENDERER = 'src/renderer/src/utils/probe.ts'
const HARNESS = 'src/renderer/src/imageExport/probe.ts'

const val = (spec) => `import { a } from '${spec}'\nexport { a }`
const typ = (spec) => `import type { a } from '${spec}'\nexport type { a }`

describe('layer import rules', () => {
  it.each([
    ['main', val('../../main/a')],
    ['main alias', val('@main/a')],
    ['renderer', typ('../../renderer/src/a')],
    ['renderer alias', typ('@renderer/a')],
    ['preload', typ('../../preload/index')],
    ['preload alias', typ('@preload/index')],
    ['electron', val('electron')],
    ['electron/main', val('electron/main')]
  ])('src/shared may not import %s', async (_layer, code) => {
    expect(await layerMessages(SHARED, code)).toHaveLength(1)
  })

  it('src/shared may import its own siblings and look-alike names', async () => {
    for (const spec of ['./a', './main', './preload', '@electron-toolkit/preload']) {
      expect(await layerMessages(SHARED, val(spec))).toHaveLength(0)
    }
  })

  it.each([MAIN, MAIN_TEST, MAIN_REGISTRY])('%s may not import renderer or preload', async (file) => {
    for (const code of [
      val('../../renderer/src/a'),
      val('@renderer/a'),
      typ('../../preload/index'),
      typ('@preload/index')
    ]) {
      expect(await layerMessages(file, code)).toHaveLength(1)
    }
  })

  it('src/main may import shared and look-alike names', async () => {
    for (const spec of ['../../shared/a', './preload', './renderer', '@electron-toolkit/preload']) {
      expect(await layerMessages(MAIN, val(spec))).toHaveLength(0)
    }
  })

  it('src/main still may not take ipcMain, from electron or electron/main', async () => {
    for (const spec of ['electron', 'electron/main']) {
      const messages = await lint(MAIN, `import { ipcMain } from '${spec}'\nexport { ipcMain }`)
      expect(messages.some((m) => /ipcMain/.test(m.message))).toBe(true)
    }
  })

  it('src/preload may not import the renderer, but may import main', async () => {
    expect(await layerMessages(PRELOAD, val('../renderer/src/a'))).toHaveLength(1)
    expect(await layerMessages(PRELOAD, val('@renderer/a'))).toHaveLength(1)
    expect(await layerMessages(PRELOAD, val('../main/a'))).toHaveLength(0)
  })

  it.each([RENDERER, HARNESS])('%s may not import main', async (file) => {
    expect(await layerMessages(file, val('../../../main/a'))).toHaveLength(1)
    expect(await layerMessages(file, val('@main/a'))).toHaveLength(1)
  })

  it.each([RENDERER, HARNESS])('%s may import preload/index as a type only', async (file) => {
    for (const spec of ['../../../preload/index', '../../../preload', '@preload/index']) {
      expect(await layerMessages(file, val(spec))).toHaveLength(1)
      expect(await layerMessages(file, typ(spec))).toHaveLength(0)
    }
  })

  it('the renderer may not import any other preload file, even as a type', async () => {
    // (Not asserted for the harness: its `../*` group exempts every type import.)
    expect(await layerMessages(RENDERER, typ('../../../preload/x'))).toHaveLength(1)
    expect(await layerMessages(RENDERER, typ('@preload/x'))).toHaveLength(1)
  })

  it('the renderer layer rule does not hit look-alike names', async () => {
    for (const spec of ['./main', './preload', '@electron-toolkit/preload']) {
      expect(await layerMessages(RENDERER, val(spec))).toHaveLength(0)
    }
  })

  it('the image-export harness keeps its own "no app code" message (block order)', async () => {
    const messages = await lint(HARNESS, "import { log } from '../utils/logger'\nexport { log }")
    expect(messages.some((m) => /must not import app code/.test(m.message))).toBe(true)
  })
})

describe('renderer gateway rule', () => {
  const GATEWAY = /services\/fileGateway and services\/terminalGateway/
  const gatewayMessages = async (rel, code) =>
    (await lint(rel, code)).filter((m) => GATEWAY.test(m.message))

  const READ_FILE = 'export const f = () => window.api.file.readFile("a")'
  const READ_TERMINAL = 'export const t = () => window.api.terminal.kill("a")'
  const READ_OTHER = 'export const g = () => window.api.git.status("a")'

  it('flags a renderer read of window.api.file and window.api.terminal', async () => {
    expect(await gatewayMessages(RENDERER, READ_FILE)).toHaveLength(1)
    expect(await gatewayMessages(RENDERER, READ_TERMINAL)).toHaveLength(1)
    expect(await gatewayMessages(RENDERER, 'export const f = () => window.api?.file?.exists("a")')).toHaveLength(1)
  })

  it.each([
    ['destructuring', 'const { file } = window.api\nexport { file }'],
    ['aliasing', 'const a = window.api\nexport { a }'],
    ['assignment aliasing', 'let a\na = window.api\nexport { a }'],
    ['computed on window.api', 'export const f = (k) => window.api[k]'],
    ['computed literal on window.api', "export const f = () => window.api['file']"],
    ['computed on window', "export const f = () => window['api']"],
    ['computed on globalThis', 'export const f = (k) => globalThis[k]'],
    ['globalThis.api', 'export const f = () => globalThis.api.file'],
    ['self.api', 'export const f = () => self.api'],
    ['a cast window', 'export const f = () => (window as unknown as { api: object }).api'],
    ['optional-chain aliasing', 'const a = window?.api\nexport { a }'],
    ['optional-chain assignment', 'let a\na = window?.api\nexport { a }'],
    ['optional-chain destructuring', 'const { file } = window?.api\nexport { file }']
  ])('flags %s', async (_name, code) => {
    expect(await gatewayMessages(RENDERER, code)).toHaveLength(1)
  })

  it('leaves the image-export harness handle alone', async () => {
    const code = 'export const h = (window as unknown as { imageExportApi: object }).imageExportApi'
    expect(await gatewayMessages(HARNESS, code)).toHaveLength(0)
  })

  it('leaves the other bridges to their own migration', async () => {
    expect(await gatewayMessages(RENDERER, READ_OTHER)).toHaveLength(0)
    expect(await gatewayMessages(RENDERER, 'export const f = () => deps.window[method]("a")')).toHaveLength(0)
  })

  it.each([
    'src/renderer/src/services/fileGateway.ts',
    'src/renderer/src/services/terminalGateway.ts'
  ])('exempts %s from the gateway rule only', async (file) => {
    expect(await gatewayMessages(file, READ_FILE)).toHaveLength(0)
    const messages = await lint(file, 'export const b = (p) => p.split("/").pop()')
    expect(messages.some((m) => /POSIX-only basename/.test(m.message))).toBe(true)
  })

  it.each([
    'src/renderer/src/utils/probe.test.ts',
    'src/renderer/src/components/X/__test__/helper.ts',
    'src/renderer/src/components/X/__tests__/helper.ts',
    'src/renderer/src/components/X/__test-utils__/helper.ts'
  ])('lets %s install mocks, and still applies the other selectors', async (file) => {
    expect(await gatewayMessages(file, READ_FILE)).toHaveLength(0)
    const messages = await lint(file, 'export const b = (p) => p.split("/").pop()')
    expect(messages.some((m) => /POSIX-only basename/.test(m.message))).toBe(true)
  })

  it('keeps the gateway rule on the files that own a banned pattern', async () => {
    expect(await gatewayMessages('src/renderer/src/utils/fileUtils.ts', READ_FILE)).toHaveLength(1)
    const messages = await lint('src/renderer/src/utils/fileUtils.ts', 'export const b = (p) => p.split("/").pop()')
    expect(messages.some((m) => /POSIX-only basename/.test(m.message))).toBe(false)
  })
})

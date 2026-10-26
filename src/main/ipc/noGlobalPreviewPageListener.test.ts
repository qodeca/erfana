// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * No global `ipcMain` listener for a preview page's channels (security review
 * of HTML Preview comments P4; docs/adrs/0005-sub-frame-preload-one-receive-channel.md;
 * docs/security.md "Revised for in-page links").
 *
 * The preview page's preload sends on `preview-page:*` channels, and main
 * listens for them on that view's `webContents.ipc` only. Electron ALSO emits
 * every renderer send on the global `ipcMain` – so a global listener on one of
 * those channels would hear every preview page, every frame of it included.
 * Two things keep that closed: every global listener is registered through
 * `registry.ts`, whose `isTrustedAppSender` gate refuses any sender that is
 * not the app's own top-level renderer; and no global listener exists for
 * these channels at all. This test pins the second, by reading every main
 * source file's register calls.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const MAIN_ROOT = join(__dirname, '..')

/** The global registration entry points (`registry.ts`) and `ipcMain`'s own methods. */
const REGISTER_FUNCTIONS = new Set(['registerOn', 'registerOnce', 'registerHandle', 'registerHandleOnce'])
const IPC_MAIN_METHODS = new Set(['on', 'once', 'handle', 'handleOnce', 'addListener', 'prependListener', 'prependOnceListener'])

/** A channel argument that names a preview page's channel, by value or by constant. */
const PREVIEW_PAGE_CHANNEL = /preview-page|PREVIEW_PAGE_|PreviewCommentPageChannels|LINK_ACTIVATED_CHANNEL|LINK_NOTE_CHANNEL|CSP_VIOLATION_CHANNEL/

/** Every non-test TypeScript source under `src/main`. */
function mainSources(dir: string = MAIN_ROOT): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('__')) out.push(...mainSources(path))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(path)
    }
  }
  return out
}

/** One global registration: where, and the channel argument as written. */
interface Registration {
  readonly file: string
  readonly channel: string
}

/** The global registrations in one source file. */
function registrationsIn(path: string): Registration[] {
  const text = readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const found: Registration[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression
      const isRegister = ts.isIdentifier(callee) && REGISTER_FUNCTIONS.has(callee.text)
      const isIpcMain =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'ipcMain' &&
        IPC_MAIN_METHODS.has(callee.name.text)
      if (isRegister || isIpcMain) {
        found.push({ file: relative(MAIN_ROOT, path), channel: node.arguments[0].getText(source) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const REGISTRATIONS = mainSources().flatMap(registrationsIn)

describe('global ipcMain listeners', () => {
  it('finds the app’s global registrations (the scan works)', () => {
    // ~118 handlers today; a scan that finds a handful has stopped seeing them.
    expect(REGISTRATIONS.length).toBeGreaterThan(80)
    expect(REGISTRATIONS.some(r => r.file.replace(/\\/g, '/') === 'ipc/registry.ts')).toBe(true)
  })

  it('registers none for a preview page’s channels – those live on webContents.ipc only', () => {
    const offending = REGISTRATIONS.filter(r => PREVIEW_PAGE_CHANNEL.test(r.channel))
    expect(offending).toEqual([])
  })

  it('recognises a preview page channel argument, by value or by name', () => {
    for (const channel of ["'preview-page:commentPick'", 'PREVIEW_PAGE_LINK_CHANNEL', 'PreviewCommentPageChannels.STATE']) {
      expect(PREVIEW_PAGE_CHANNEL.test(channel), channel).toBe(true)
    }
    expect(PREVIEW_PAGE_CHANNEL.test('PreviewChannels.OPEN')).toBe(false)
  })
})

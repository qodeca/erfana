// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser capture and send, main side (spec 025 commit 15;
 * 025-AC-036, and the main parts of 025-AC-028, 025-AC-033, 025-AC-034,
 * 025-AC-039, 025-AC-060, 025-AC-069 and 025-AC-077).
 *
 * No send UI exists before commit 19, so the tests drive what the renderer
 * will: confirm a pick, then `writeCapture` toward a terminal the app window
 * owns, and read what main wrote under `.erfana/browser/captures/`. The
 * target terminal is a real one created through the terminal bridge; `cat`
 * in front stands in for an agent (a non-shell foreground), which is how
 * main tells them apart on macOS and Linux.
 *
 * Freeze (Ctrl/Cmd+E, ADR 0008) is observed through the pick hook only: a
 * paused page cannot answer an evaluate. Condition-based waits only.
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { test, expect } from './fixtures/browserHarness'
import { openPicker, PICK_WAIT_MS as WAIT_MS, type PickDriver, type WriteCaptureAnswer } from './pages/browser-pick.page'

const IS_MAC = process.platform === 'darwin'
const MOD = IS_MAC ? 'meta' : 'control'
const CAPTURES_REL = path.join('.erfana', 'browser', 'captures')
const CAPTURE_PATH = /^\.erfana\/browser\/captures\/\d{8}-\d{6}Z-[0-9a-f]{8}(\.md|\.png|-crop\.png)$/
const GOLDEN = path.join(__dirname, 'fixtures', 'browser', 'context-file.golden.md')
const REQUIRED_HEADINGS = [
  '# Erfana browser capture',
  '## Capture facts',
  '## Untrusted page content',
  '### Page',
  '### Selector chain',
  '### Frame chain',
  '### Outer HTML',
  '### Computed styles',
  '### Layout chain'
]
const FENCE_OPEN = /^<<<ERFANA-UNTRUSTED-([0-9a-f]{32})>>>$/

interface TerminalApi {
  __terminalOutput?: Record<string, string>
  api: {
    terminal: {
      create(config: { cols: number; rows: number }): Promise<{ terminalId?: string; error?: string }>
      write(terminalId: string, data: string): Promise<unknown>
      kill(terminalId: string): Promise<unknown>
      onData(callback: (event: { terminalId: string; data: string }) => void): () => void
    }
  }
}

/** The shell prints this only once it reads commands: its own start-up programs have finished. */
const SHELL_READY_COMMAND = 'echo ERFANA_$((40+2))\r'
const SHELL_READY_OUTPUT = 'ERFANA_42'

/** A terminal in the app window whose shell has finished starting, and its id. */
async function createTerminal(pick: PickDriver): Promise<string> {
  const created = await pick.window.evaluate(() => {
    const w = window as unknown as TerminalApi
    if (w.__terminalOutput === undefined) {
      const output: Record<string, string> = {}
      w.__terminalOutput = output
      w.api.terminal.onData((e) => {
        output[e.terminalId] = (output[e.terminalId] ?? '') + e.data
      })
    }
    return w.api.terminal.create({ cols: 80, rows: 24 })
  })
  if (created.terminalId === undefined) throw new Error(`terminal create failed: ${created.error ?? 'no id'}`)
  const terminalId = created.terminalId
  await pick.window.evaluate(([id, command]) => (window as unknown as TerminalApi).api.terminal.write(id, command), [terminalId, SHELL_READY_COMMAND] as const)
  await expect
    .poll(() => pick.window.evaluate((id) => (window as unknown as TerminalApi).__terminalOutput?.[id] ?? '', terminalId), { timeout: WAIT_MS })
    .toContain(SHELL_READY_OUTPUT)
  await expect.poll(async () => (await pick.targetStatus(terminalId)).kind, { timeout: WAIT_MS }).toBe('shell')
  return terminalId
}

/** Put `cat` in front of the shell: a non-shell foreground, as an agent is. */
async function runCat(pick: PickDriver, terminalId: string): Promise<void> {
  await pick.window.evaluate((id) => (window as unknown as TerminalApi).api.terminal.write(id, 'cat\r'), terminalId)
  await expect.poll(async () => (await pick.targetStatus(terminalId)).kind, { timeout: WAIT_MS }).toBe('agent')
}

async function killTerminal(pick: PickDriver, terminalId: string): Promise<void> {
  await pick.window.evaluate((id) => (window as unknown as TerminalApi).api.terminal.kill(id), terminalId)
}

/** Hover `selector`, press Return, and wait for the capture. */
async function confirmPick(pick: PickDriver, selector: string, labelPrefix: string): Promise<string> {
  await pick.mode(true)
  await expect.poll(async () => (await pick.state()).active, { timeout: WAIT_MS }).toBe(true)
  await pick.hover(await pick.rect(selector), labelPrefix)
  const before = (await pick.events()).length
  await pick.key('Return')
  const captured = await pick.waitForEvent((e) => e.kind === 'captured', before)
  return captured.captureId!
}

function pathsOf(answer: WriteCaptureAnswer): { context: string; screenshot: string; crop: string } {
  if (!('paths' in answer)) throw new Error(`capture not written: ${JSON.stringify(answer)}`)
  return answer.paths
}

const headings = (text: string): string[] => text.split('\n').filter((line) => /^#{1,3} /.test(line))

/** The lines between the fence pair, and the lines outside it. */
function splitFence(text: string): { token: string; inside: string[]; outside: string[] } {
  const lines = text.split('\n')
  const open = lines.findIndex((l) => FENCE_OPEN.test(l))
  expect(open, 'opening fence line').toBeGreaterThan(-1)
  const token = FENCE_OPEN.exec(lines[open])![1]
  const close = lines.indexOf(`<<<END-ERFANA-UNTRUSTED-${token}>>>`)
  expect(close, 'closing fence line').toBeGreaterThan(open)
  // The real closing line is the last one: page text may imitate it, never with the token.
  expect(lines.lastIndexOf(`<<<END-ERFANA-UNTRUSTED-${token}>>>`)).toBe(close)
  return { token, inside: lines.slice(open + 1, close), outside: [...lines.slice(0, open), ...lines.slice(close + 1)] }
}

async function captureFiles(projectRoot: string): Promise<string[]> {
  return (await fs.readdir(path.join(projectRoot, CAPTURES_REL)).catch(() => [] as string[])).sort()
}

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('built-in browser capture and send (main side)', () => {
  test('the guard refuses a missing terminal and a bare shell; toward an agent the three files are written with exact names and the golden structure (main side of 025-AC-077, 025-AC-033)', async ({
    browserTabs,
    browserServers,
    testProject
  }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/elements.html'))
    const captureId = await confirmPick(pick, '#save-label', 'span#save-label ')

    // No such terminal: refused, and the status reads unknown.
    expect(await pick.write(captureId, 'terminal-999999')).toEqual({ guard: { kind: 'noTerminal', process: null } })
    expect((await pick.targetStatus('terminal-999999')).kind).toBe('unknown')

    // A bare shell: refused even with Send anyway.
    const terminalId = await createTerminal(pick)
    expect(await pick.write(captureId, terminalId, true)).toMatchObject({ guard: { kind: 'shell' } })
    expect(await captureFiles(testProject.path)).toEqual([])

    await runCat(pick, terminalId)
    const paths = pathsOf(await pick.write(captureId, terminalId))
    for (const rel of Object.values(paths)) expect(rel).toMatch(CAPTURE_PATH)
    const base = paths.context.replace(/\.md$/, '')
    expect(paths).toEqual({ context: `${base}.md`, screenshot: `${base}.png`, crop: `${base}-crop.png` })
    expect(await captureFiles(testProject.path)).toEqual([`${base}.md`, `${base}.png`, `${base}-crop.png`].map((p) => path.basename(p)).sort())
    expect((await pick.state()).capture?.written).toHaveLength(3)

    // A second send renders afresh (the pick may have moved in the menu since): new names; the first files stay.
    const again = pathsOf(await pick.write(captureId, terminalId))
    expect(again.context).not.toBe(paths.context)
    expect(await captureFiles(testProject.path)).toHaveLength(6)

    // The context file has the golden file's structure and points at its own images.
    const context = await fs.readFile(path.join(testProject.path, paths.context), 'utf8')
    const golden = await fs.readFile(GOLDEN, 'utf8')
    const order = headings(golden)
    const ours = headings(context)
    // Every heading is one of the golden file's, in its order; sections without data may be left out.
    expect(ours.map((h) => order.indexOf(h))).toEqual([...ours.map((h) => order.indexOf(h))].sort((a, b) => a - b))
    expect(ours.filter((h) => !order.includes(h))).toEqual([])
    for (const required of REQUIRED_HEADINGS) expect(ours).toContain(required)
    expect(context).toContain(`- Screenshot: ${paths.screenshot}`)
    expect(context).toContain(`- Element crop: ${paths.crop}`)
    const fence = splitFence(context)
    expect(fence.inside.join('\n')).toContain('<span id="save-label"')
    expect(fence.outside.join('\n')).not.toContain('save-label"')

    // The images are PNGs.
    for (const rel of [paths.screenshot, paths.crop]) {
      const bytes = await fs.readFile(path.join(testProject.path, rel))
      expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
    }

    // The renderer closes the menu after a send; the files stay.
    expect((await pick.close(captureId, 'sent')).ok).toBe(true)
    await expect.poll(async () => (await pick.state()).capture, { timeout: WAIT_MS }).toBeNull()
    expect(await captureFiles(testProject.path)).toHaveLength(6)
    await killTerminal(pick, terminalId)
  })

  test('025-AC-036 page text, ids, the title and console lines of a hostile page appear only inside the fenced block', async ({
    browserTabs,
    browserServers,
    testProject
  }) => {
    test.skip(process.platform === 'win32', 'The agent stand-in needs a foreground process name (macOS and Linux)')
    const url = browserServers.sites.react18.url('/?page=inject&q=INJECT-7f3a')
    const pick = await openPicker(browserTabs, url)
    await pick.page.waitFor(`document.title.includes('INJECT-7f3a')`)
    const captureId = await confirmPick(pick, '[id="INJECT-7f3a-id"]', 'button#INJECT-7f3a-id ')
    const terminalId = await createTerminal(pick)
    await runCat(pick, terminalId)
    const paths = pathsOf(await pick.write(captureId, terminalId))
    const context = await fs.readFile(path.join(testProject.path, paths.context), 'utf8')

    const fence = splitFence(context)
    expect(fence.outside.filter((line) => line.includes('INJECT-7f3a'))).toEqual([])
    expect(fence.inside.some((line) => line.includes('INJECT-7f3a'))).toBe(true)
    // No page line imitates the real fence: the token is Erfana's own, fresh per capture.
    expect(fence.inside.filter((line) => line.includes(fence.token))).toEqual([])
    await killTerminal(pick, terminalId)
  })

  test('an empty first screenshot is retried; a failed write leaves no files and the next write succeeds (main side of 025-AC-034, 025-AC-060)', async ({
    browserTabs,
    browserServers,
    testProject
  }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/elements.html'))
    try {
      // One empty screenshot: the retry captures.
      await pick.hook('armEmptyCaptures', 1)
      const captureId = await confirmPick(pick, '#save-label', 'span#save-label ')
      await pick.close(captureId, 'esc')

      // Two empty screenshots: the capture fails and pick mode stays on.
      await pick.hook('armEmptyCaptures', 2)
      const button = await pick.rect('#save-button')
      // The button's padding, left of its centred label.
      await pick.move(Math.round(button.x + 3), Math.round(button.y + 3))
      await pick.waitForLabel('button#save-button ')
      const before = (await pick.events()).length
      await pick.key('Return')
      const failed = await pick.waitForEvent((e) => e.kind === 'captureFailed', before)
      expect(failed.reason).toBeTruthy()
      expect((await pick.state()).active).toBe(true)
      expect((await pick.state()).capture).toBeNull()

      // A write that fails names why, and nothing is left behind.
      const held = await confirmPick(pick, '#save-label', 'span#save-label ')
      const terminalId = await createTerminal(pick)
      if (process.platform === 'win32') return
      await runCat(pick, terminalId)
      await pick.hook('armWriteFailures', 1)
      const answer = await pick.write(held, terminalId)
      expect(answer).toMatchObject({ error: expect.stringMatching(/^The capture could not be saved: /) })
      expect(await captureFiles(testProject.path)).toEqual([])
      expect(pathsOf(await pick.write(held, terminalId)).context).toMatch(CAPTURE_PATH)

      // A terminal failure after the write: the renderer asks main to remove the files.
      expect((await pick.discard(held)).ok).toBe(true)
      expect(await captureFiles(testProject.path)).toEqual([])
      await killTerminal(pick, terminalId)
    } finally {
      await pick.hook('resetFaults')
    }
  })

  test('the expiry sweep removes old capture files only: not other names, not links, not recent captures (main side of 025-AC-039, 025-AC-069)', async ({
    browserTabs,
    browserServers,
    testProject
  }) => {
    test.skip(process.platform === 'win32', 'The agent stand-in needs a foreground process name (macOS and Linux)')
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/elements.html'))
    const captureId = await confirmPick(pick, '#save-label', 'span#save-label ')
    const terminalId = await createTerminal(pick)
    await runCat(pick, terminalId)
    const fresh = pathsOf(await pick.write(captureId, terminalId))

    const dir = path.join(testProject.path, CAPTURES_REL)
    const outside = path.join(testProject.path, 'keep-me.png')
    await fs.writeFile(outside, 'outside')
    await fs.writeFile(path.join(dir, '20200101-000000Z-0000aaaa.png'), 'old')
    await fs.writeFile(path.join(dir, '20200101-000000Z-0000aaaa.md'), 'old')
    await fs.writeFile(path.join(dir, 'notes.txt'), 'not a capture')
    await fs.symlink(outside, path.join(dir, '20200101-000000Z-0000bbbb.png'))

    const deleted = await pick.hook<string[]>('expire', testProject.path)
    expect([...deleted].sort()).toEqual(['20200101-000000Z-0000aaaa.md', '20200101-000000Z-0000aaaa.png'])
    expect(await captureFiles(testProject.path)).toEqual(
      ['20200101-000000Z-0000bbbb.png', 'notes.txt', ...Object.values(fresh).map((p) => path.basename(p))].sort()
    )
    expect(await fs.readFile(outside, 'utf8')).toBe('outside')
    await killTerminal(pick, terminalId)
  })

  test('Ctrl/Cmd+E freezes the page after the facts are read; closing the menu unfreezes it (main side of 025-AC-028)', async ({ browserTabs, browserServers }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/hover-menu.html'))
    await pick.mode(true)
    await expect.poll(async () => (await pick.state()).active, { timeout: WAIT_MS }).toBe(true)
    await pick.hover(await pick.rect('#menu-trigger'), 'button#menu-trigger ')
    await pick.page.waitFor(`!document.getElementById('hover-menu').hidden`)
    await pick.hover(await pick.rect('#item-reports'), 'a#item-reports ')
    const before = (await pick.events()).length
    await pick.key('e', [MOD])
    const captured = await pick.waitForEvent((e) => e.kind === 'captured', before)
    expect(captured.summary?.name).toBe('a#item-reports')
    await pick.waitForEvent((e) => e.kind === 'frozen' && e.captureId === captured.captureId, before)
    expect((await pick.state()).frozen).toBe(true)

    // Refining while frozen still works: the chain was read before the pause.
    const refinedAt = (await pick.events()).length
    await pick.refine(captured.captureId!, 'parent')
    expect((await pick.waitForEvent((e) => e.kind === 'refined', refinedAt)).summary?.name).toBe('li')

    expect((await pick.close(captured.captureId!, 'esc')).ok).toBe(true)
    await expect.poll(async () => (await pick.state()).frozen, { timeout: WAIT_MS }).toBe(false)
    // The page runs again, and the menu the pause held open is still open.
    expect(await pick.page.eval<boolean>(`document.getElementById('hover-menu').hidden`)).toBe(false)
  })

  test('a page that changes its document under the open menu ends pick mode with the page-changed reason (main side of 025-AC-025)', async ({
    browserTabs,
    browserServers
  }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/elements.html'))
    const captureId = await confirmPick(pick, '#save-label', 'span#save-label ')
    const before = (await pick.events()).length
    const next = browserServers.sites.static.url('/plain.html')
    await pick.page.eval(`setTimeout(() => { location.href = ${JSON.stringify(next)} }, 0); 0`)
    await pick.page.waitForLoaded(next)
    const ended = await pick.waitForEvent((e) => e.kind === 'ended', before)
    expect(ended.reason).toBe('pageChanged')
    // The capture stays for the open menu, marked as taken before the change.
    const state = await pick.state()
    if (state.capture !== null) {
      expect(state.capture.id).toBe(captureId)
      expect(state.capture.afterNavigation).toBe(true)
    }
  })
})

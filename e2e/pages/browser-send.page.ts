// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick and send as the user does it, end to end (spec 025, 025-AC-032,
 * 025-AC-060, 025-AC-063, 025-AC-064, 025-AC-066, 025-AC-070, 025-AC-077):
 * a browser tab opened with **New browser tab**, Erfana's terminal panel
 * running a program the test chose – the stub agent
 * (`fixtures/browser/stub-agent.cjs`, which records every byte it receives),
 * a bare shell, or a stand-in wrapper – and the capture files main writes
 * under `.erfana/browser/captures/`.
 *
 * Erfana's own UI is driven by role and accessible name through
 * {@link BrowserPickUi}; the page's pointer and keys through main-side input
 * hooks ({@link PickDriver}). Condition-based waits only.
 *
 * ```ts
 * const send = await BrowserSendUi.open(app, window, testProject.path)
 * const agent = await send.startStubAgent(test.info().outputPath('agent.bin'))
 * await send.loadAndPick(url, '#save-label', 'span#save-label ')
 * await send.pick.action('Explain').click()
 * expect(await agent.waitForSubmitted()).toContain('@.erfana/browser/captures/')
 * ```
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'
import { BrowserTabUiPage, type BrowserPanelUi } from './browser-tab-ui.page'
import { BrowserPickUi } from './browser-pick-ui.page'
import { mainHook, PICK_WAIT_MS, type Box, type HookPickState, type PickDriver } from './browser-pick.page'
import { TerminalPage } from './terminal.page'

export const SEND_WAIT_MS = 15_000
export const CAPTURES_REL = path.join('.erfana', 'browser', 'captures')
const STUB_AGENT = path.join(__dirname, '..', 'fixtures', 'browser', 'stub-agent.cjs')

export const PASTE_START = '\x1b[200~'
export const PASTE_END = '\x1b[201~'

/** The bytes a stub agent received, as the test reads them from its record file. */
export class StubAgent {
  constructor(readonly recordFile: string) {}

  /** Everything received so far, as text. */
  async received(): Promise<string> {
    return fs.readFile(this.recordFile, 'utf8').catch(() => '')
  }

  /**
   * Wait until one whole submitted prompt arrived – a bracketed paste
   * followed by Enter – and return its text between the markers.
   */
  async waitForSubmitted(): Promise<string> {
    await expect
      .poll(async () => (await this.received()).endsWith(`${PASTE_END}\r`), {
        timeout: SEND_WAIT_MS,
        message: 'the agent should receive one pasted prompt and Enter'
      })
      .toBe(true)
    const all = await this.received()
    return all.slice(all.indexOf(PASTE_START) + PASTE_START.length, all.lastIndexOf(PASTE_END))
  }

  /** Forget what was received so far. */
  async reset(): Promise<void> {
    await fs.writeFile(this.recordFile, '')
  }
}

/** One browser tab with pick and send, Erfana's terminal and the project's capture folder. */
export class BrowserSendUi {
  readonly terminal: TerminalPage

  private constructor(
    readonly app: ElectronApplication,
    readonly window: Page,
    readonly projectRoot: string,
    readonly ui: BrowserTabUiPage,
    readonly panel: BrowserPanelUi,
    readonly pick: BrowserPickUi
  ) {
    this.terminal = new TerminalPage(window)
  }

  /** Open a browser tab with **New browser tab**. */
  static async open(app: ElectronApplication, window: Page, projectRoot: string): Promise<BrowserSendUi> {
    const ui = new BrowserTabUiPage(app, window)
    const panel = await ui.openWithButton()
    return new BrowserSendUi(app, window, projectRoot, ui, panel, new BrowserPickUi(panel, app))
  }

  /** Open the terminal panel, start the stub agent there and wait until it reads input. */
  async startStubAgent(recordFile: string): Promise<StubAgent> {
    await this.terminal.open()
    await this.terminal.sendCommand(`"${process.execPath}" "${STUB_AGENT}" "${recordFile}"`)
    await this.terminal.waitForOutputLine(`STUB-AGENT-READY ${path.basename(recordFile)}`, { timeout: SEND_WAIT_MS })
    await this.waitForTarget(/· node, target terminal$/)
    return new StubAgent(recordFile)
  }

  /**
   * Start the stub agent under another program name – node under the name
   * `name` (`ssh`, `sudo`, …) in `linkDir` – so the foreground reads as that
   * program. A hard link (a copy across volumes): the kernel names a process
   * after the file it ran, and a symbolic link resolves to node's own name.
   * The terminal panel must be open.
   */
  async startStubAs(name: string, linkDir: string, recordFile: string, target: RegExp): Promise<StubAgent> {
    await fs.mkdir(linkDir, { recursive: true })
    const link = path.join(linkDir, name)
    await fs.link(process.execPath, link).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') return
      if (error.code !== 'EXDEV') throw error
      await fs.copyFile(process.execPath, link)
    })
    await this.terminal.sendCommand(`"${link}" "${STUB_AGENT}" "${recordFile}"`)
    await this.terminal.waitForOutputLine(`STUB-AGENT-READY ${path.basename(recordFile)}`, { timeout: SEND_WAIT_MS })
    await this.waitForTarget(target)
    return new StubAgent(recordFile)
  }

  /** End the stub agent with Ctrl+D and wait until the shell is back in front. */
  async stopStub(): Promise<void> {
    await this.terminal.focus()
    await this.window.keyboard.press('Control+d')
    await this.waitForTarget(/no agent running$/)
  }

  /** Open the terminal panel and wait for its shell, which the target reads as a shell. */
  async startShell(): Promise<void> {
    await this.terminal.open()
    // Typed input ends the start-up window, in which any program reads as the shell.
    await this.terminal.sendCommand('echo ERFANA_$((40+2))')
    await this.terminal.waitForOutputLine('ERFANA_42')
    await this.waitForTarget(/no agent running$/)
  }

  /** Run `command` in the terminal panel's shell. */
  async run(command: string): Promise<void> {
    await this.terminal.sendCommand(command)
  }

  /** Wait until the pick row's target button reads `name` (it is asked anew while the menu is closed). */
  async waitForTarget(name: RegExp): Promise<void> {
    await expect(async () => {
      // The target is read when the chooser opens; open and close it until main's answer is in.
      await this.pick.target.click()
      await expect(this.panel.menu('Target terminal')).toBeVisible()
      await this.window.keyboard.press('Escape')
      await expect(this.panel.menu('Target terminal')).toHaveCount(0)
      await expect(this.pick.target).toHaveAccessibleName(name, { timeout: 1_000 })
    }).toPass({ timeout: SEND_WAIT_MS })
  }

  /** Load `url` through the address bar and wait until the page takes input. */
  async load(url: string): Promise<void> {
    await this.panel.load(url)
    await this.panel.waitForState({ committedUrl: url, loading: false })
    const page = await this.panel.page()
    await page.waitForLoaded(url)
    await page.waitForInputReady()
  }

  /** Turn pick mode on with **Pick element**, hover `selector`, press Return, and wait for the panel. */
  async pickElement(selector: string, labelPrefix: string): Promise<void> {
    if ((await this.pick.pickButton.getAttribute('aria-pressed')) !== 'true') await this.pick.pickButton.click()
    await expect(this.pick.pickButton).toHaveAttribute('aria-pressed', 'true')
    await this.pick.confirm(selector, labelPrefix)
  }

  /**
   * Turn pick mode on, move the pointer to `at` (page CSS px, default the
   * centre of `selector`'s box), wait for any highlight, press Return and wait
   * for the panel. For elements whose label the test does not know (a closed
   * shadow root, a canvas). Returns the point.
   */
  async pickAt(selector: string, at?: { x: number; y: number }): Promise<{ x: number; y: number }> {
    if ((await this.pick.pickButton.getAttribute('aria-pressed')) !== 'true') await this.pick.pickButton.click()
    const driver = await this.driver()
    await expect.poll(async () => (await driver.state()).active, { timeout: PICK_WAIT_MS }).toBe(true)
    const box = await driver.rect(selector)
    const point = at ?? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    await driver.move(point.x, point.y)
    // The highlight is on an element inside `selector`'s box (not the one the pointer was over before the move).
    const inside = (h: Box | null): boolean =>
      h !== null && h.x >= box.x - 1 && h.y >= box.y - 1 && h.x + h.width <= box.x + box.width + 1 && h.y + h.height <= box.y + box.height + 1
    await expect.poll(async () => inside((await driver.highlight())?.box ?? null), { timeout: PICK_WAIT_MS, message: `highlight inside ${selector}` }).toBe(true)
    await driver.key('Return')
    await expect(this.pick.actions).toBeVisible({ timeout: PICK_WAIT_MS })
    return point
  }

  /** Send Explain from the open panel and return the context file's text and the project-relative paths it names. */
  async explainAndRead(agent: StubAgent): Promise<{ context: string; contextPath: string; screenshotPath: string; cropPath: string }> {
    await agent.reset()
    await this.pick.action('Explain').click()
    const prompt = await agent.waitForSubmitted()
    const ref = (label: string): string => {
      const match = new RegExp(`${label}: @(\\S+)`).exec(prompt)
      if (match === null) throw new Error(`The prompt names no ${label}`)
      return match[1]
    }
    const contextPath = ref('Context file')
    return {
      context: await this.readProjectFile(contextPath),
      contextPath,
      screenshotPath: ref('Screenshot'),
      cropPath: ref('Element crop')
    }
  }

  /** Open the dialog of `action` (Ask, Change, Prompt) from the panel, type `text` and return the field. */
  async openDialog(action: 'Ask' | 'Change' | 'Prompt', text?: string): Promise<Locator> {
    await this.pick.action(action).click()
    await expect(this.pick.dialog).toBeVisible()
    const field = this.dialogField
    await expect(field).toBeFocused()
    if (text !== undefined) await field.fill(text)
    return field
  }

  get dialogField(): Locator {
    return this.pick.dialog.getByRole('textbox')
  }

  get dialogSend(): Locator {
    return this.pick.dialog.getByRole('button', { name: 'Send', exact: true })
  }

  /** The send notice in the pick row's status slot. */
  get notice(): Locator {
    return this.pick.status.locator('.erf-brw-notice')
  }

  /** The banner of the panel or dialog (a guard, a pre-warning, "Sends to"). */
  banner(surface: Locator): Locator {
    return surface.locator('.erf-brw-banner').filter({ has: this.window.locator('.erf-brw-banner__text') })
  }

  /**
   * Record every toast that appears from now on (type and text), so a test can
   * count toasts that have already gone.
   */
  async recordToasts(): Promise<void> {
    await this.window.evaluate((prefix) => {
      const w = window as unknown as { __toastLog?: Array<{ type: string; text: string }> }
      if (w.__toastLog !== undefined) return
      const log: Array<{ type: string; text: string }> = []
      w.__toastLog = log
      const seen = new WeakSet<Element>()
      const scan = (record: boolean): void => {
        for (const el of document.querySelectorAll(`[data-testid^="${prefix}-"]`)) {
          const type = el.getAttribute('data-testid')!.slice(prefix.length + 1)
          if (!['error', 'info', 'success', 'warning'].includes(type) || seen.has(el)) continue
          seen.add(el)
          if (record) log.push({ type, text: el.textContent ?? '' })
        }
      }
      // Toasts already up (Project Opened) are not new.
      scan(false)
      new MutationObserver(() => scan(true)).observe(document.body, { childList: true, subtree: true })
    }, TEST_IDS.TOAST)
  }

  /** The toasts recorded since {@link recordToasts}. */
  toastLog(): Promise<Array<{ type: string; text: string }>> {
    return this.window.evaluate(() => (window as unknown as { __toastLog?: Array<{ type: string; text: string }> }).__toastLog ?? [])
  }

  errorToasts(): Locator {
    return byTestId(this.window, `${TEST_IDS.TOAST}-error`)
  }

  infoToasts(): Locator {
    return byTestId(this.window, `${TEST_IDS.TOAST}-info`)
  }

  /** The terminal panel's xterm instance. */
  get terminalInstance(): Locator {
    return byTestId(this.window, TEST_IDS.TERMINAL_INSTANCE)
  }

  /**
   * Park Erfana's pointer over the project tree, away from the notice and the
   * page: Playwright leaves it where the last click was.
   */
  async parkPointer(): Promise<void> {
    const box = await byTestId(this.window, TEST_IDS.PROJECT_TREE).boundingBox()
    if (box === null) throw new Error('The project tree is not drawn')
    await this.window.mouse.move(box.x + box.width / 2, box.y + box.height - 8)
  }

  /** Where main's key routing has this tab's keyboard focus: `page`, `toolbar` or `out`. */
  async routingFocus(): Promise<string> {
    return (await mainHook<{ focus: string }>(this.app, 'browserInput', 'routingState', await this.panel.tabId())).focus
  }

  /**
   * Press a key on Erfana's own window the way the keyboard does – main-side
   * `sendInputEvent`, so `before-input-event` and the browser-key routing see
   * it (Playwright's keyboard reaches the DOM only). For keys pressed in the
   * tab's own controls (menu, dialog, toolbar): it first waits until main has
   * heard that they hold focus, or the key would race that report.
   */
  async windowKey(key: string, modifiers: Array<'shift' | 'control' | 'alt' | 'meta'> = []): Promise<void> {
    await expect.poll(() => this.routingFocus(), { timeout: SEND_WAIT_MS, message: 'main hears toolbar focus' }).toBe('toolbar')
    await mainHook(this.app, 'browserInput', 'windowKey', await this.panel.tabId(), key, modifiers)
  }

  /** Move main's test clock forward. */
  advanceMainClock(ms: number): Promise<void> {
    return mainHook(this.app, 'clock', 'advance', ms)
  }

  /** The editor tab (dockview's tab) whose label holds `name`. */
  editorTab(name: string): Locator {
    return this.window.locator('.dv-tab').filter({ hasText: name })
  }

  /** The page's pick driver (main-side input and reads). */
  driver(): Promise<PickDriver> {
    return this.pick.driver()
  }

  async pickState(): Promise<HookPickState> {
    return mainHook(this.app, 'pick', 'state', await this.panel.tabId())
  }

  /** Arm a main-side fault of the pick hook (`armWriteFailures`, `armCaptureFailures`, …). */
  fault(name: string, ...args: unknown[]): Promise<unknown> {
    return mainHook(this.app, 'pick', name, ...args)
  }

  /**
   * Make the next pasted prompt fail to reach the terminal: main's
   * `terminal:write` handler answers `{ success: false }` once for a write that
   * starts a bracketed paste, and passes every other write through. Stands in
   * for a terminal that fails after the capture files were written
   * (025-FR-046).
   */
  async failNextTerminalPaste(): Promise<void> {
    await this.app.evaluate(({ ipcMain }, start) => {
      type Handler = (event: unknown, payload: unknown) => unknown
      // Electron keeps `ipcMain.handle` listeners in this map; the test wraps the one it needs.
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('terminal:write')
      if (original === undefined) throw new Error('terminal:write is not registered')
      let armed = true
      handlers.set('terminal:write', (event, payload) => {
        const data = (payload as { data?: unknown } | null)?.data
        if (armed && typeof data === 'string' && data.startsWith(start)) {
          armed = false
          return { success: false, error: 'forced terminal write failure' }
        }
        return original(event, payload)
      })
    }, PASTE_START)
  }

  /** The names in the project's capture folder, sorted (none when it does not exist). */
  async captureFiles(): Promise<string[]> {
    return (await fs.readdir(path.join(this.projectRoot, CAPTURES_REL)).catch(() => [] as string[])).sort()
  }

  /** Wait until the capture folder holds exactly `count` files. */
  async waitForCaptureCount(count: number): Promise<string[]> {
    await expect.poll(() => this.captureFiles(), { timeout: PICK_WAIT_MS }).toHaveLength(count)
    return this.captureFiles()
  }

  /** A file of the project, as text. */
  readProjectFile(relative: string): Promise<string> {
    return fs.readFile(path.join(this.projectRoot, relative), 'utf8')
  }
}

/** `@.erfana/browser/captures/<name>` references in a prompt, with the names masked. */
export function maskCaptureRefs(prompt: string): string {
  return prompt.replace(/\.erfana\/browser\/captures\/\d{8}-\d{6}Z-[0-9a-f]{8}/g, '.erfana/browser/captures/{capture}')
}

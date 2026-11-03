// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser logging contract (spec 025, 025-FR-064 / 025-AC-080, and
 * the recorded URL exception 025-FR-042 / 025-AC-042).
 *
 * A capture-and-navigation scenario runs with canary values – a page title, a
 * form field, console text, a typed search and an instruction – and none of
 * them may reach Erfana's log files (`main.log`, `renderer.log`,
 * `combined.log`) or a capture file's name. A failed page load, on the other
 * hand, logs its full URL with the query string and without the fragment
 * (docs/technical-debt.md entry 68), and a failed search logs the event only.
 *
 * The send goes to `cat` in the app's terminal, which counts as an agent for
 * the target guard and echoes what it is typed. Condition-based waits only.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { test, expect } from './fixtures/browserHarness'
import { LogTail } from './fixtures/logTail'
import { appLogsDir } from './fixtures/isolation'
import { TerminalPage } from './pages/terminal.page'
import { BrowserTabUiPage } from './pages/browser-tab-ui.page'
import { BrowserPickUi } from './pages/browser-pick-ui.page'

const WAIT_MS = 20_000
const LOG_FILES = ['main.log', 'renderer.log', 'combined.log'] as const

test.describe('built-in browser logging', () => {
  test('025-AC-080 canary title, form field, console text, search text and instruction never reach a log file; 025-AC-042 a failed load logs its full URL', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject,
    homeDir
  }) => {
    test.setTimeout(120_000)
    const run = Date.now().toString(36)
    const canary = {
      title: `TITLECANARY${run}`,
      field: `FIELDCANARY${run}`,
      console: `CONSOLECANARY${run}`,
      search: `SEARCHCANARY${run}`,
      instruction: `INSTRUCTIONCANARY${run}`
    }
    const logs = LOG_FILES.map(name => new LogTail(path.join(appLogsDir(homeDir), name)))
    for (const log of logs) await log.mark()

    // The send's target: `cat` echoes the typed prompt back.
    const terminalPage = new TerminalPage(windowWithTestProject)
    await terminalPage.open()
    await terminalPage.sendCommand('cat')
    await terminalPage.waitForOutput('cat')

    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const url = browserServers.sites.static.url('/form.html')
    await panel.load(url)
    await panel.waitForState({ committedUrl: url, loading: false })
    const page = await panel.page()
    await page.waitForLoaded(url)

    // Title and console text from the page; a value typed into a form field.
    await page.eval(`document.title = ${JSON.stringify(canary.title)}; console.log(${JSON.stringify(canary.console)}); console.error(${JSON.stringify(canary.console)}); 0`)
    await expect(ui.editorTabs.first()).toContainText(canary.title, { timeout: WAIT_MS })
    await page.eval(`document.querySelector('#username').value = ''; 0`)
    await page.fill('#username', canary.field)

    // Pick the field and send an instruction about it.
    const pick = new BrowserPickUi(panel, appWithTestProject)
    await pick.pickButton.click()
    await pick.confirm('#username', 'input#username')
    await pick.action('Ask').click()
    await pick.dialog.getByRole('textbox', { name: 'Your question' }).fill(canary.instruction)
    await pick.dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await terminalPage.waitForOutput(canary.instruction, { timeout: WAIT_MS })
    await terminalPage.waitForOutput('.erfana/browser/captures', { timeout: WAIT_MS })

    // A typed search fails on the sealed network: the event is logged, not the text.
    await panel.load(`${canary.search} words`)
    await logs[0].waitFor(/search load failed/, { timeout: WAIT_MS })

    // A failed load logs the full URL with its query, without userinfo or the fragment (025-FR-042).
    const query = `token=QUERY${run}`
    await panel.load(`http://user:pw${run}@nowhere.example/path/to?${query}#FRAG${run}`)
    await logs[0].waitFor(new RegExp(`A browser tab page failed to load.*http://nowhere\\.example/path/to\\?${query}`), { timeout: WAIT_MS })

    for (const [index, log] of logs.entries()) {
      const text = await log.appended()
      for (const [name, value] of Object.entries(canary)) {
        expect(text, `${LOG_FILES[index]} holds the ${name} canary`).not.toContain(value)
      }
      expect(text, `${LOG_FILES[index]} holds the fragment`).not.toContain(`FRAG${run}`)
      expect(text, `${LOG_FILES[index]} holds the userinfo`).not.toContain(`pw${run}`)
    }

    const captures = path.join(testProject.path, '.erfana', 'browser', 'captures')
    const names = fs.existsSync(captures) ? fs.readdirSync(captures) : []
    expect(names.length, 'the send wrote capture files').toBeGreaterThan(0)
    for (const value of Object.values(canary)) {
      expect(names.join('\n')).not.toContain(value)
    }
  })
})

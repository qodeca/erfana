// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * React component and source hints in the context file (spec 025,
 * 025-FR-037, 025-AC-037), on the React 18 and React 19 fixture apps
 * (`apps/react18`, `apps/react19`): development, production and
 * no-source-map builds, the source attributes of `?page=inspector`, forced
 * hint failures (the pick test hook), and the parent's hints after a
 * Ctrl/Cmd+E pick. Every capture is a real send – pick, **Explain**, the stub
 * agent in the terminal – read back with the shared context-file parser.
 *
 * Source by version (owner decision, 2026-11-05): React 18 development JSX
 * carries its source, so React 18 names it with or without a source map;
 * React 19 names it through the page's source map, so its `/nomaps/` build
 * (every map answers 404) says "source not found", as does a production
 * build of either.
 *
 * Proven elsewhere, not here: the resolved-source exclusions (S-13) in
 * `sourceHints.test.ts` (`isResolvableSourcePath`, `resolveSourcePath`), and
 * that no page function runs while the page is frozen in
 * `sourceHints.test.ts` ("no lookup while frozen") – a frozen page cannot
 * show it ran nothing, so here the parent's hints are only checked to come
 * from no React lookup. Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import { listItems, parseContextFile, type ParsedContextFile } from './fixtures/browser/contextFile.parse'
import { BrowserSendUi, SEND_WAIT_MS, type StubAgent } from './pages/browser-send.page'

const IS_POSIX = process.platform !== 'win32'
const MOD = process.platform === 'darwin' ? 'meta' : 'control'

async function hints(send: BrowserSendUi, agent: StubAgent, url: string, selector: string): Promise<ParsedContextFile> {
  await send.load(url)
  await send.pickAt(selector)
  return parseContextFile((await send.explainAndRead(agent)).context)
}

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('React hints in the context file', () => {
  test.skip(!IS_POSIX, 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('025-AC-037 a development build on React 18 and on React 19 names the component, up to 5 owners and the source file and line', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    for (const site of ['react18', 'react19'] as const) {
      const parsed = await hints(send, agent, browserServers.sites[site].url('/'), '.save-label')
      const items = listItems(parsed.sections['React'])
      expect(items, site).toEqual([
        'Component: ItemRow',
        'Owners: ItemList › HomePage › App',
        'Source: src/components/ItemRow.tsx:16'
      ])
      // Up to 5 owners.
      expect(items[1].split(' › ').length, site).toBeLessThanOrEqual(5)
      expect(parsed.notes, site).not.toContain('source not found')
    }
  })

  test('025-AC-037 a production build on React 18 and on React 19 says "source not found" and the prompt is sent', async ({ appWithTestProject, windowWithTestProject, browserServers, testProject }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    for (const site of ['react18', 'react19'] as const) {
      const parsed = await hints(send, agent, browserServers.sites[site].url('/prod/'), '.save-label')
      expect(parsed.notes, site).toContain('source not found')
      expect(listItems(parsed.sections['React']), site).toContain('Source: unknown')
    }
  })

  test('025-AC-037 a React 19 development build without source maps says "source not found" and the prompt is sent', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    const parsed = await hints(send, agent, browserServers.sites.react19.url('/nomaps/'), '.save-label')
    expect(parsed.notes).toContain('source not found')
    const items = listItems(parsed.sections['React'])
    // The component and owners come from the fibers; only the source needs the map.
    expect(items.slice(0, 2)).toEqual(['Component: ItemRow', 'Owners: ItemList › HomePage › App'])
    expect(items).toContain('Source: unknown')
  })

  test('025-AC-037 source attributes are reported first', async ({ appWithTestProject, windowWithTestProject, browserServers, testProject }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    const parsed = await hints(send, agent, browserServers.sites.react18.url('/?page=inspector'), '.inspector-button')
    expect(listItems(parsed.sections['Source attributes'])).toEqual([
      'data-inspector-relative-path="src/pages/InspectorPage.tsx"',
      'data-inspector-line="24"',
      'data-inspector-column="7"'
    ])
    // The attributes answered: the React lookup did not run.
    expect(listItems(parsed.sections['React'])).toEqual(['none'])
  })

  test('025-AC-037 a hint lookup that throws, or that takes 2 s, never blocks the send: past the 750 ms limit it says "source not found"', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    try {
      await send.fault('armHints', { throws: true })
      const thrown = await hints(send, agent, browserServers.sites.react18.url('/'), '.save-label')
      expect(thrown.notes).toContain('source not found')

      await send.fault('armHints', { delayMs: 2000 })
      const slow = await hints(send, agent, browserServers.sites.react18.url('/'), '.save-label')
      expect(slow.notes).toContain('source not found')
      expect(listItems(slow.sections['React'])).not.toContain('Source: src/components/ItemRow.tsx:16')
    } finally {
      await send.fault('resetFaults')
    }
  })

  test('025-AC-037 a Ctrl/Cmd+E pick names the component and source and freezes the page after the hints; Up in the menu gives the parent no React lookup while frozen', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    await send.load(browserServers.sites.react18.url('/'))
    const driver = await send.driver()
    // Ctrl/Cmd+E starts picking; with the pointer on the label, Ctrl/Cmd+E again picks it and freezes the page.
    const keyPick = async (): Promise<void> => {
      await driver.key('e', [MOD])
      await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
      await driver.hoverSelector('.save-label', 'span.save-label')
      await driver.key('e', [MOD])
      await expect(send.pick.actions).toBeVisible({ timeout: SEND_WAIT_MS })
      await expect(send.pick.chip).toHaveText(/^span\.save-label · /)
      // The hints were taken before the freeze: the page is frozen with the menu open.
      await expect.poll(async () => (await send.pickState()).frozen, { timeout: SEND_WAIT_MS }).toBe(true)
    }

    await keyPick()
    const picked = parseContextFile((await send.explainAndRead(agent)).context)
    expect(listItems(picked.sections['React'])).toEqual([
      'Component: ItemRow',
      'Owners: ItemList › HomePage › App',
      'Source: src/components/ItemRow.tsx:16'
    ])
    expect(picked.notes).not.toContain('source not found')

    // Again, then Up in the menu: the parent (the button, JSX at ItemRow.tsx:15) has no source attributes and
    // the page is frozen, so its hints say "source not found" and name no React source.
    await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(false)
    await keyPick()
    await send.pick.action('Explain').focus()
    await windowWithTestProject.keyboard.press('ArrowUp')
    await expect(send.pick.chip).toHaveText(/^button\.save-button · /)
    expect((await send.pickState()).frozen).toBe(true)
    const parent = parseContextFile((await send.explainAndRead(agent)).context)
    expect(parent.notes).toContain('source not found')
    expect(listItems(parent.sections['React']).join('\n')).not.toContain('ItemRow.tsx')
  })
})

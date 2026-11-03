// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * React component and source hints in the context file (spec 025,
 * 025-FR-037), on the React 18 and React 19 fixture apps (`apps/react18`,
 * `apps/react19`): development, production and no-source-map builds, the
 * source attributes of `?page=inspector`, and forced hint failures (the pick
 * test hook). Every capture is a real send – pick, **Explain**, the stub agent
 * in the terminal – read back with the shared context-file parser.
 *
 * No title carries 025-AC-037. Not proven here, as the spec words it: React 19
 * names no source file and line (its owner stacks carry none – the React 19
 * source limit the owner may accept); the no-source-map build of React 18
 * still names the source, because React 18's development JSX carries it
 * without a map; the resolved-source exclusions (S-13); and the parent's hints
 * after a Ctrl/Cmd+E pick with no page function run while frozen.
 * Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import { listItems, parseContextFile, type ParsedContextFile } from './fixtures/browser/contextFile.parse'
import { BrowserSendUi, type StubAgent } from './pages/browser-send.page'

const IS_POSIX = process.platform !== 'win32'

async function hints(send: BrowserSendUi, agent: StubAgent, url: string, selector: string): Promise<ParsedContextFile> {
  await send.load(url)
  await send.pickAt(selector)
  return parseContextFile((await send.explainAndRead(agent)).context)
}

test.describe('React hints in the context file', () => {
  test.skip(!IS_POSIX, 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('a React 18 development build names the component, its owners and the source line; React 19 names the component and its owners', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    const react18 = await hints(send, agent, browserServers.sites.react18.url('/'), '.save-label')
    expect(listItems(react18.sections['React'])).toEqual([
      'Component: ItemRow',
      'Owners: ItemList › HomePage › App',
      'Source: src/components/ItemRow.tsx:16'
    ])
    expect(react18.notes).not.toContain('source not found')

    const react19 = await hints(send, agent, browserServers.sites.react19.url('/'), '.save-label')
    const items = listItems(react19.sections['React'])
    expect(items.slice(0, 2)).toEqual(['Component: ItemRow', 'Owners: ItemList › HomePage › App'])
    // Up to 5 owners.
    expect(items[1].split(' › ').length).toBeLessThanOrEqual(5)
  })

  test('a production build says "source not found" and the prompt is sent', async ({ appWithTestProject, windowWithTestProject, browserServers, testProject }) => {
    const send = await BrowserSendUi.open(appWithTestProject, windowWithTestProject, testProject.path)
    const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
    for (const site of ['react18', 'react19'] as const) {
      const parsed = await hints(send, agent, browserServers.sites[site].url('/prod/'), '.save-label')
      expect(parsed.notes, site).toContain('source not found')
      expect(listItems(parsed.sections['React']), site).toContain('Source: unknown')
    }
  })

  test('source attributes are reported first', async ({ appWithTestProject, windowWithTestProject, browserServers, testProject }) => {
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

  test('a hint lookup that throws, or that takes 2 s, never blocks the send: past the 750 ms limit it says "source not found"', async ({
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
})

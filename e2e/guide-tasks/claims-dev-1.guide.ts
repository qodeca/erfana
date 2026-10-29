// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Claim checks for developer docs (docs/user-guide/claims.json, batch dev-1).
 *
 * These claims are counts and repository facts that no single source line can
 * prove: how many tests a unit suite runs, how many specs `e2e/` holds, which
 * baselines are committed, file sizes, and the GitHub-side state that
 * docs/ci.md describes. Each test measures the thing the page states, so a
 * change that makes the page wrong fails here. None of them launch the app.
 *
 * The GitHub-state test reads live settings through the `gh` CLI and needs it
 * installed and signed in; it fails (rather than skips) without it, so a
 * missing proof is never mistaken for a passing one.
 */

import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { test, expect } from '../fixtures'
import { E2E_TEMP_DIR } from '../fixtures/isolation'

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(__dirname, '..', '..')

/** Line count as `wc -l` reports it. */
function lineCount(rel: string): number {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const lines = text.split('\n').length
  return text.endsWith('\n') ? lines - 1 : lines
}

/** Every file under `dir` (repository-relative), recursively. */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}

interface VitestAssertion {
  ancestorTitles: string[]
  status: string
}
interface VitestFileResult {
  name: string
  assertionResults: VitestAssertion[]
}

test.describe('Claims: developer docs (dev-1)', () => {
  test('unit-test counts the docs state match what vitest runs', async () => {
    test.setTimeout(180_000)
    // file -> [expected count, describe block to count within (optional)]
    const expected: Array<[string, number, string?]> = [
      // docs/drag-drop/testing.md
      ['src/main/services/FileService.moveItem.test.ts', 18],
      ['src/main/services/FileService.copyItem.test.ts', 11],
      ['src/renderer/src/components/ProjectTree/ProjectTree.lookup.test.tsx', 15],
      ['src/renderer/src/hooks/useDragDropTree.test.ts', 46],
      ['src/renderer/src/stores/useClipboardStore.test.ts', 21],
      // docs/file-watching/README.md
      ['src/main/services/DirectoryWatcherService.pipeline.test.ts', 26],
      ['src/main/services/DirectoryWatcherService.pipeline.test.ts', 9, '#210 catch-up after a pause'],
      // docs/file-watching/patterns-and-testing.md
      ['src/renderer/src/hooks/useProjectManagement.refreshSingleFlight.test.ts', 21],
      ['src/main/services/DirectoryWatcherService.health.test.ts', 6],
      ['src/main/services/watcher/PauseEpisode.test.ts', 27],
      ['src/main/ipc/file-handlers.test.ts', 20, '#210 watcher catch-up hooks'],
      ['src/shared/coalescingRunner.test.ts', 12],
      ['src/main/services/FileService.readDirectory.singleFlight.test.ts', 14],
      // Windows-only suite: counted on every host, run (not skipped) only on win32
      ['src/main/services/watcher/NativeRecursiveWatcher.win32.test.ts', 9]
    ]
    const files = [...new Set(expected.map(([file]) => file))]
    await fs.promises.mkdir(E2E_TEMP_DIR, { recursive: true })
    const out = path.join(E2E_TEMP_DIR, `claims-dev-1-vitest-${process.pid}.json`)
    try {
      // A failing unit test makes vitest exit non-zero; the counts are still written.
      await execFileAsync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['vitest', 'run', '--reporter=json', `--outputFile=${out}`, ...files],
        { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' }
      ).catch(() => undefined)
      const report = JSON.parse(await fs.promises.readFile(out, 'utf8')) as {
        testResults: VitestFileResult[]
      }
      const byFile = new Map(
        report.testResults.map((r) => [path.relative(ROOT, r.name).split(path.sep).join('/'), r])
      )
      for (const [file, count, block] of expected) {
        const result = byFile.get(file)
        expect(result, `vitest reported no result for ${file}`).toBeDefined()
        const cases = block
          ? result!.assertionResults.filter((a) => a.ancestorTitles.includes(block))
          : result!.assertionResults
        expect(cases.length, `${file}${block ? ` › ${block}` : ''}`).toBe(count)
      }
    } finally {
      await fs.promises.rm(out, { force: true })
    }
  })

  test('e2e/ holds 73 *.e2e.ts specs (docs/testing/README.md)', () => {
    const specs = fs.readdirSync(path.join(ROOT, 'e2e')).filter((f) => f.endsWith('.e2e.ts'))
    expect(specs.length).toBe(73)
  })

  test('both darwin and win32 baselines are committed for all six visual states', () => {
    const suite = fs.readFileSync(path.join(ROOT, 'e2e', 'visual-regression.e2e.ts'), 'utf8')
    const states = [...suite.matchAll(/assertBaselineExists\('([^']+)'/g)].map((m) => m[1])
    expect(new Set(states).size).toBe(6)
    for (const state of states) {
      for (const platform of ['darwin', 'win32']) {
        const baseline = path.join(ROOT, 'e2e', 'screenshots', `${state}-${platform}.png`)
        expect(fs.existsSync(baseline), `${state}-${platform}.png`).toBe(true)
      }
    }
  })

  test('DropIndicator.tsx and FolderDropHighlight.tsx exist but nothing renders them', () => {
    const folder = 'src/renderer/src/components/ProjectTree'
    const components = ['DropIndicator', 'FolderDropHighlight']
    for (const name of components) {
      expect(fs.existsSync(path.join(ROOT, folder, `${name}.tsx`)), `${name}.tsx`).toBe(true)
    }
    const sources = walk('src').filter((f) => /\.(ts|tsx)$/.test(f))
    for (const name of components) {
      const users = sources.filter(
        (f) => f !== `${folder}/${name}.tsx` && fs.readFileSync(path.join(ROOT, f), 'utf8').includes(name)
      )
      expect(users, `files referencing ${name}`).toEqual([])
    }
  })

  test('the project tree context menu has 13 command classes (docs/project-panel.md)', () => {
    const commands = fs.readFileSync(
      path.join(ROOT, 'src/renderer/src/components/ProjectTree/context-menu/commands.tsx'),
      'utf8'
    )
    expect([...commands.matchAll(/^export class \w+Command\b/gm)].length).toBe(13)
  })

  test('file sizes stated in docs/technical-debt.md', () => {
    expect(lineCount('scripts/fuses.js')).toBe(2370)
    expect(lineCount('src/main/services/preview/previewLiveVisibility.ts')).toBe(342)
    expect(lineCount('src/main/services/preview/previewLiveWiring.ts')).toBe(434)
  })

  test('GitHub-side CI state stated in docs/ci.md', async () => {
    test.setTimeout(60_000)
    const gh = async (args: string[]): Promise<string> =>
      (await execFileAsync('gh', args, { cwd: ROOT })).stdout.trim()
    const repo = 'qodeca/erfana'

    // "on the `develop` merge queue"
    const queue = JSON.parse(
      await gh([
        'api',
        'graphql',
        '-f',
        `query={repository(owner:"qodeca",name:"erfana"){mergeQueue(branch:"develop"){url}}}`
      ])
    ) as { data: { repository: { mergeQueue: { url: string } | null } } }
    expect(queue.data.repository.mergeQueue?.url).toBe('https://github.com/qodeca/erfana/queue/develop')

    const required = async (branch: string): Promise<string[]> =>
      JSON.parse(
        await gh(['api', `repos/${repo}/branches/${branch}/protection/required_status_checks`, '--jq', '.contexts'])
      ) as string[]
    const seven = ['Build', 'Coverage', 'License compliance', 'Lint', 'Secret scan', 'Typecheck', 'Unit tests']
    for (const branch of ['main', 'develop']) {
      const contexts = await required(branch)
      // "Secret Scan … active (**required check**)" and "`lint` (Lint)" as a required check
      expect([...contexts].sort(), `${branch} required checks`).toEqual(seven)
      // "E2E (Linux, xvfb) … (advisory, never required)"
      expect(contexts).not.toContain('E2E (Linux, xvfb)')
    }

    const workflows = JSON.parse(
      await gh(['workflow', 'list', '--all', '-R', repo, '--json', 'name,state'])
    ) as Array<{ name: string; state: string }>
    const state = (name: string): string | undefined => workflows.find((w) => w.name === name)?.state
    expect(state('Secret Scan')).toBe('active')
    expect(state('E2E Tests')).toBe('disabled_manually')
    expect(state('E2E (Linux, xvfb)')).toBe('active')

    // "both build legs sit behind the `production-signing` environment approval"
    const rules = JSON.parse(
      await gh(['api', `repos/${repo}/environments/production-signing`, '--jq', '[.protection_rules[].type]'])
    ) as string[]
    expect(rules).toContain('required_reviewers')
  })
})

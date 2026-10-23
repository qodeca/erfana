// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E guard: an Office import runs LibreOffice headless, with no window.
 *
 * The conversion itself happens inside LiteParse's native code, which starts
 * `soffice` on its own, so no unit test can see its arguments. This test
 * imports a real .docx and watches every LibreOffice process that appears
 * while the import runs:
 *   - each one must carry `--headless` on its command line;
 *   - on Windows, none may own a visible window.
 * A LiteParse update that drops headless mode turns this test red.
 *
 * Skipped when LibreOffice is not installed (the import needs it). Local gate
 * only: e2e is disabled in CI. Condition-based waits only.
 *
 * @see e2e/document-import.e2e.ts - the PDF import flow this test reuses
 * @see src/main/services/import/DependencyDetector.ts - the app's own probe (unit-tested for --headless)
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import yazl from 'yazl'
import { stubDialog } from 'electron-playwright-helpers'
import {
  TEST_IDS,
  byTestId,
  waitForTestId,
  waitForAppReady,
  openProject,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'

const execFileAsync = promisify(execFile)

/** Where LibreOffice installs by default; the test is skipped when none exists. */
const LIBREOFFICE_PATHS: Record<string, string[]> = {
  win32: ['C:\\Program Files\\LibreOffice\\program\\soffice.exe'],
  darwin: ['/Applications/LibreOffice.app/Contents/MacOS/soffice'],
  linux: ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/lib/libreoffice/program/soffice']
}
const hasLibreOffice = (LIBREOFFICE_PATHS[process.platform] ?? []).some((p) => fs.existsSync(p))

/** One LibreOffice process seen while the import ran. */
interface SofficeProcess {
  pid: number
  commandLine: string
  /** Windows only: the process owned a visible top-level window. */
  visibleWindow: boolean
}

/** The LibreOffice processes running right now. */
async function listSoffice(): Promise<SofficeProcess[]> {
  if (process.platform === 'win32') {
    // MainWindowHandle is non-zero only for a process with a visible top-level window
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name like 'soffice%'\" | ForEach-Object { " +
      '$p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; ' +
      '"$($_.ProcessId)`t$([int64]$p.MainWindowHandle)`t$($_.CommandLine)" }'
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true
    })
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [pid, handle, ...rest] = line.split('\t')
        return { pid: Number(pid), visibleWindow: Number(handle) !== 0, commandLine: rest.join('\t') }
      })
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='])
  return stdout
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null && /soffice|libreoffice/i.test(m[2]) && !/\bps\b/.test(m[2]))
    .map((m) => ({ pid: Number(m[1]), commandLine: m[2], visibleWindow: false }))
}

/** A minimal Word document (three parts, no styles) that LibreOffice converts. */
async function writeDocx(file: string): Promise<void> {
  const zip = new yazl.ZipFile()
  zip.addBuffer(
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '[Content_Types].xml'
  )
  zip.addBuffer(
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    '_rels/.rels'
  )
  zip.addBuffer(
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>Headless guard</w:t></w:r></w:p></w:body></w:document>'
    ),
    'word/document.xml'
  )
  zip.end()
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(fs.createWriteStream(file)).on('close', resolve).on('error', reject)
  })
}

test.describe('Document import – LibreOffice runs headless', () => {
  test.describe.configure({ retries: 0 })
  test.skip(!hasLibreOffice, 'LibreOffice is not installed')

  test('a .docx import starts LibreOffice only with --headless and no visible window', async () => {
    // ~15 s launch + up to 60 s conversion + dialog flow
    test.setTimeout(120_000)

    const docDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erfana-headless-'))
    const docx = path.join(docDir, 'headless-guard.docx')
    await writeDocx(docx)

    const { projectPath, cleanup: cleanupProject } = await createTestProject({ 'test.md': '# Test\n' })
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir('document-import-headless')
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'development' }
    })
    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    // LibreOffice processes already running (the user's own) are not ours to judge
    const preExisting = new Set((await listSoffice()).map((p) => p.pid))
    const seen = new Map<number, SofficeProcess>()
    let polling = true
    const poller = (async () => {
      while (polling) {
        for (const p of await listSoffice().catch(() => [])) {
          if (preExisting.has(p.pid)) continue
          const known = seen.get(p.pid)
          seen.set(p.pid, { ...p, visibleWindow: p.visibleWindow || (known?.visibleWindow ?? false) })
        }
      }
    })()

    try {
      window = await electronApp.firstWindow()
      await waitForAppReady(window)
      await openProject(window, projectPath)
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      await stubDialog(electronApp, 'showOpenDialog', { filePaths: [docx], canceled: false })
      await byTestId(window, TEST_IDS.WELCOME_BTN_IMPORT).click()
      const dialog = byTestId(window, TEST_IDS.DOCUMENT_IMPORT_DIALOG)
      await waitForTestId(window, TEST_IDS.DOCUMENT_IMPORT_DIALOG, { timeout: 15000 })
      await expect(dialog).toContainText('headless-guard.docx')

      await byTestId(window, TEST_IDS.DOCUMENT_IMPORT_BTN_START).click()
      await expect(dialog.locator('.doc-import-success-message')).toHaveText('Import complete', { timeout: 60000 })
    } finally {
      polling = false
      await poller
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
      fs.rmSync(docDir, { recursive: true, force: true })
    }

    const processes = [...seen.values()]
    test.info().annotations.push({ type: 'soffice-processes', description: JSON.stringify(processes) })
    expect(processes.length, 'the import should have started LibreOffice at least once').toBeGreaterThan(0)
    expect(
      processes.filter((p) => !/(^|\s|")--headless(\s|"|$)/.test(p.commandLine)),
      'every LibreOffice process should run with --headless'
    ).toEqual([])
    expect(
      processes.filter((p) => p.visibleWindow),
      'no LibreOffice process should own a visible window'
    ).toEqual([])
  })
})

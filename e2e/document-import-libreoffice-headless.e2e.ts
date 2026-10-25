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
 * Negative control: run with `E2E_SOFFICE_NEGATIVE_CONTROL=1` and the test also
 * starts its own LibreOffice WITHOUT `--headless` (with `--invisible`, so no
 * window opens, and a throw-away profile, so it never joins a LibreOffice the
 * user has open). In that mode the test checks its own result: it passes only
 * if the control's command line (found by its profile path) is flagged as
 * running without `--headless` and nothing else is flagged – proof that the
 * check catches a real offender.
 *
 * @see e2e/document-import.e2e.ts - the PDF import flow this test reuses
 * @see src/main/services/import/DependencyDetector.ts - the app's own probe (unit-tested for --headless)
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { execFile, spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { promisify } from 'util'
import yazl from 'yazl'
import { stubDialog } from 'electron-playwright-helpers'
import { E2E_CHROMIUM_ARGS } from './fixtures/isolation'
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
const libreOfficeBinary = (LIBREOFFICE_PATHS[process.platform] ?? []).find((p) => fs.existsSync(p))
const hasLibreOffice = libreOfficeBinary !== undefined

/** See the file header: also start a non-headless LibreOffice, so the test must fail. */
const NEGATIVE_CONTROL = process.env.E2E_SOFFICE_NEGATIVE_CONTROL === '1'

/**
 * A live pid seen only as `(soffice)` – never with its arguments – in at least
 * this many snapshots AND across at least this long fails the test. See
 * `evaluate` for why.
 */
const NAME_ONLY_LIMIT_SIGHTINGS = 3
const NAME_ONLY_LIMIT_MS = 5_000

/** One LibreOffice process in one `ps` (or CIM) snapshot. */
interface SofficeSighting {
  pid: number
  /** Process start time (`ps` lstart on POSIX, CIM CreationDate ticks on Windows). */
  startedAt: string
  commandLine: string
  /**
   * macOS/Linux: `ps` printed only the process name in brackets – `(soffice)` on
   * macOS, `[soffice.bin]` on Linux – because the arguments could not be read.
   * That happens between fork and the end of exec, and again once the process
   * has exited (zombie). Always false on Windows.
   */
  nameOnly: boolean
  /** macOS/Linux: the process has exited and waits to be reaped (`ps` state Z). */
  zombie: boolean
  /** Windows only: the process owned a visible top-level window. */
  visibleWindow: boolean
}

/** Everything seen of one LibreOffice pid across all snapshots. */
interface SofficeRecord {
  pid: number
  /**
   * Every distinct full command line the pid showed. More than one when the pid
   * exec'd again (Linux: the `soffice` shell script execs `oosplash`); each one
   * is checked for `--headless`.
   */
  commandLines: string[]
  /** The bracketed name, when one was seen. */
  nameOnlyLabel?: string
  /** Snapshots in which the live (not zombie) pid showed only its name. */
  nameOnlySightings: number
  /** When the live pid was first and last seen by name only (ms since epoch). */
  firstNameOnlyAt?: number
  lastNameOnlyAt?: number
  visibleWindow: boolean
}

/**
 * The executable is soffice, soffice.bin, oosplash (Linux launcher) or
 * libreoffice – as a path (`.../soffice`) or a bare name at the start of the
 * line. A process that merely has the word in its arguments (an editor, `grep`)
 * does not match.
 */
const SOFFICE_COMMAND = /(^|\/)(soffice(\.bin)?|oosplash|libreoffice)(\s|$)/
/** `ps` showing only the name: `(soffice)` on macOS, `[soffice.bin]` or `[soffice.bin] <defunct>` on Linux. */
const SOFFICE_NAME_ONLY = /^[([](soffice(\.bin)?|oosplash|libreoffice)[)\]]( <defunct>)?$/

/** A hung listing must not block the test or its cleanup. */
const LISTING_TIMEOUT_MS = 10_000

/** `ps` `lstart` in the C locale: `Sun Oct 18 08:54:24 2026`. */
const PS_LINE = /^(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.*)$/

/** The LibreOffice processes running right now. */
async function listSoffice(): Promise<SofficeSighting[]> {
  if (process.platform === 'win32') {
    // MainWindowHandle is non-zero only for a process with a visible top-level window
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name like 'soffice%'\" | ForEach-Object { " +
      '$p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; ' +
      '"$($_.ProcessId)`t$($_.CreationDate.Ticks)`t$([int64]$p.MainWindowHandle)`t$($_.CommandLine)" }'
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      timeout: LISTING_TIMEOUT_MS
    })
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [pid, created, handle, ...rest] = line.split('\t')
        return {
          pid: Number(pid),
          startedAt: created,
          visibleWindow: Number(handle) !== 0,
          commandLine: rest.join('\t'),
          nameOnly: false,
          zombie: false
        }
      })
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,stat=,lstart=,command='], {
    timeout: LISTING_TIMEOUT_MS,
    // A fixed lstart format, whatever the user's locale
    env: { ...process.env, LC_ALL: 'C' }
  })
  const sightings: SofficeSighting[] = []
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(PS_LINE)
    if (!m) continue
    const [, pid, stat, startedAt, commandLine] = m
    const nameOnly = SOFFICE_NAME_ONLY.test(commandLine)
    if (!nameOnly && !SOFFICE_COMMAND.test(commandLine)) continue
    sightings.push({
      pid: Number(pid),
      startedAt: startedAt.replace(/\s+/g, ' '),
      commandLine,
      nameOnly,
      zombie: stat.startsWith('Z'),
      visibleWindow: false
    })
  }
  return sightings
}

/** Identifies one process: a pid alone could be reused by a later process. */
const processKey = (s: SofficeSighting): string => `${s.pid}@${s.startedAt}`

/** Fold one snapshot's sighting into the per-pid record. */
function recordSighting(seen: Map<number, SofficeRecord>, s: SofficeSighting, at: number): void {
  let r = seen.get(s.pid)
  if (!r) {
    r = { pid: s.pid, commandLines: [], nameOnlySightings: 0, visibleWindow: false }
    seen.set(s.pid, r)
  }
  r.visibleWindow ||= s.visibleWindow
  if (!s.nameOnly) {
    // A full command line always counts; a name-only sighting never overwrites it
    if (!r.commandLines.includes(s.commandLine)) r.commandLines.push(s.commandLine)
    return
  }
  r.nameOnlyLabel = s.commandLine
  // An exited (zombie) process has lost its arguments for good – not a sign that
  // it ran unseen, so it does not count towards the limit
  if (s.zombie) return
  r.nameOnlySightings++
  r.firstNameOnlyAt ??= at
  r.lastNameOnlyAt = at
}

/** How long a live pid was seen showing only its name. */
const nameOnlySpanMs = (r: SofficeRecord): number =>
  (r.lastNameOnlyAt ?? 0) - (r.firstNameOnlyAt ?? 0)

/**
 * Sort the records into: checked (a full command line was seen), transient
 * (only ever seen by name, briefly) and unverified (only ever seen by name,
 * while alive, in `NAME_ONLY_LIMIT_SIGHTINGS`+ snapshots spanning
 * `NAME_ONLY_LIMIT_MS`+).
 *
 * The rule: on macOS a just-started `soffice` shows as `(soffice)` until exec
 * of the signed app bundle completes. In local runs that window covered one or
 * two back-to-back `ps` snapshots – once 1.3 s apart, on a loaded machine where
 * one `ps` call alone took that long – before the full command line appeared.
 *   - 3 snapshots: a window shorter than one `ps` call can straddle at most
 *     two snapshots, however slow `ps` is. A third means the pid outlived a
 *     whole snapshot without showing its arguments.
 *   - 5 s: with a fast `ps` three snapshots take only tens of ms, so the count
 *     alone would flag a slow exec. LibreOffice doing real work – the LiteParse
 *     conversion, or a non-headless instance that stays up – is seen with its
 *     arguments long before 5 s.
 * A live pid past both limits ran long enough to be checked and was not – it
 * could be a non-headless LibreOffice, so it fails the test rather than being
 * dropped. A name-only pid that is still alive, and still name-only, in the
 * final snapshot (taken after the import completed) also fails: it was not
 * "gone", so the transient allowance does not apply. A pid seen by name only
 * below both limits and then gone (it exited, or exec'd into something that is
 * not LibreOffice) is logged as an annotation and allowed: there was no command
 * line to check.
 */
function evaluate(
  seen: Map<number, SofficeRecord>,
  nameOnlyAtEnd: Set<number>
): {
  checked: SofficeRecord[]
  transient: SofficeRecord[]
  unverified: SofficeRecord[]
  stillNameOnlyAtEnd: SofficeRecord[]
} {
  const pastLimits = (r: SofficeRecord): boolean =>
    r.nameOnlySightings >= NAME_ONLY_LIMIT_SIGHTINGS && nameOnlySpanMs(r) >= NAME_ONLY_LIMIT_MS
  const records = [...seen.values()]
  const nameOnly = records.filter(r => r.commandLines.length === 0)
  const atEnd = (r: SofficeRecord): boolean => nameOnlyAtEnd.has(r.pid)
  return {
    checked: records.filter(r => r.commandLines.length > 0),
    transient: nameOnly.filter(r => !pastLimits(r) && !atEnd(r)),
    unverified: nameOnly.filter(pastLimits),
    stillNameOnlyAtEnd: nameOnly.filter(r => !pastLimits(r) && atEnd(r))
  }
}

/** Matches `--headless` as a whole argument, bare or quoted (Windows CIM quotes arguments). */
const HEADLESS_FLAG = /(^|\s|")--headless(\s|"|$)/

/**
 * Negative control only: start LibreOffice without `--headless`. `--invisible`
 * keeps it windowless and the fresh profile makes it its own instance, so it
 * never hands off to – or disturbs – a LibreOffice the user has open.
 */
function startNonHeadlessSoffice(profileDir: string): ChildProcess {
  return spawn(
    libreOfficeBinary as string,
    ['--invisible', '--norestore', `-env:UserInstallation=${pathToFileURL(profileDir).href}`],
    // detached: its own process group, so stopNonHeadlessSoffice reaches any child it starts
    { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true }
  )
}

/** How long the negative-control LibreOffice gets to exit on SIGTERM before SIGKILL. */
const CONTROL_EXIT_GRACE_MS = 5_000

/** Signal the control's whole process group; a group already gone (ESRCH) is fine. */
function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err
  }
}

/**
 * Stop the negative-control LibreOffice – only the process (group) this test
 * started. The group is signalled even when the leader has already exited, so
 * a child it left behind is still reached.
 */
async function stopNonHeadlessSoffice(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    try {
      // /T: the launcher and the soffice.bin it started – this test's tree only
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: LISTING_TIMEOUT_MS
      })
    } catch {
      // already gone
    }
    return
  }
  const leaderGone = child.exitCode !== null || child.signalCode !== null
  const exited = leaderGone
    ? Promise.resolve(true)
    : new Promise<boolean>(resolve => child.once('exit', () => resolve(true)))
  signalGroup(pid, 'SIGTERM')
  let timer: NodeJS.Timeout | undefined
  // Not a fixed delay: resolves as soon as the leader exits, the timer only bounds it
  const grace = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), CONTROL_EXIT_GRACE_MS)
  })
  await Promise.race([exited, grace])
  clearTimeout(timer)
  // Always: reaches a leader that ignored SIGTERM and any child left in the group
  signalGroup(pid, 'SIGKILL')
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
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`, ...E2E_CHROMIUM_ARGS],
      env: { ...process.env, NODE_ENV: 'development' }
    })
    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    const seen = new Map<number, SofficeRecord>()
    let polling = true
    let poller: Promise<void> | undefined
    /** Pids still alive and name-only in the last snapshot; undefined if it could not be taken. */
    let nameOnlyAtEnd: Set<number> | undefined
    let controlProfile: string | undefined
    let controlMarker: string | undefined
    let control: ChildProcess | undefined
    let preExisting: Set<string> | undefined
    /** One snapshot, folded into `seen`; the processes in the baseline are skipped. */
    const take = async (baseline: Set<string>): Promise<SofficeSighting[]> => {
      const snapshot = (await listSoffice()).filter(s => !baseline.has(processKey(s)))
      const at = Date.now()
      for (const s of snapshot) recordSighting(seen, s, at)
      return snapshot
    }
    try {
      // LibreOffice processes already running (the user's own) are not ours to judge.
      // Keyed on pid + start time, so a process that reuses one of their pids is still judged.
      const baseline = new Set((await listSoffice()).map(processKey))
      preExisting = baseline
      poller = (async () => {
        while (polling) await take(baseline).catch(() => [])
      })()

      if (NEGATIVE_CONTROL) {
        controlProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'erfana-headless-control-'))
        const marker = pathToFileURL(controlProfile).href
        controlMarker = marker
        control = startNonHeadlessSoffice(controlProfile)
        // Wait until the poller has its full command line, so the check below has it to judge
        await expect
          .poll(() => [...seen.values()].some(r => r.commandLines.some(c => c.includes(marker))), {
            message: 'the negative-control LibreOffice should be seen with its arguments',
            timeout: 30_000
          })
          .toBe(true)
      }

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
      // Each step on its own, so one failing step never skips the rest – closeApp always runs
      const step = async (name: string, run: () => unknown): Promise<void> => {
        try {
          await run()
        } catch (err) {
          console.warn(`[headless-guard] cleanup step "${name}" failed:`, err)
        }
      }
      await step('stop poller', async () => {
        polling = false
        await poller
      })
      // The final snapshot: after "Import complete" (or a failure), before anything is stopped
      await step('final snapshot', async () => {
        if (!preExisting) return
        const last = await take(preExisting)
        nameOnlyAtEnd = new Set(last.filter(s => s.nameOnly && !s.zombie).map(s => s.pid))
      })
      await step('stop negative control', () => control && stopNonHeadlessSoffice(control))
      await step('remove control profile', () => {
        if (controlProfile) fs.rmSync(controlProfile, { recursive: true, force: true, maxRetries: 3 })
      })
      await step('close app', () => closeApp(electronApp, window))
      await step('remove project', () => cleanupProject())
      await step('remove user data', () => cleanupUserData())
      await step('remove document', () =>
        fs.rmSync(docDir, { recursive: true, force: true, maxRetries: 3 })
      )
    }

    expect(nameOnlyAtEnd, 'the final process snapshot should have been taken').toBeDefined()
    const { checked, transient, unverified, stillNameOnlyAtEnd } = evaluate(
      seen,
      nameOnlyAtEnd ?? new Set()
    )
    test
      .info()
      .annotations.push({ type: 'soffice-processes', description: JSON.stringify(checked) })
    if (transient.length > 0) {
      // Seen only by name, briefly, then gone: no command line existed to check
      test.info().annotations.push({
        type: 'soffice-name-only-transient',
        description: JSON.stringify(transient)
      })
    }
    expect(
      checked.length,
      'the import should have started LibreOffice at least once'
    ).toBeGreaterThan(0)
    expect(
      unverified,
      `a LibreOffice process was seen ${NAME_ONLY_LIMIT_SIGHTINGS}+ times over ${NAME_ONLY_LIMIT_MS} ms+ ` +
        'without ever showing its command line, so --headless could not be checked'
    ).toEqual([])
    expect(
      stillNameOnlyAtEnd,
      'a LibreOffice process was still running at the end without ever showing its command line, ' +
        'so --headless could not be checked'
    ).toEqual([])
    const withoutHeadless = checked
      .map(r => ({
        pid: r.pid,
        withoutHeadless: r.commandLines.filter(c => !HEADLESS_FLAG.test(c))
      }))
      .filter(r => r.withoutHeadless.length > 0)
    const isControl = (r: { withoutHeadless: string[] }): boolean =>
      controlMarker !== undefined && r.withoutHeadless.some(c => c.includes(controlMarker as string))
    if (NEGATIVE_CONTROL) {
      // The check must catch the control: its own non-headless command line is flagged.
      // Counted by profile, not by process: on Windows the control is two processes
      // (the soffice.exe launcher and its soffice.bin child), both with the same profile.
      const flaggedProfiles = new Set(
        withoutHeadless
          .filter(isControl)
          .flatMap(r => r.withoutHeadless)
          .map(c => c.match(/-env:UserInstallation=([^\s"]+)/)?.[1])
          .filter((p): p is string => p !== undefined)
      )
      expect(
        [...flaggedProfiles],
        'the negative-control LibreOffice (one profile, one or more processes) should be ' +
          'flagged as running without --headless'
      ).toEqual([controlMarker])
    }
    // Nothing else may be flagged – in a normal run, nothing at all
    expect(
      withoutHeadless.filter(r => !isControl(r)),
      'every LibreOffice process should run with --headless'
    ).toEqual([])
    expect(
      checked.filter(r => r.visibleWindow),
      'no LibreOffice process should own a visible window'
    ).toEqual([])
  })
})

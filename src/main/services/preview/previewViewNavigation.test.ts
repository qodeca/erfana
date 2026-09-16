// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page a view opens on (issue #124, `previewViewNavigation.ts`).
 *
 * A first open, and the fallback a resume takes when main's page fails the
 * gate, are located like a move: loaded at the real path, so the URL lands
 * inside the real root, and named in project space. Without it a project
 * reached through a symlinked folder answered 404 on its first page.
 *
 * The fallback is also JUDGED (QG-7 item 11): the tab was made before the
 * suspend, so a page that is no `.html`, one the eligibility check refuses or
 * cannot answer for, and one that cannot be judged at all open nothing. The
 * gate itself is covered through `preview:navigate` in
 * `src/main/ipc/preview/navigation-handlers.test.ts`.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import type { PreviewPageTarget } from '../../../shared/ipc/preview-types'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import type { PreviewEligibilityCheck } from './previewLiveTypes'
import { createPreviewPanelState } from './previewPanelState'
import type { ConfineVerdict, confinePath } from './previewPathResolve'
import { createTabHistory, pushEntry } from './previewTabHistory'
import { buildPreviewUrl } from './previewUrl'
import {
  createPreviewViewNavigation,
  type PreviewStartingPage,
  type PreviewStartingPageResult
} from './previewViewNavigation'

vi.mock('../LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

const TOKEN = '0123456789abcdef0123456789abcdef' // gitleaks:allow
const PANEL = 'panel-A'
/** The project as the user opened it – through a link – and the folder it resolves to. */
const LINKED = join('/', 'links', 'site')
const REAL = join('/', 'real', 'site')

/** The page a start opened on; a refusal (QG-7 item 11) fails the test here. */
function opened(started: PreviewStartingPageResult): PreviewStartingPage {
  if (!started.ok) {
    throw new Error(`the gate refused the opening page: ${started.errorCode}`)
  }
  return started
}

const at = (filePath: string, anchor: string | null = null): PreviewPageTarget => ({
  filePath,
  anchor
})
const found = (rel: string): ConfineVerdict => ({ ok: true, realTarget: join(REAL, rel), rel })

/** What `confinePath` answers for the project at `LINKED`; anything else is missing. */
const PAGES: Readonly<Record<string, ConfineVerdict>> = {
  [join(LINKED, 'a.html')]: found('a.html'),
  [join(REAL, 'a.html')]: found('a.html'),
  [join(LINKED, 'b.html')]: found('b.html'),
  [join(LINKED, 'notes.md')]: found('notes.md'),
  [join(LINKED, 'escape.html')]: { ok: false, reason: 'escape' }
}

function makeNavigation(
  options: { confine?: typeof confinePath; eligible?: boolean; check?: false } = {}
) {
  const panelState = createPreviewPanelState()
  const confine =
    options.confine ??
    vi.fn(
      async (_realRoot: string, candidate: string): Promise<ConfineVerdict> =>
        PAGES[candidate] ?? { ok: false, reason: 'missing' }
    )
  const check = vi.fn<PreviewEligibilityCheck>(async () =>
    options.eligible === false
      ? { eligible: false, reason: 'globally-disabled' }
      : { eligible: true }
  )
  const navigation = createPreviewViewNavigation({
    registry: { entry: () => null },
    panelState,
    checkEligibility: () => (options.check === false ? undefined : check),
    confine
  })
  const start = (filePath: string) =>
    navigation.startingPage({ panelId: PANEL, filePath }, REAL, LINKED)
  const open = async (filePath: string): Promise<PreviewStartingPage> =>
    opened(await start(filePath))
  return { panelState, confine, check, open, start }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the first open of a project reached through a symlinked folder', () => {
  it('loads the page at its real path, so its URL is inside the real root, and names it in project space', async () => {
    const nav = makeNavigation()

    const start = await nav.open(join(LINKED, 'a.html'))

    expect(nav.confine).toHaveBeenCalledWith(REAL, join(LINKED, 'a.html'))
    expect(start.filePath).toBe(join(REAL, 'a.html'))
    expect(buildPreviewUrl(TOKEN, REAL, start.filePath)).toBe(`erfana-preview://${TOKEN}/a.html`)
    expect(start.navigation.initialHistory).toEqual(createTabHistory(at(join(LINKED, 'a.html')), 0))
    expect(start.navigation.initialSameDocument).toBe(true)
  })

  it('names a page sent through the real folder in project space, as a move does', async () => {
    const start = await makeNavigation().open(join(REAL, 'a.html'))

    expect(start.filePath).toBe(join(REAL, 'a.html'))
    expect(start.navigation.initialHistory).toEqual(createTabHistory(at(join(LINKED, 'a.html')), 0))
  })

  it('checks no page type and no eligibility, as no first open ever has', async () => {
    const nav = makeNavigation({ eligible: false })

    const start = await nav.open(join(LINKED, 'notes.md'))

    expect(start.filePath).toBe(join(REAL, 'notes.md'))
    expect(nav.check).not.toHaveBeenCalled()
  })

  it.each([
    ['a page that is gone', join(LINKED, 'gone.html')],
    ['a page outside the project', join(LINKED, 'escape.html')],
    ['a relative path', 'a.html']
  ])('keeps the path the renderer sent for %s', async (_label, sent) => {
    const start = await makeNavigation().open(sent)

    expect(start.filePath).toBe(sent)
    expect(start.navigation.initialHistory).toEqual(createTabHistory(at(sent), 0))
    expect(start.navigation.initialSameDocument).toBe(true)
  })

  it('keeps the path the renderer sent when locating throws, and logs only the error name', async () => {
    const sent = join(LINKED, 'a.html')
    const nav = makeNavigation({
      confine: async () => {
        throw new Error(`EIO ${sent}`)
      }
    })

    const start = await nav.open(sent)

    expect(start.filePath).toBe(sent)
    expect(logger.warn).toHaveBeenCalledWith(
      'Preview open: locating the page failed; loading it as sent',
      { panelId: stablePathDigest(PANEL), error: 'Error' }
    )
  })
})

describe("the fallback a resume takes when main's page fails the gate", () => {
  it("opens the tab's own page, one generation on, at its real path and named in project space", async () => {
    const nav = makeNavigation()
    const prior = pushEntry(
      createTabHistory(at(join(LINKED, 'a.html'))),
      at(join(LINKED, 'gone.html'))
    )
    nav.panelState.setHistory(PANEL, prior)

    const start = await nav.open(join(LINKED, 'a.html'))

    expect(start.filePath).toBe(join(REAL, 'a.html'))
    expect(buildPreviewUrl(TOKEN, REAL, start.filePath)).toBe(`erfana-preview://${TOKEN}/a.html`)
    expect(start.navigation.initialHistory).toEqual(
      createTabHistory(at(join(LINKED, 'a.html')), prior.generation + 1)
    )
    expect(start.navigation.initialSameDocument).toBe(true)
  })

  it("gates the tab's own page too, so an ineligible one opens nothing (QG-7 item 11)", async () => {
    const nav = makeNavigation({ eligible: false })
    nav.panelState.setHistory(
      PANEL,
      pushEntry(createTabHistory(at(join(LINKED, 'a.html'))), at(join(LINKED, 'b.html')))
    )

    expect(await nav.start(join(LINKED, 'a.html'))).toEqual({
      ok: false,
      errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED
    })
    expect(nav.check).toHaveBeenCalledWith(join(LINKED, 'b.html'), LINKED)
    expect(nav.check).toHaveBeenCalledWith(join(LINKED, 'a.html'), LINKED)
  })

  it("opens nothing when the tab's own page is no .html", async () => {
    const nav = makeNavigation()
    nav.panelState.setHistory(
      PANEL,
      pushEntry(createTabHistory(at(join(LINKED, 'a.html'))), at(join(LINKED, 'gone.html')))
    )

    expect(await nav.start(join(LINKED, 'notes.md'))).toEqual({
      ok: false,
      errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED
    })
  })

  it('opens nothing when there is no eligibility check: the gate fails closed', async () => {
    const nav = makeNavigation({ check: false })
    nav.panelState.setHistory(
      PANEL,
      pushEntry(createTabHistory(at(join(LINKED, 'a.html'))), at(join(LINKED, 'b.html')))
    )

    expect(await nav.start(join(LINKED, 'a.html'))).toEqual({
      ok: false,
      errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED
    })
  })

  it('opens nothing when the gate itself throws, and logs the error name alone', async () => {
    const sent = join(LINKED, 'a.html')
    const nav = makeNavigation({
      confine: async () => {
        throw new Error(`EIO ${sent}`)
      }
    })
    nav.panelState.setHistory(
      PANEL,
      pushEntry(createTabHistory(at(sent)), at(join(LINKED, 'b.html')))
    )

    expect(await nav.start(sent)).toEqual({
      ok: false,
      errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE
    })
    expect(logger.warn).toHaveBeenCalledWith('Preview resume: the gate failed', {
      panelId: stablePathDigest(PANEL),
      error: 'Error'
    })
    // The page is named nowhere in the trail: not by path, not by panel id.
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(LINKED)
  })
})

describe('the first open of a project opened at its real path', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-open-')))
    writeFileSync(join(root, 'a.html'), '<p>a</p>')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('is unchanged: the page loads at the path the renderer sent, under that name', async () => {
    const navigation = createPreviewViewNavigation({
      registry: { entry: () => null },
      panelState: createPreviewPanelState(),
      checkEligibility: () => undefined
    })
    const sent = join(root, 'a.html')

    const start = opened(
      await navigation.startingPage({ panelId: PANEL, filePath: sent }, root, root)
    )

    expect(start.filePath).toBe(sent)
    expect(buildPreviewUrl(TOKEN, root, start.filePath)).toBe(`erfana-preview://${TOKEN}/a.html`)
    expect(start.navigation.initialHistory).toEqual(createTabHistory(at(sent), 0))
    expect(start.navigation.initialSameDocument).toBe(true)
  })
})

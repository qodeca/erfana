// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: camera preview mirroring, framing and Enter-to-capture (#42).
 *
 * Covers the three parts of the fix that no unit test can prove:
 *  - the preview is un-mirrored by DEFAULT and mirrors only when the user
 *    switches the per-camera toggle on;
 *  - the preview box is 16:9 with `object-fit: contain`, so the whole captured
 *    frame is visible (jsdom does not lay out `object-fit`, so this is only
 *    assertable in a real browser);
 *  - Enter on the focused Capture button takes a photo, which after the
 *    Enter-on-Cancel fix rests entirely on NATIVE button activation — a
 *    behaviour jsdom does not implement at all.
 *
 * Runs against Chromium's fake capture device, and asserts that it really is
 * the fake device streaming — otherwise the test could silently pass against a
 * real webcam (or hang on an OS permission prompt).
 */

import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, expect } from './fixtures/index'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { CAMERA } from '../src/shared/constants'
import { byTestId } from './utils/locators'
import { TerminalPage } from './pages/terminal.page'

/** Escape a literal for embedding in a `RegExp` source. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `CameraService.formatFilename()` — `<TEMP_PREFIX>YYYY-MM-DD-HHMMSS<EXT>`,
 * written to `os.tmpdir()`.
 *
 * Built from the SHARED constants the main process formats with, not from a
 * hand-copied string: a hardcoded pattern silently stops matching if the prefix
 * changes, which would turn the assertion below into a false failure and, worse,
 * leave the cleanup unable to find what it created. Matched rather than
 * wildcarded so that cleanup can never delete a file this spec did not produce.
 */
const CAPTURED_PHOTO = new RegExp(
  `^${escapeRegExp(CAMERA.TEMP_PREFIX)}\\d{4}-\\d{2}-\\d{2}-\\d{6}${escapeRegExp(
    CAMERA.FILE_EXTENSION
  )}$`
)

/**
 * Names of the capture files already sitting in a directory.
 *
 * Returns an empty set instead of throwing when the directory is unreadable:
 * this feeds cleanup, and a cleanup problem must never masquerade as a
 * behavioural failure.
 *
 * @param dir - Directory to list
 * @returns Set of matching file names (not paths)
 */
async function listCapturedPhotos(dir: string): Promise<Set<string>> {
  try {
    return new Set((await readdir(dir)).filter((name) => CAPTURED_PHOTO.test(name)))
  } catch (e) {
    console.warn('[camera-mirror] could not list', dir, e)
    return new Set()
  }
}

// `resetRendererStorage` wipes `<userDataDir>/Local Storage` BEFORE Electron
// launches, which is the only point at which a reset can work.
//
// Clearing `localStorage` from inside the running page — the obvious approach,
// and what this spec did first — cannot: `CameraDialog` is a static import from
// `TerminalPanel`, so `useCameraMirrorStore` is created at page load, and
// zustand's `persist` with synchronous storage HYDRATES AT STORE CREATION. By
// the time a `beforeEach` runs, the in-memory map is already populated, and
// removing the key leaves it untouched. MEASURED, not assumed: with the old
// in-page `removeItem`, a second test in the same worker read the key back as
// `null` and still found `.camera-preview--mirrored` on the preview. With the
// pre-launch wipe, the same probe reports the preview un-mirrored.
//
// The wipe is per-LAUNCH, not once per file, because `userDataDir` is
// WORKER-scoped while the app fixture is TEST-scoped: this spec's own toggle-ON
// is on disk for every later test in the same worker. Today only the first test
// asserts the default, so nothing collides — but that is an accident of test
// order, and adding one more default-asserting test would break it.
//
// Repeats currently escape the same trap by luck rather than design: Playwright
// starts a fresh worker process per repeat group and the `userDataDir` fixture
// mkdtemps a new directory for it, so `--repeat-each` gets clean storage even
// without this option. Do not rely on that — it is scheduler behaviour, not a
// contract.
test.use({
  extraLaunchArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  resetRendererStorage: true
})

test('preview is un-mirrored by default, mirrors on toggle, and shows the whole frame (#42)', async ({
  windowWithTestProject
}) => {
  test.setTimeout(90_000)
  const win = windowWithTestProject
  const terminal = new TerminalPage(win)

  // The camera button is render-gated on `terminalId`, and the terminal
  // activity-bar button does not exist at all without an open project
  // (verified by the step-10 spike), hence windowWithTestProject.
  await terminal.open()
  await terminal.cameraButton().click()
  await expect(byTestId(win, TEST_IDS.CAMERA_DIALOG)).toBeVisible()

  // Assert the camera did not fail BEFORE waiting on the preview, so a camera
  // failure reports its own message instead of an opaque visibility timeout.
  await expect(byTestId(win, TEST_IDS.CAMERA_ERROR)).toBeHidden()

  const preview = byTestId(win, TEST_IDS.CAMERA_PREVIEW)
  await expect(preview).toBeVisible({ timeout: 15_000 })

  // The FAKE device must be what is streaming. Without this the test can pass
  // against a real webcam on a machine that already granted TCC, or hang on the
  // OS prompt where it has not. Condition-based: the track is attached one
  // microtask after the element becomes visible.
  const trackLabel = await win.evaluate(
    async (id) =>
      new Promise<string>((resolve) => {
        const deadline = Date.now() + 10_000
        const poll = (): void => {
          const video = document.querySelector(`[data-testid="${id}"]`) as HTMLVideoElement | null
          const stream = video?.srcObject as MediaStream | null
          const label = stream?.getVideoTracks()[0]?.label ?? ''
          if (label !== '' || Date.now() > deadline) resolve(label)
          else requestAnimationFrame(poll)
        }
        poll()
      }),
    TEST_IDS.CAMERA_PREVIEW
  )
  expect(
    trackLabel,
    `Expected Chromium's fake capture device, got "${trackLabel}". Check that ` +
      `--use-fake-device-for-media-stream and --use-fake-ui-for-media-stream reached the renderer.`
  ).toMatch(/fake/i)

  // FRAMING — the half of #42 that had no automated proof at all.
  await expect(preview).toHaveCSS('object-fit', 'contain')
  await expect(byTestId(win, TEST_IDS.CAMERA_PREVIEW_WRAPPER)).toHaveCSS(
    'aspect-ratio',
    /^16\s*\/\s*9$/
  )
  const box = await byTestId(win, TEST_IDS.CAMERA_PREVIEW_WRAPPER).boundingBox()
  expect(box, 'preview wrapper has no layout box').not.toBeNull()
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1)

  // MIRRORING. toContainClass matches whole classList tokens (Playwright >=1.52,
  // repo pins ^1.57.0) — stricter than a substring regex on toHaveClass.
  await expect(preview).not.toContainClass('camera-preview--mirrored')

  const toggle = byTestId(win, TEST_IDS.CAMERA_MIRROR_TOGGLE)
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(preview).toContainClass('camera-preview--mirrored')
})

/**
 * The keyboard path that no jsdom test can prove.
 *
 * `CameraDialog.handleKeyDown` deliberately bails out for any Enter whose
 * target is inside a `button, select, input` — that is what stopped Enter on
 * Cancel from taking a photo. The consequence is that Enter on the *Capture*
 * button now depends entirely on the browser performing NATIVE button
 * activation (Enter → `click`). jsdom implements no activation behaviour at
 * all, so the unit suite can only simulate it
 * (`CameraDialog.keyboard.test.tsx`, which says so). Real Chromium is the only
 * place the real thing happens — here.
 *
 * The photo really is written to `os.tmpdir()`, so the file is removed
 * afterwards, in a `finally` so a failed assertion still cleans up.
 */
test('Enter on the focused Capture button takes a photo — real native activation (#42)', async ({
  windowWithTestProject
}) => {
  test.setTimeout(90_000)
  const win = windowWithTestProject
  const terminal = new TerminalPage(win)
  const tempDir = tmpdir()
  // The fixture launches Electron with `env: { ...process.env }`, so TMPDIR is
  // inherited and the main process's `os.tmpdir()` is this same directory.
  const photosBefore = await listCapturedPhotos(tempDir)

  try {
    await terminal.open()
    await terminal.cameraButton().click()
    await expect(byTestId(win, TEST_IDS.CAMERA_DIALOG)).toBeVisible()
    await expect(byTestId(win, TEST_IDS.CAMERA_ERROR)).toBeHidden()
    await expect(byTestId(win, TEST_IDS.CAMERA_PREVIEW)).toBeVisible({ timeout: 15_000 })

    const captureButton = byTestId(win, TEST_IDS.CAMERA_BTN_CAPTURE)
    await expect(captureButton).toBeEnabled({ timeout: 15_000 })

    // PRECONDITION, not part of what is under test: wait for a DECODED frame.
    // Capture is enabled as soon as `isPreviewActive` flips, which happens when
    // getUserMedia() resolves — before the first frame has been decoded. At
    // that instant `videoWidth` is still 0, so `captureVideoFrame()` builds a
    // 0x0 canvas whose toDataURL() is `data:,`, the main process rejects it as
    // malformed, and the capture fails with an error instead of a photo. Under
    // two concurrent Playwright workers that window is wide enough to hit
    // reproducibly (observed 2/3 on --repeat-each=3 without this wait).
    //
    // NOTE: capture-before-first-frame is a real, pre-existing product edge
    // case, unrelated to #42 and deliberately not fixed here. Waiting it out
    // keeps this spec about Enter-to-capture instead of silently retesting it.
    await win.waitForFunction(
      (id) => {
        const video = document.querySelector(`[data-testid="${id}"]`) as HTMLVideoElement | null
        return video !== null && video.readyState >= 2 && video.videoWidth > 0
      },
      TEST_IDS.CAMERA_PREVIEW,
      { timeout: 15_000 }
    )

    // Focus is set EXPLICITLY rather than by waiting on BaseDialog's own
    // promotion. BaseDialog only promotes focus to Capture within
    // FOCUS_PROMOTION_WINDOW_MS (1.5s) of opening, so on a slow camera start
    // focus legitimately stays on Cancel — asserting the auto-park here would
    // make this spec a race against camera warm-up. What is under test is what
    // Enter does once Capture holds focus, so put it there deterministically.
    await captureButton.focus()
    await expect(captureButton).toBeFocused()

    await win.keyboard.press('Enter')

    // Chromium turned that Enter into a click on Capture: the dialog closed and
    // the success toast names the file. `toHaveText` retries, so it does not
    // race the toast's 3s auto-dismiss.
    //
    // Filtered by TITLE, not `.last()`: opening the project also raises a
    // `toast-success`, and while it has normally expired by now, ordering
    // between two live toasts is not something this spec should depend on.
    const successToast = win
      .locator(`[data-testid="${TEST_IDS.TOAST}-success"]`)
      .filter({ hasText: 'Photo captured' })
    await expect(successToast).toBeVisible({ timeout: 15_000 })
    await expect(successToast.getByTestId(TEST_IDS.TOAST_MESSAGE)).toHaveText(CAPTURED_PHOTO)
    await expect(byTestId(win, TEST_IDS.CAMERA_DIALOG)).toBeHidden()
  } finally {
    const photosAfter = await listCapturedPhotos(tempDir)
    for (const name of photosAfter) {
      if (photosBefore.has(name)) continue
      await rm(join(tempDir, name), { force: true }).catch((e) =>
        console.warn('[camera-mirror] cleanup failed for', name, e)
      )
    }
  }
})

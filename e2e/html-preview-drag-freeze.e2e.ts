// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – splitter drag freeze (#124, part 1 §1.5, WI-27; user answers
 * 4 and 6).
 *
 * The native page paints above all DOM, so during a splitter drag it is hidden
 * (and its still picture or a plain background shown) until the drag ends; it
 * must never be drawn over the toolbar, the tree or the terminal. As built
 * (WI-11): a press on any `.dv-sash` arms the freeze, a move of more than 3 px
 * hides the page, moves are held from dockview until main confirms the hide,
 * and two animation frames after the release a settled push goes out and the
 * page returns.
 *
 * What stays out of e2e, and why:
 * - A window-edge drag: `setSize` fires no `will-resize`, so the resize hold
 *   is unit-tested; the end rect after `setSize`, maximize and a terminal
 *   expand-and-collapse is checked in `html-preview-bounds.e2e.ts`.
 * - The page swallowing the `pointerup` (S14): synthetic input skips
 *   hit-testing, so it is manual (`temp/spike-124/s14m.cjs`). Dockview's own
 *   sash then keeps following the pointer until the next `pointerup` – its
 *   behaviour, not the freeze's.
 * - What the panel shows while hidden (the picture, or a plain background when
 *   the picture is stale) is a visual check; each test attaches only whether a
 *   still frame was in the DOM.
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 *
 * @see docs/design/design-issue-124-part1.md §1.5
 * @see e2e/html-preview-bounds.harness.ts
 */

import {
  BOUNDS_PROJECT_FILES,
  BoundsHarness,
  FILE,
  LogTrail,
  expect,
  test
} from './html-preview-bounds.harness'
import {
  DRAG_FREEZE_LOG_MESSAGE,
  DRAG_FREEZE_LOG_REASON
} from '../src/renderer/src/services/preview/previewDragFreeze'

test.use({ testProjectFiles: BOUNDS_PROJECT_FILES })

/** A first move past the 3 px threshold (`DRAG_FREEZE_MOVE_THRESHOLD_PX`). */
const ENGAGE_PX = 10

/** Where a sash may sit from the pointer after the release: rounding only. */
const SASH_SLACK_PX = 1

/** How many moves the rest of a drag takes once the page is hidden. */
const DRAG_STEPS = 8

interface Point {
  x: number
  y: number
}

/** Whether the native page is drawn; `false` when no view is attached. */
async function pageDrawn(bounds: BoundsHarness): Promise<boolean> {
  return (await bounds.preview.viewBounds())?.visible ?? false
}

/** Put the pointer on the tall sash at `x` and press it. */
async function pressSash(bounds: BoundsHarness, x: number): Promise<Point> {
  const sash = await bounds.sashNear(x)
  if (sash === null) throw new Error(`no splitter sash at x=${x}`)
  await bounds.page.mouse.move(sash.x, sash.y)
  await bounds.page.mouse.down()
  return sash
}

/** Move past the threshold and wait until main reports the page hidden. */
async function engageFreeze(bounds: BoundsHarness, from: Point, direction: 1 | -1): Promise<void> {
  await bounds.page.mouse.move(from.x + direction * ENGAGE_PX, from.y, { steps: 2 })
  await expect
    .poll(() => pageDrawn(bounds), { message: 'the page stayed drawn after a sash moved past the threshold' })
    .toBe(false)
}

/** How far the sash nearest `x` sits from it (CSS px); `Infinity` when none is near. */
async function sashDistanceFrom(bounds: BoundsHarness, x: number): Promise<number> {
  const sash = await bounds.sashNear(x)
  return sash === null ? Infinity : Math.abs(sash.x - x)
}

/** The drag-freeze lines this test's preview wrote since `mark()`, attached to the report. */
async function freezeReasons(trail: LogTrail): Promise<string[]> {
  const reasons = await trail.reasons()
  test.info().annotations.push({ type: 'drag-freeze-reasons', description: reasons.join(', ') || 'none' })
  return reasons
}

/** Open the page and start this test's drag-freeze trail after it settles. */
async function openWithTrail(bounds: BoundsHarness, projectPath: string): Promise<LogTrail> {
  await bounds.open()
  const trail = new LogTrail(projectPath, DRAG_FREEZE_LOG_MESSAGE)
  await trail.mark()
  return trail
}

/** The two sashes that move a preview: the tree's (its left edge) and the terminal's (its right edge). */
const SASHES = [
  { name: 'terminal', edge: 'right', dx: -160 },
  { name: 'project tree', edge: 'left', dx: 120 }
] as const

test.describe('HTML preview – splitter drag freeze (#124 part 1 §1.5)', () => {
  test('should keep the page hidden for the rest of the drag when a sash moves more than 3 px', async ({
    bounds,
    testProject
  }) => {
    const trail = await openWithTrail(bounds, testProject.path)
    const start = await pressSash(bounds, (await bounds.editorEdges()).right)
    await engageFreeze(bounds, start, -1)
    const drawnMidDrag: number[] = []
    for (let i = 1; i <= DRAG_STEPS; i += 1) {
      await bounds.page.mouse.move(start.x - ENGAGE_PX - i * 20, start.y)
      if (await pageDrawn(bounds)) drawnMidDrag.push(i)
    }
    test.info().annotations.push({
      type: 'still-frame-during-drag',
      description: String(await bounds.preview.stillFrame(FILE).count())
    })
    await bounds.page.mouse.up()
    expect(drawnMidDrag, 'moves after which the page was drawn mid-drag').toEqual([])
    await bounds.expectOnPlaceholder('after the drag')
    expect(await freezeReasons(trail)).not.toContain(DRAG_FREEZE_LOG_REASON.hideUnconfirmed)
  })

  for (const sash of SASHES) {
    test(`should leave the ${sash.name} sash at the pointer and the page on the settled area when the drag ends`, async ({
      bounds,
      testProject
    }) => {
      const trail = await openWithTrail(bounds, testProject.path)
      const start = await pressSash(bounds, (await bounds.editorEdges())[sash.edge])
      const direction = sash.dx < 0 ? -1 : 1
      await engageFreeze(bounds, start, direction)
      const target = start.x + sash.dx
      await bounds.page.mouse.move(target, start.y, { steps: DRAG_STEPS })
      await bounds.page.mouse.up()
      await expect
        .poll(() => sashDistanceFrom(bounds, target), { message: `the ${sash.name} sash did not end at the pointer` })
        .toBeLessThanOrEqual(SASH_SLACK_PX)
      await bounds.expectOnPlaceholder(`after the ${sash.name} drag`)
      expect(await freezeReasons(trail)).not.toContain(DRAG_FREEZE_LOG_REASON.hideUnconfirmed)
    })
  }

  test('should show the page on its settled area when a fast drag ends over the preview', async ({
    bounds,
    testProject
  }) => {
    // S14 is a macOS finding (the native view taking the pointer mid-drag).
    test.skip(process.platform !== 'darwin', 'the fast drag into the preview is a macOS case (part 1 §1.5)')
    const trail = await openWithTrail(bounds, testProject.path)
    const placeholder = await bounds.preview.placeholder(FILE).boundingBox()
    if (placeholder === null) throw new Error('the placeholder has no box')
    const start = await pressSash(bounds, (await bounds.editorEdges()).right)
    // Two moves straight into the page, then the release: no waiting for the hide.
    await bounds.page.mouse.move(placeholder.x + placeholder.width / 2, start.y, { steps: 2 })
    await bounds.page.mouse.up()
    // Only the end state is asserted: whether the hide landed before the release is a race by design.
    await bounds.expectOnPlaceholder('after a fast drag into the preview')
    await freezeReasons(trail)
  })

  test('should move the sash with no freeze when the terminal is expanded over the editor', async ({
    bounds,
    testProject
  }) => {
    const trail = await openWithTrail(bounds, testProject.path)
    // Read before expanding: the collapsed editor area's box no longer marks the tree's edge.
    const treeEdge = (await bounds.editorEdges()).left
    await bounds.terminal.toggleExpand()
    await expect(bounds.terminal.expandButton()).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => pageDrawn(bounds), { message: 'the page stayed drawn under the expanded terminal' }).toBe(false)
    const start = await pressSash(bounds, treeEdge)
    const target = start.x + 120
    await bounds.page.mouse.move(target, start.y, { steps: DRAG_STEPS })
    await bounds.page.mouse.up()
    await expect
      .poll(() => sashDistanceFrom(bounds, target), { message: 'the sash did not follow the pointer' })
      .toBeLessThanOrEqual(SASH_SLACK_PX)
    expect(await freezeReasons(trail), 'a collapsed preview counts as no visible preview').toEqual([])
    await bounds.terminal.toggleExpand()
    await expect(bounds.terminal.expandButton()).toHaveAttribute('aria-pressed', 'false')
    await bounds.expectOnPlaceholder('after the terminal collapsed')
  })
})

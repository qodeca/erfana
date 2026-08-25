// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Source-text invariants for the crash-containment wiring in `main.tsx`.
 *
 * Modelled on `main.import-isolation.test.ts`, and for the same reason: the
 * property under test is a BUILD-GRAPH property, and jsdom cannot bundle.
 * Rendering `main.tsx` in a test would execute `createRoot` against a real
 * `#root` and mount the whole app — so the testable surface is the module's own
 * source.
 *
 * Two invariants, both load-bearing:
 *
 * 1. The `<App/>` branch is wrapped in `<RootErrorBoundary>`. Without it a throw
 *    anywhere under `<App/>` unmounts the React root and the window goes black —
 *    issue #60's reported symptom.
 * 2. The overlay branch is NOT wrapped. The area-select overlay is a transparent
 *    click-through window with nothing to recover, and a full-window crash
 *    screen there would cover the user's actual screen content. (It is NOT a
 *    bundle-leak argument: `main.tsx` imports the boundary statically, so its
 *    stylesheet is in the shared entry bundle whichever branch runs — which is
 *    why `RootErrorBoundary.css` carries its own selector allowlist.) The trail
 *    import is expected on BOTH branches — it is module-level and deliberately
 *    branch-agnostic.
 *
 * @see docs/design/design-issue-60.md §2.3, §5 (`main.tsx` row)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(resolve(__dirname, 'main.tsx'), 'utf8')

/** Marker that opens the overlay branch. */
const OVERLAY_BRANCH_START = 'if (isOverlayRoute())'

/** Marker that closes the overlay branch and opens the App branch. */
const BRANCH_SPLIT = '} else {'

const overlayBranchStart = SOURCE.indexOf(OVERLAY_BRANCH_START)
const branchSplit = SOURCE.indexOf(BRANCH_SPLIT, overlayBranchStart)

const OVERLAY_BRANCH = SOURCE.slice(overlayBranchStart, branchSplit)
const APP_BRANCH = SOURCE.slice(branchSplit)

describe('main.tsx crash-boundary wiring', () => {
  it('still has the two-branch shape this test slices on', () => {
    // Guards against a silent false pass if `main.tsx` is ever restructured.
    expect(overlayBranchStart).toBeGreaterThan(-1)
    expect(branchSplit).toBeGreaterThan(overlayBranchStart)
    expect(OVERLAY_BRANCH).toContain('ScreenshotOverlay')
    expect(APP_BRANCH).toContain('<App />')
    // Both halves of the split, not just one: `} else {` also appears inside
    // the overlay branch's own body if one is ever added there, which would
    // slice the overlay mount into APP_BRANCH and make the "overlay is not
    // wrapped" assertion below pass against the wrong text.
    expect(APP_BRANCH).not.toContain('ScreenshotOverlay')
  })

  it('imports RootErrorBoundary statically', () => {
    expect(SOURCE).toMatch(
      /^\s*import\s+\{\s*RootErrorBoundary\s*\}\s+from\s+['"][^'"]*RootErrorBoundary\/RootErrorBoundary['"]/m
    )
  })

  it('wraps the App branch in <RootErrorBoundary>', () => {
    expect(APP_BRANCH).toMatch(/<RootErrorBoundary>\s*<App\s*\/>\s*<\/RootErrorBoundary>/)
  })

  it('keeps the boundary inside <React.StrictMode>', () => {
    expect(APP_BRANCH).toMatch(/<React\.StrictMode>\s*<RootErrorBoundary>/)
  })

  it('does NOT wrap the overlay branch in the boundary', () => {
    expect(
      OVERLAY_BRANCH,
      'The overlay window is a transparent click-through surface with nothing to ' +
        'recover; a crash screen there would cover the screen the user is capturing. ' +
        'Leave the overlay branch bare.'
    ).not.toContain('RootErrorBoundary')
  })

  it('installs the global error trail before the route branch', () => {
    const callIndex = SOURCE.indexOf('installGlobalErrorTrail()')
    expect(callIndex).toBeGreaterThan(-1)
    expect(callIndex).toBeLessThan(overlayBranchStart)
  })

  it('imports the global error trail at module top level', () => {
    // Expected and allowed on BOTH branches — the trail is branch-agnostic by
    // design, unlike the boundary.
    expect(SOURCE).toMatch(
      /^\s*import\s+\{\s*installGlobalErrorTrail\s*\}\s+from\s+['"][^'"]*installGlobalErrorTrail['"]/m
    )
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pick-and-send test hooks of the built-in browser (spec 025 commits
 * 14–15, solution design § 12 T3, T14): `globalThis.__erfanaTestHooks.pick`,
 * reached by e2e tests through `app.evaluate`. Test builds only – reached
 * through `./index`. ERFANA_BROWSER_TEST_HOOK_SENTINEL
 *
 * - **Reads**: the node and box of the highlight Erfana asked for, with its
 *   exact label (S-1: tests assert this, not the engine's paint); the targets
 *   a tab's CDP session holds (T14); the pick state and the held capture.
 * - **Faults**: an empty or failed screenshot, a slow or throwing hint
 *   lookup, a failed capture write (025-AC-034, 025-AC-037, 025-AC-060).
 * - **Expiry**: run the 025-FR-039 sweep now, on the test clock.
 * - **Bench** (025-AC-049, 025-AC-050): the stage timings.
 *
 * Never touches a `webContents`' debugger (only `cdp/` may).
 */
import { mainClock } from '../utils/mainClock'
import type { BrowserRuntime } from '../services/browser/browserAppSetup'
import type { PickSummary } from '../services/browser/capture/BrowserCapture'
import type { BrowserTabPick } from '../services/browser/pick/BrowserTabPick'
import type { BenchStage } from '../services/browser/pick/pickSupport'
import type { Box } from '../services/browser/pick/pickGeometry'

export interface HookHighlight {
  readonly label: string
  readonly box: Box | null
  readonly sessionKey: string
  readonly backendNodeId: number
  readonly frameId: string
}

export interface HookPickState {
  readonly active: boolean
  readonly frozen: boolean
  readonly capture: {
    readonly id: string
    readonly index: number
    readonly firstIndex: number
    readonly summary: PickSummary
    readonly afterNavigation: boolean
    readonly written: readonly string[]
    readonly pickPoint: { x: number; y: number }
  } | null
}

export interface BrowserPickTestHook {
  /** What the live highlight shows now (node, top-level box, exact label), or null. */
  highlight(tabId: string): HookHighlight | null
  /** The targets the tab's CDP session holds: session key, target id, type, URL. */
  attachedTargets(tabId: string): Array<{ sessionKey: string; targetId: string; type: string; url: string }>
  state(tabId: string): HookPickState
  /** The next `count` screenshots come back empty. */
  armEmptyCaptures(count: number): void
  /** The next `count` screenshots fail. */
  armCaptureFailures(count: number): void
  /** The React lookup takes `ms` on the main clock's timers, or throws. */
  armHints(options: { delayMs?: number; throws?: boolean }): void
  /** The next `count` capture writes fail. */
  armWriteFailures(count: number): void
  resetFaults(): void
  /** Run the expiry sweep of `projectRoot` now; resolves the names deleted. */
  expire(projectRoot: string): Promise<string[]>
  bench(stage: BenchStage): number[]
  clearBench(): void
}

function requireRuntime(getRuntime: () => BrowserRuntime | null): BrowserRuntime {
  const runtime = getRuntime()
  if (runtime === null) throw new Error('The browser runtime is not installed')
  return runtime
}

/** Build the pick hook over the runtime `getRuntime` returns at call time. */
export function createBrowserPickTestHook(getRuntime: () => BrowserRuntime | null): BrowserPickTestHook {
  const pickOf = (tabId: string): BrowserTabPick => {
    const runtime = requireRuntime(getRuntime)
    const tab = runtime.tabs.list().find((t) => t.id === tabId)
    if (tab === undefined) throw new Error(`No browser tab ${tabId}`)
    const pick = runtime.picks.forTab(tab)
    if (pick === null) throw new Error(`Browser tab ${tabId} has no pick pipeline`)
    return pick
  }
  const faults = () => requireRuntime(getRuntime).picks.faults

  return {
    highlight: (tabId) => {
      const record = pickOf(tabId).highlight.record
      if (record === null) return null
      return { label: record.label, box: record.box, ...record.node }
    },
    attachedTargets: (tabId) => pickOf(tabId).attachedTargets().map((t) => ({ ...t })),
    state: (tabId) => {
      const pick = pickOf(tabId)
      const capture = pick.capture
      return {
        active: pick.isActive,
        frozen: pick.isFrozen,
        capture:
          capture === null
            ? null
            : {
                id: capture.id,
                index: capture.index,
                firstIndex: capture.firstIndex,
                summary: capture.summary(),
                afterNavigation: capture.afterNavigation,
                written: [...capture.written],
                pickPoint: { ...capture.moment.pickPoint }
              }
      }
    },
    armEmptyCaptures: (count) => faults().armEmptyCaptures(count),
    armCaptureFailures: (count) => faults().armCaptureFailures(count),
    armHints: ({ delayMs, throws }) => {
      const until =
        delayMs === undefined ? undefined : new Promise<void>((resolve) => mainClock.setTimeout(resolve, delayMs))
      faults().armHints({ until, throws })
    },
    armWriteFailures: (count) => faults().armWriteFailures(count),
    resetFaults: () => faults().reset(),
    expire: (projectRoot) => requireRuntime(getRuntime).picks.store.expire(projectRoot, new Date(mainClock.now())),
    bench: (stage) => [...requireRuntime(getRuntime).picks.bench.read(stage)],
    clearBench: () => requireRuntime(getRuntime).picks.bench.clear()
  }
}

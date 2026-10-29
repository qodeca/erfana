// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The main-side e2e hook for HTML Preview comments
 * (docs/designs/comments/html-preview-comments.md §12.4, §13 P3 exit).
 *
 * An e2e spec reads comment state through `globalThis.__erfanaE2eComments`
 * from `app.evaluate`, so it never depends on the page's markup or on a
 * closed shadow root. Installed only in an unpackaged build started with
 * `ERFANA_E2E_TEST_HOOKS=1` – the same gate as the renderer's test hooks
 * (`src/main/index.ts`, `buildAdditionalArguments`); a shipped build never
 * has it.
 *
 * P3 exposes the served loads: for every live preview view, each instrumented
 * document with its blocks and the token each block resolved to, and the
 * reason comments are unavailable for a file. P5 adds each view's comment
 * service state (`panels()`, `state(panelId)`): mode, reloads and the last
 * scroll restore, drafts and keys held, frames that said hello – counts and
 * outcomes only, never a path, a name or comment text.
 */
import { app } from 'electron'
import type { CommentLoadView } from './ElementTokenTable'
import type { CommentE2ePanelState } from './commentServiceTypes'

/**
 * What one preview view contributes to the hook: its served loads
 * (instrumentation, P3) and/or its comment panel state (the service, P5).
 */
export interface CommentE2eSource {
  views?(): CommentLoadView[]
  unavailable?(): ReadonlyArray<{ readonly realPath: string; readonly reason: string }>
  panel?(): CommentE2ePanelState
}

/** The object an e2e spec reads. */
export interface CommentE2eHook {
  /** Every instrumented load of every live view, oldest first. */
  loads(): CommentLoadView[]
  /** Every file comments are unavailable for, with its reason. */
  unavailable(): Array<{ realPath: string; reason: string }>
  /** Every live view's comment state (mode, reloads, restore, drafts, frames). */
  panels(): CommentE2ePanelState[]
  /** One panel's comment state; `undefined` when no live view has that panel. */
  state(panelId: string): CommentE2ePanelState | undefined
}

/** The `globalThis` key the hook lives under. */
export const COMMENT_E2E_HOOK_KEY = '__erfanaE2eComments'

const sources = new Set<CommentE2eSource>()

/** The hook's gate: an unpackaged build started with `ERFANA_E2E_TEST_HOOKS=1`. */
export function commentE2eHookEnabled(): boolean {
  return !app.isPackaged && process.env.ERFANA_E2E_TEST_HOOKS === '1'
}

function install(): void {
  const panels = (): CommentE2ePanelState[] =>
    [...sources].flatMap(source => (source.panel === undefined ? [] : [source.panel()]))
  const hook: CommentE2eHook = {
    loads: () => [...sources].flatMap(source => source.views?.() ?? []),
    unavailable: () => [...sources].flatMap(source => [...(source.unavailable?.() ?? [])]),
    panels,
    state: panelId => panels().find(panel => panel.panelId === panelId)
  }
  ;(globalThis as Record<string, unknown>)[COMMENT_E2E_HOOK_KEY] = hook
}

/**
 * Add one view's comment state to the hook, when the hook is on. Returns the
 * function that removes it again (a no-op when the hook is off).
 */
export function registerCommentE2eSource(
  source: CommentE2eSource,
  enabled: () => boolean = commentE2eHookEnabled
): () => void {
  if (!enabled()) return () => {}
  if (!(COMMENT_E2E_HOOK_KEY in globalThis)) install()
  sources.add(source)
  return () => {
    sources.delete(source)
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – e2e reads (docs/designs/html-preview-comments.md
 * §12.4, §13 P3 exit).
 *
 * Comment state is read main-side through the e2e hook the app installs on
 * `globalThis.__erfanaE2eComments` (`commentE2eHook.ts`; unpackaged build with
 * `ERFANA_E2E_TEST_HOOKS=1`, which the fixtures set), never from the page's
 * markup. The page's own DOM is read with the bounded preview reads
 * (`html-preview.native.ts`, `html-preview.frames.ts`).
 *
 * Nothing here waits: callers poll. Condition-based waits only.
 */

import type { ElectronApplication } from '@playwright/test'

import type { CommentLoadView } from '../../src/main/services/preview/comments/ElementTokenTable'

export type { CommentLoadView }

/** The attribute the served copy marks every eligible element with. */
export const ELEMENT_TOKEN_ATTR = 'data-erfana-el'

/** One file comments are unavailable for, and why. */
export interface CommentUnavailable {
  realPath: string
  reason: string
}

/** Every instrumented load of every live preview view, oldest first; `[]` before the hook exists. */
export async function commentLoads(app: ElectronApplication): Promise<CommentLoadView[]> {
  return app.evaluate(() => {
    const hook = (globalThis as { __erfanaE2eComments?: { loads(): CommentLoadView[] } })
      .__erfanaE2eComments
    return hook ? hook.loads() : []
  })
}

/** Every file comments are unavailable for; `[]` before the hook exists. */
export async function commentUnavailable(app: ElectronApplication): Promise<CommentUnavailable[]> {
  return app.evaluate(() => {
    const hook = (globalThis as { __erfanaE2eComments?: { unavailable(): CommentUnavailable[] } })
      .__erfanaE2eComments
    return hook ? hook.unavailable() : []
  })
}

/** True when `realPath` (any separator) names the project-relative `relPath`. */
export function namesFile(realPath: string, relPath: string): boolean {
  return realPath.replace(/\\/g, '/').endsWith(`/${relPath}`)
}

/**
 * The newest load of `relPath` in `scope`, or `undefined` – the one whose
 * tokens the live document carries.
 */
export function newestLoad(
  loads: readonly CommentLoadView[],
  relPath: string,
  scope: CommentLoadView['scope']
): CommentLoadView | undefined {
  return loads.filter(load => load.scope === scope && namesFile(load.realPath, relPath)).at(-1)
}

/** A page expression: the `id` of the element carrying `token`, `''` when none does. */
export function idOfTokenExpr(token: string): string {
  const selector = JSON.stringify(`[${ELEMENT_TOKEN_ATTR}=${JSON.stringify(token)}]`)
  return `(() => { const el = document.querySelector(${selector}); return el ? el.id : '' })()`
}

/** A page expression: every token in the live document, as a JSON array, in document order. */
export const DOM_TOKENS_EXPR =
  `JSON.stringify([...document.querySelectorAll('[${ELEMENT_TOKEN_ATTR}]')]` +
  `.map(el => el.getAttribute('${ELEMENT_TOKEN_ATTR}')))`

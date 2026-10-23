// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Bounded `executeJavaScript` for e2e helpers (lens review finding 34).
 *
 * `webContents.executeJavaScript` and `WebFrameMain.executeJavaScript` have no
 * timeout. A call made while the document is being replaced (a link just
 * followed, a frame navigating, a view being evicted) can stay pending
 * forever, and `ElectronApplication.evaluate` has no timeout either – so one
 * hung call stalls the caller's `expect.poll` past its own deadline and the
 * test dies on the test timeout with no word about which call hung (#255).
 *
 * The calls run inside `app.evaluate` callbacks, which Playwright serialises
 * into the main process, so they cannot import a function. Instead
 * {@link installBoundedExec} defines one on the main process's `globalThis`,
 * once per app, and every callback reads it from there:
 *
 * ```ts
 * await installBoundedExec(app)
 * return app.evaluate(async ({ webContents }, { readCapMs }) => {
 *   const exec = (globalThis as unknown as BoundedExecGlobal).__erfanaE2eExec
 *   …
 *   return await exec(wc, 'document.title', readCapMs, 'previewSnapshot: document.title')
 * }, { readCapMs: EXEC_READ_CAP_MS })
 * ```
 *
 * A call that does not settle within its cap rejects with an error that names
 * the call (`<label>: executeJavaScript did not settle within <n> ms`). What a
 * caller does with that is its own decision: a READ treats it like any other
 * failed read (empty / `null`, the caller polls again); an ACTION lets it
 * propagate, so the test fails with the name of the call that hung.
 *
 * Direct `executeJavaScript` calls anywhere else under `e2e/` are a lint error
 * (`no-restricted-syntax`, eslint.config.mjs).
 *
 * Nothing here sleeps: the cap is a deadline on a call that would otherwise
 * never settle, not a wait.
 */

import type { ElectronApplication } from '@playwright/test'

/**
 * The cap for a read (a title, a flag, a rectangle). A healthy read answers in
 * milliseconds; this only bounds one whose document went away under it.
 */
export const EXEC_READ_CAP_MS = 2_000

/**
 * The cap for an action (a click, a scroll, a paced resize). Longer than a
 * read: an action may run a page's own handlers before it answers.
 */
export const EXEC_ACTION_CAP_MS = 5_000

/** Anything with Electron's `executeJavaScript` – a `WebContents` or a `WebFrameMain`. */
export interface ScriptTarget {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}

/** The main-side bounded call: `code` in `target`, rejected after `capMs` with `label` in the error. */
export type BoundedExec = <T = unknown>(
  target: ScriptTarget,
  code: string,
  capMs: number,
  label: string
) => Promise<T>

/** The main process's `globalThis` once {@link installBoundedExec} has run. */
export interface BoundedExecGlobal {
  __erfanaE2eExec: BoundedExec
}

/** One install per launched app; concurrent first callers share the same promise. */
const installs = new WeakMap<ElectronApplication, Promise<void>>()

/**
 * Define `globalThis.__erfanaE2eExec` in `app`'s main process. Idempotent:
 * cheap to call at the top of every helper that needs it.
 */
export function installBoundedExec(app: ElectronApplication): Promise<void> {
  let pending = installs.get(app)
  if (!pending) {
    pending = app.evaluate(() => {
      const g = globalThis as unknown as Partial<BoundedExecGlobal>
      if (g.__erfanaE2eExec) return
      const exec = (target: ScriptTarget, code: string, capMs: number, label: string): Promise<unknown> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const cap = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label}: executeJavaScript did not settle within ${capMs} ms`)),
            capMs
          )
        })
        // `Promise.resolve().then` turns a synchronous throw (a destroyed
        // target) into a rejection, so it gets the same handling as the rest.
        const call = Promise.resolve().then(() => target.executeJavaScript(code))
        return Promise.race([call, cap]).finally(() => clearTimeout(timer))
      }
      g.__erfanaE2eExec = exec as BoundedExec
    })
    // A failed install (the app closing) must not poison the next attempt.
    pending.catch(() => installs.delete(app))
    installs.set(app, pending)
  }
  return pending
}

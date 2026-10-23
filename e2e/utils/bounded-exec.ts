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
 * {@link installBoundedExec} defines them on the main process's `globalThis`,
 * once per app, and every callback reads them from there:
 *
 * ```ts
 * await installBoundedExec(app)
 * return app.evaluate(async ({ webContents }, { readCapMs }) => {
 *   const { __erfanaE2eExec: exec, __erfanaE2eTolerable: tolerable } =
 *     globalThis as unknown as BoundedExecGlobal
 *   …
 * }, { readCapMs: EXEC_READ_CAP_MS })
 * ```
 *
 * **What a failed call means** (measured on Electron 44 with a scratch probe):
 *
 * | Case | Electron's own behaviour | Here |
 * |---|---|---|
 * | the document is replaced mid-call | never settles | `BoundedExecTimeout` after the cap |
 * | the frame is gone | rejects `Render frame was disposed …` | tolerable |
 * | the web contents is destroyed | `getURL()` throws `Object has been destroyed`; `executeJavaScript` never settles | tolerable / timeout |
 * | the script throws (Reference/Syntax/TypeError …) | `webContents`: generic `Script failed to execute …`; frame: the error as a bare string | NOT tolerable |
 *
 * Every rejection comes back as an `Error` whose message starts with the
 * call's label. A READ helper catches only what {@link tolerable} accepts
 * (the timeout, a destroyed or disposed target), reports it as "nothing yet"
 * so the caller polls again, and hands the error back so it can be named in
 * the poll's failure ({@link noteReadError}, {@link withLastReadError}).
 * Anything else – a script error above all – is rethrown and fails the test.
 * An ACTION helper catches nothing.
 *
 * Direct `executeJavaScript` anywhere else under `e2e/` is a lint error
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

/** The `name` of the error a capped call rejects with, in both processes. */
export const BOUNDED_EXEC_TIMEOUT = 'BoundedExecTimeout'

/**
 * A call that did not settle within its cap. Thrown in the main process by the
 * installed exec (a class of the same name is defined there, since nothing can
 * be imported into an `app.evaluate` callback); when it crosses back to the
 * test, Playwright keeps its `name` and message, so test-side code checks it
 * with {@link isBoundedExecTimeout} rather than `instanceof`.
 */
export class BoundedExecTimeout extends Error {
  override readonly name = BOUNDED_EXEC_TIMEOUT
}

/** Whether `err` is a capped call, whichever process created it. */
export function isBoundedExecTimeout(err: unknown): boolean {
  return (
    err instanceof BoundedExecTimeout ||
    (err instanceof Error &&
      (err.name === BOUNDED_EXEC_TIMEOUT || err.message.includes('executeJavaScript did not settle within')))
  )
}

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
  /**
   * Whether a read may treat `err` as "nothing yet": the cap, or a target
   * destroyed / disposed under the read. A script error is not.
   */
  __erfanaE2eTolerable: (err: unknown) => boolean
  /** `err` as one line of text, for {@link noteReadError}. */
  __erfanaE2eErrorText: (err: unknown) => string
}

/** One install per launched app; concurrent first callers share the same promise. */
const installs = new WeakMap<ElectronApplication, Promise<void>>()

/**
 * Define the bounded exec and its classifier in `app`'s main process.
 * Idempotent: cheap to call at the top of every helper that needs it.
 */
export function installBoundedExec(app: ElectronApplication): Promise<void> {
  let pending = installs.get(app)
  if (!pending) {
    pending = app.evaluate((_electron, timeoutName) => {
      const g = globalThis as unknown as Partial<BoundedExecGlobal>
      if (g.__erfanaE2eExec) return
      class Timeout extends Error {}
      Object.defineProperty(Timeout.prototype, 'name', { value: timeoutName })
      const text = (err: unknown): string => (err instanceof Error ? err.message : String(err))
      const exec = (target: ScriptTarget, code: string, capMs: number, label: string): Promise<unknown> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const cap = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Timeout(`${label}: executeJavaScript did not settle within ${capMs} ms`)),
            capMs
          )
        })
        // `Promise.resolve().then` turns a synchronous throw (a destroyed
        // target) into a rejection, so it gets the same handling as the rest.
        // A frame rejects with a bare string: wrap it, and prefix every
        // rejection with the label so the failure names the call.
        const call = Promise.resolve()
          .then(() => target.executeJavaScript(code))
          .catch((err: unknown) => {
            const wrapped = new Error(`${label}: ${text(err)}`)
            if (err instanceof Error) wrapped.name = err.name
            throw wrapped
          })
        return Promise.race([call, cap]).finally(() => clearTimeout(timer))
      }
      g.__erfanaE2eExec = exec as BoundedExec
      g.__erfanaE2eErrorText = text
      g.__erfanaE2eTolerable = (err) =>
        err instanceof Timeout ||
        /Object has been destroyed|Render frame was disposed|WebFrameMain could not be accessed/.test(text(err))
    }, BOUNDED_EXEC_TIMEOUT)
    // A failed install (the app closing) must not poison the next attempt.
    pending.catch(() => installs.delete(app))
    installs.set(app, pending)
  }
  return pending
}

/** The last tolerated read failure per app, for the next poll failure to name. */
const readErrors = new WeakMap<ElectronApplication, { message: string; at: number }>()

/** Remember a read failure the helper tolerated (no-op for `undefined`). */
export function noteReadError(app: ElectronApplication, message: string | undefined): void {
  if (message !== undefined) readErrors.set(app, { message, at: Date.now() })
}

/** The last tolerated read failure for `app` and how long ago it was, if any. */
export function lastReadError(app: ElectronApplication): string | undefined {
  const last = readErrors.get(app)
  return last && `${last.message} (${Date.now() - last.at} ms before this failure)`
}

/**
 * Run a poll (or any assertion) over `app`'s read helpers; when it fails, add
 * the last read failure those helpers tolerated to its message, so a poll
 * that saw only `null` says why.
 */
export async function withLastReadError<T>(app: ElectronApplication, assertion: Promise<T>): Promise<T> {
  try {
    return await assertion
  } catch (err) {
    const last = lastReadError(app)
    if (last !== undefined && err instanceof Error) {
      err.message += `\n\nLast tolerated preview read failure: ${last}`
    }
    throw err
  }
}

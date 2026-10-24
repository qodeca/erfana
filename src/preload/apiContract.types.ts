// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Compile-time proof that the preload object is its contracts.
 *
 * Nothing imports this file and it has no runtime content: `npm run typecheck`
 * compiles it (test files are not type-checked, so the same assertions in
 * `__tests__/api-contract.test.ts` alone would prove nothing in CI). A bridge
 * that drifts from its contract, or an `Api` that stops being `typeof api`,
 * fails the typecheck here.
 */
import type { DirectoryWatchBridge } from '../shared/ipc/directory-watch-schema'
import type { FileBridge } from '../shared/ipc/file-schema'
import type { FileWatchBridge } from '../shared/ipc/file-watch-schema'
import type { GitBridge } from '../shared/ipc/git-schema'
import type { GitPollingBridge, GitWatcherBridge } from '../shared/ipc/git-watcher-schema'
import type { TerminalBridge } from '../shared/ipc/terminal-schema'
import type { Api } from './index'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

/** Platform types that hold `any` themselves (`Date#toJSON(key: any)`); the walk stops there. */
type Builtin = Date | RegExp | Error | Blob | ArrayBuffer | ArrayBufferView | ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>

type IsAny<T> = 0 extends 1 & T ? true : false

/**
 * `true` where `any` appears in `T`: as a value, a property, a parameter, a
 * return or a promised value. Depth is bounded so DOM and Node types end the walk.
 */
type AnyIn<T, Depth extends unknown[] = []> = Depth['length'] extends 14
  ? never
  : IsAny<T> extends true
    ? true
    : T extends (...args: infer A) => infer R
      ? AnyIn<A, [...Depth, 0]> | AnyIn<R, [...Depth, 0]>
      : T extends Promise<infer U>
        ? AnyIn<U, [...Depth, 0]>
        : T extends Builtin
          ? never
          : T extends readonly unknown[]
          ? AnyIn<T[number], [...Depth, 0]>
          : T extends object
            ? { [K in keyof T]-?: AnyIn<T[K], [...Depth, 0]> }[keyof T]
            : never

export type ApiContractChecks = [
  Assert<Equal<Api['file'], FileBridge>>,
  Assert<Equal<Api['terminal'], TerminalBridge>>,
  Assert<Equal<Api['fileWatch'], FileWatchBridge>>,
  Assert<Equal<Api['directoryWatch'], DirectoryWatchBridge>>,
  Assert<Equal<Api['git'], GitBridge>>,
  Assert<Equal<Api['gitWatcher'], GitWatcherBridge>>,
  Assert<Equal<Api['gitPolling'], GitPollingBridge>>,
  // A bridge method that returns the unchecked `ipcRenderer.invoke` result would put `any` in the renderer
  Assert<Equal<AnyIn<Api>, never>>
]

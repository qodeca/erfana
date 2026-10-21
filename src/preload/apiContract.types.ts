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
import type { FileBridge } from '../shared/ipc/file-schema'
import type { TerminalBridge } from '../shared/ipc/terminal-schema'
import type { Api } from './index'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

export type ApiContractChecks = [
  Assert<Equal<Api['file'], FileBridge>>,
  Assert<Equal<Api['terminal'], TerminalBridge>>
]

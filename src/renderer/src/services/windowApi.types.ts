// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Compile-time proof that the renderer's `window.api` is the preload object's
 * own type, and that each gateway is typed as its bridge contract.
 *
 * Nothing imports this file and it has no runtime content: `npm run typecheck`
 * compiles it, test files are not type-checked.
 */
import type { Api } from '../../../preload/index'
import type { FileBridge } from '../../../shared/ipc/file-schema'
import type { TerminalBridge } from '../../../shared/ipc/terminal-schema'
import type { fileGateway } from './fileGateway'
import type { terminalGateway } from './terminalGateway'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

export type WindowApiChecks = [
  Assert<Equal<Window['api'], Omit<Api, 'file' | 'terminal'>>>,
  Assert<Equal<typeof fileGateway, FileBridge>>,
  Assert<Equal<typeof terminalGateway, TerminalBridge>>
]

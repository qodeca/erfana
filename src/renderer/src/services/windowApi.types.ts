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
import type { DirectoryWatchBridge } from '../../../shared/ipc/directory-watch-schema'
import type { FileBridge } from '../../../shared/ipc/file-schema'
import type { FileWatchBridge } from '../../../shared/ipc/file-watch-schema'
import type { GitBridge } from '../../../shared/ipc/git-schema'
import type { GitPollingBridge, GitWatcherBridge } from '../../../shared/ipc/git-watcher-schema'
import type { TerminalBridge } from '../../../shared/ipc/terminal-schema'
import type { directoryWatchGateway } from './directoryWatchGateway'
import type { fileGateway } from './fileGateway'
import type { fileWatchGateway } from './fileWatchGateway'
import type { gitGateway, gitPollingGateway, gitWatcherGateway } from './gitGateway'
import type { terminalGateway } from './terminalGateway'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

/** The bridges that have a gateway, and so are not on `window.api`'s type. */
type GatewayBridges =
  | 'file'
  | 'terminal'
  | 'fileWatch'
  | 'directoryWatch'
  | 'git'
  | 'gitWatcher'
  | 'gitPolling'

export type WindowApiChecks = [
  Assert<Equal<Window['api'], Omit<Api, GatewayBridges>>>,
  Assert<Equal<typeof fileGateway, FileBridge>>,
  Assert<Equal<typeof terminalGateway, TerminalBridge>>,
  Assert<Equal<typeof fileWatchGateway, FileWatchBridge>>,
  Assert<Equal<typeof directoryWatchGateway, DirectoryWatchBridge>>,
  Assert<Equal<typeof gitGateway, GitBridge>>,
  Assert<Equal<typeof gitWatcherGateway, GitWatcherBridge>>,
  Assert<Equal<typeof gitPollingGateway, GitPollingBridge>>
]

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer git gateways: the one place `window.api.git`, `window.api.gitWatcher`
 * and `window.api.gitPolling` are read.
 *
 * Renderer code calls `gitGateway`, `gitWatcherGateway` or `gitPollingGateway`,
 * which forward to the preload bridges with the same contracts
 * ({@link GitBridge}, {@link GitWatcherBridge}, {@link GitPollingBridge}).
 * Keeping the access in one module gives the renderer a single seam to change
 * or fake.
 */
import type { GitBridge } from '../../../shared/ipc/git-schema'
import type { GitPollingBridge, GitWatcherBridge } from '../../../shared/ipc/git-watcher-schema'

interface GitBridges {
  git: GitBridge
  gitWatcher: GitWatcherBridge
  gitPolling: GitPollingBridge
}

/** The bridges are read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves these bridges out of its type; this module is the only place they are put back
const bridges = (): GitBridges => (window as unknown as { api: GitBridges }).api

export const gitGateway: GitBridge = {
  getStatus: (...args) => bridges().git.getStatus(...args)
}

export const gitWatcherGateway: GitWatcherBridge = {
  start: (...args) => bridges().gitWatcher.start(...args),
  stop: (...args) => bridges().gitWatcher.stop(...args),
  getStatus: (...args) => bridges().gitWatcher.getStatus(...args),
  onStateChanged: (...args) => bridges().gitWatcher.onStateChanged(...args)
}

export const gitPollingGateway: GitPollingBridge = {
  start: (...args) => bridges().gitPolling.start(...args),
  stop: (...args) => bridges().gitPolling.stop(...args),
  setInterval: (...args) => bridges().gitPolling.setInterval(...args),
  setEnabled: (...args) => bridges().gitPolling.setEnabled(...args),
  onPollTriggered: (...args) => bridges().gitPolling.onPollTriggered(...args)
}

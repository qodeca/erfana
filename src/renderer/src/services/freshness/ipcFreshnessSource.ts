// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The renderer's {@link FreshnessSource}: the `file-watch:*` IPC channels
 * through `fileWatchGateway` (#478, plan S12, decision 7).
 *
 * One `file-watch:event` subscription per window, however many tabs follow
 * files: it is opened with the first tracker's listener and closed with the
 * last. Each tracker drops events for ids it does not hold (decision 6), so
 * the source fans every event out unchanged. An event that does not match
 * the wire schema is dropped.
 *
 * {@link createPausableIpcSource} adds pause, resume and the checked write for
 * the editor's save add-on only; the read-only adapters get the plain source.
 *
 * @module services/freshness/ipcFreshnessSource
 */
import type {
  FreshnessSource,
  PausableSource,
  WatchEventListener
} from '../../../../shared/freshness/freshnessTypes'
import { FileWatchSubscriptionEventSchema } from '../../../../shared/ipc/file-watch-schema'
import type { FileWatchBridge } from '../../../../shared/ipc/file-watch-schema'
import { fileWatchGateway } from '../fileWatchGateway'
import { logger } from '../../utils/logger'

/** The bridge slice the source reads. */
export type FreshnessBridge = Pick<
  FileWatchBridge,
  'subscribe' | 'unsubscribe' | 'probe' | 'readText' | 'onEvent' | 'pauseWatch' | 'resumeWatch' | 'writeText'
>

/** A freshness source over the IPC bridge. */
export function createIpcFreshnessSource(bridge: FreshnessBridge = fileWatchGateway): FreshnessSource {
  const listeners = new Set<WatchEventListener>()
  let stopBridge: (() => void) | null = null

  const dispatch = (raw: unknown): void => {
    const parsed = FileWatchSubscriptionEventSchema.safeParse(raw)
    if (!parsed.success) {
      logger.warn('Dropped a malformed file-watch event')
      return
    }
    for (const listener of [...listeners]) {
      try {
        listener(parsed.data)
      } catch (error) {
        logger.error('File-watch event listener failed', error instanceof Error ? error : undefined)
      }
    }
  }

  return {
    subscribe: (request) => bridge.subscribe(request),
    unsubscribe: async (watchId) => {
      await bridge.unsubscribe({ watchId })
    },
    probe: (filePath, knownHash) => bridge.probe(knownHash === undefined ? { filePath } : { filePath, knownHash }),
    readText: (filePath) => bridge.readText({ filePath }),
    onEvent: (listener) => {
      listeners.add(listener)
      if (stopBridge === null) stopBridge = bridge.onEvent(dispatch)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && stopBridge !== null) {
          stopBridge()
          stopBridge = null
        }
      }
    }
  }
}

/** The editor's save port: `source` plus pause, resume and the checked write (decision 7). */
export function createPausableIpcSource(
  source: FreshnessSource,
  bridge: FreshnessBridge = fileWatchGateway
): PausableSource {
  return {
    ...source,
    pause: async (watchId) => {
      await bridge.pauseWatch({ watchId })
    },
    resumeWatch: async (watchId) => {
      const reply = await bridge.resumeWatch({ watchId })
      return { missed: reply.missed }
    },
    writeText: (request) => bridge.writeText(request)
  }
}

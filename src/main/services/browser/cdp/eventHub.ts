// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A small typed event hub for the CDP session. A listener that throws is
 * logged and skipped, so one subscriber can never stop protocol processing.
 */
import { logger } from '../../LoggingService'

export class EventHub<Events> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  constructor(private readonly label: string) {}

  /** Subscribes `listener`; returns the unsubscribe function. */
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of [...set] as ((payload: Events[K]) => void)[]) {
      try {
        listener(payload)
      } catch (error) {
        logger.error(`${this.label}: a ${String(event)} listener threw`, error instanceof Error ? error : undefined)
      }
    }
  }
}

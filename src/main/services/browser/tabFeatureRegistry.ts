// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-tab feature list of `BrowserTabService` (spec 025; architecture
 * review "every new per-tab feature needs edits in five places", option A).
 *
 * - {@link TabOutlet}: the tab's events to its owning window, each through
 *   `sendTabEvent` (schema-checked, owner only) – one closure per event kind,
 *   made once per tab.
 * - {@link TabFeatureList}: the features attached to one tab, in attach
 *   order. A strip answer goes to the newest feature first, and the first that
 *   knows the row answers; the site, attached right after the input, is the
 *   last asked, and its "unknown" is final. Detach runs newest first, so a
 *   feature never outlives one it was attached after; a detach that throws is
 *   logged and the rest still run, so one failure leaks nothing else.
 */
import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import {
  ContextMenuEventSchema,
  FindResultEventSchema,
  NoticeEventSchema,
  StripEventSchema,
  TabAddedEventSchema,
  TabStateEventSchema,
  type StripAnswer,
  type TabStateEvent
} from '../../../shared/ipc/browser-tab-schema'
import { TabClosedEventSchema } from '../../../shared/ipc/browser-tab-chrome-schema'
import type { z } from 'zod'
import { redactedLogError } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import type { TabHost } from './BrowserTab'
import type { AnswerResult, StripFields } from './permissions/tabStrip'
import { sendTabEvent } from './tabEventSend'

type Payload<S extends z.ZodType> = z.infer<S>

/** One tab's events to the window that owns it. */
export interface TabOutlet {
  readonly host: TabHost
  strip(event: Payload<typeof StripEventSchema>): void
  notice(event: Payload<typeof NoticeEventSchema>): void
  findResult(event: Payload<typeof FindResultEventSchema>): void
  contextMenu(event: Payload<typeof ContextMenuEventSchema>): void
  tabAdded(event: Payload<typeof TabAddedEventSchema>): void
  tabClosed(event: Payload<typeof TabClosedEventSchema>): void
  state(event: TabStateEvent): void
}

/** The outlet of a tab in `host`. */
export function tabOutlet(host: TabHost): TabOutlet {
  const E = BROWSER_TAB_EVENTS
  return {
    host,
    strip: (event) => sendTabEvent(host, E.strip, StripEventSchema, event),
    notice: (event) => sendTabEvent(host, E.notice, NoticeEventSchema, event),
    findResult: (event) => sendTabEvent(host, E.findResult, FindResultEventSchema, event),
    contextMenu: (event) => sendTabEvent(host, E.contextMenu, ContextMenuEventSchema, event),
    tabAdded: (event) => sendTabEvent(host, E.tabAdded, TabAddedEventSchema, event),
    tabClosed: (event) => sendTabEvent(host, E.tabClosed, TabClosedEventSchema, event),
    state: (event) => sendTabEvent(host, E.state, TabStateEventSchema, event)
  }
}

/** One feature attached to a tab. */
export interface TabFeature {
  /** Its name, for the log of a failed detach. */
  readonly name: string
  /** An answer to one of its strip rows; null when the row is not its own. */
  answerStrip?(requestId: string, answer: StripAnswer, fields?: StripFields): AnswerResult | null
  /** The tab closed: remove its listeners and rows. */
  detach(): void
}

export class TabFeatureList {
  private readonly features: TabFeature[] = []

  add(feature: TabFeature): void {
    this.features.push(feature)
  }

  /** The newest feature that knows the row answers; null when none does. */
  answerStrip(requestId: string, answer: StripAnswer, fields?: StripFields): AnswerResult | null {
    for (let i = this.features.length - 1; i >= 0; i--) {
      const result = this.features[i]!.answerStrip?.(requestId, answer, fields) ?? null
      if (result !== null) return result
    }
    return null
  }

  /** Detach every feature, newest first, once. */
  detachAll(): void {
    for (const feature of this.features.splice(0).reverse()) {
      try {
        feature.detach()
      } catch (error) {
        logger.error('A browser tab feature failed to detach', redactedLogError(error), { feature: feature.name })
      }
    }
  }
}

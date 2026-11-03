// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `window.api.browserTab` – the renderer's side of the built-in browser's tab
 * channels (spec 025, solution design § 8, commit 7). Requests name a
 * main-minted tab id, never a window or a path; events arrive only in the
 * window that owns the tab.
 *
 * @see src/preload/browserTabBridge.ts for the implementation
 * @see src/shared/ipc/browser-tab-channels.ts, browser-tab-schema.ts
 */
import type { z } from 'zod'
import type {
  AnswerStripRequest,
  BoundsAppliedEvent,
  BoundsRequest,
  CreateResponse,
  DevToolsRequestSchema,
  HistoryRequestSchema,
  NavigateRequest,
  NavigateResponse,
  NoticeEvent,
  StripEvent,
  TabAddedEventSchema,
  TabStateEvent
} from './browser-tab-schema'

export type HistoryStep = z.infer<typeof HistoryRequestSchema>['step']
export type DevToolsInspectPoint = NonNullable<z.infer<typeof DevToolsRequestSchema>['inspectAt']>
export type TabAddedEvent = z.infer<typeof TabAddedEventSchema>

export interface BrowserTabBridge {
  /** Open an empty tab for the panel; `{ error }` names why it cannot open (a toast). */
  create(panelId: string): Promise<CreateResponse>
  close(tabId: string): Promise<void>
  /** Load what the user typed or chose; `{ refused }` carries the 025-FR-005 rule. */
  navigate(request: NavigateRequest): Promise<NavigateResponse>
  /** Back, Forward, Reload or Stop (025-FR-003). */
  history(tabId: string, step: HistoryStep): Promise<void>
  /** The page area's rectangle and visibility (fire-and-forget, newest `seq` wins). */
  setBounds(request: BoundsRequest): void
  focusPage(tabId: string): Promise<void>
  /** Toggle DevTools, or open it on the element at `inspectAt` (page CSS px). */
  devTools(tabId: string, inspectAt?: DevToolsInspectPoint): Promise<void>
  onState(callback: (state: TabStateEvent) => void): () => void
  onTabAdded(callback: (event: TabAddedEvent) => void): () => void
  /** Answer a strip row (permission prompt, several-downloads prompt) – 025-FR-019, 025-FR-020. */
  answerStrip(request: AnswerStripRequest): Promise<void>
  /** **Show in folder** for a finished download, by the id its notice carried. */
  showDownload(downloadId: string): Promise<void>
  onStrip(callback: (event: StripEvent) => void): () => void
  onNotice(callback: (event: NoticeEvent) => void): () => void
  /** Main's answer to a `setBounds` push sent with `ack: true` (the native-view guard). */
  onBoundsApplied(callback: (event: BoundsAppliedEvent) => void): () => void
}

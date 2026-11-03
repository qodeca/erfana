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
  CertificateRequestSchema,
  CreateResponse,
  DevToolsRequestSchema,
  FocusEvent,
  FocusOrigin,
  ForwardedKeyEvent,
  HistoryRequestSchema,
  NavigateRequest,
  NavigateResponse,
  NoticeEvent,
  PickEvent,
  StripEvent,
  TabAddedEventSchema,
  TabStateEvent
} from './browser-tab-schema'

export type HistoryStep = z.infer<typeof HistoryRequestSchema>['step']
export type DevToolsInspectPoint = NonNullable<z.infer<typeof DevToolsRequestSchema>['inspectAt']>
export type TabAddedEvent = z.infer<typeof TabAddedEventSchema>
export type CertificateRequest = z.infer<typeof CertificateRequestSchema>

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
  /** **Proceed anyway** (`proceed: true`) or **Back to safety** on the certificate page (025-FR-021). */
  certificate(request: CertificateRequest): Promise<void>
  /** **Show in folder** for a finished download, by the id its notice carried. */
  showDownload(downloadId: string): Promise<void>
  onStrip(callback: (event: StripEvent) => void): () => void
  onNotice(callback: (event: NoticeEvent) => void): () => void
  /** Main's answer to a `setBounds` push sent with `ack: true` (the native-view guard). */
  onBoundsApplied(callback: (event: BoundsAppliedEvent) => void): () => void
  /**
   * Where keyboard focus comes from as it moves into the tab's page; sent
   * before `focusPage` when focus leaves the tab's toolbar, so the first-click
   * rule applies only to focus from outside the tab (ADR 0011 decision 16).
   */
  focusOrigin(tabId: string, from: FocusOrigin): Promise<void>
  /** Whether the tab's toolbar (or another Erfana surface of the tab) has keyboard focus (fire-and-forget). */
  toolbarFocus(tabId: string, focused: boolean): void
  /** The page gained or lost keyboard focus. */
  onFocus(callback: (event: FocusEvent) => void): () => void
  /** A browser or reserved key main took from page or toolbar focus, as a named action (ADR 0011 decision 14). */
  onForwardedKey(callback: (event: ForwardedKeyEvent) => void): () => void
  /** Pick mode on or off, status-slot notes and the pick pipeline's events. */
  onPick(callback: (event: PickEvent) => void): () => void
}

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
  ClearDataRequest,
  ContextActionRequestSchema,
  ContextMenuEventSchema,
  CreateResponse,
  DevToolsRequestSchema,
  FindRequestSchema,
  FindResultEventSchema,
  FocusEvent,
  FocusOrigin,
  ForwardedKeyEvent,
  HistoryRequestSchema,
  NavigateRequest,
  NavigateResponse,
  NoticeEvent,
  PickEvent,
  ClosePickRequestSchema,
  RefineRequest,
  WriteCaptureRequest,
  WriteCaptureResponse,
  TargetStatusResponse,
  StripEvent,
  SuggestResponseSchema,
  TabAddedEventSchema,
  TabStateEvent,
  WidthPresetRequestSchema,
  ZoomRequestSchema
} from './browser-tab-schema'
import type { ClearDataResponse, ForgetResponse, PageClipboardResponse } from './browser-tab-page-schema'
import type { PickActionResponse, PickSurfaceName, StillResponse } from './browser-tab-pick-schema'
import type { NewTabCommandEvent, OpenExternalResponse, TabClosedEvent } from './browser-tab-chrome-schema'

export type ClosePickRequest = z.infer<typeof ClosePickRequestSchema>

export type HistoryStep = z.infer<typeof HistoryRequestSchema>['step']
export type DevToolsInspectPoint = NonNullable<z.infer<typeof DevToolsRequestSchema>['inspectAt']>
export type TabAddedEvent = z.infer<typeof TabAddedEventSchema>
export type CertificateRequest = z.infer<typeof CertificateRequestSchema>
export type FindRequest = z.infer<typeof FindRequestSchema>
export type FindResultEvent = z.infer<typeof FindResultEventSchema>
export type ZoomStep = z.infer<typeof ZoomRequestSchema>['step']
export type WidthPresetChoice = z.infer<typeof WidthPresetRequestSchema>['preset']
export type SuggestResponse = z.infer<typeof SuggestResponseSchema>
export type ContextMenuEvent = z.infer<typeof ContextMenuEventSchema>
export type ContextActionRequest = z.infer<typeof ContextActionRequestSchema>

export interface BrowserTabBridge {
  /** Open an empty tab for the panel; `{ error }` names why it cannot open (a toast). */
  create(panelId: string): Promise<CreateResponse>
  /**
   * Close the tab. The user's close (`byUser`, the default) lets the page ask
   * to stay (025-FR-058); `byUser: false` is Erfana's close of a tab whose
   * editor tab is already gone, which never asks (S-31). Resolves `true` when
   * main holds the tab – the editor tab then goes on `onTabClosed` – and
   * `false` when it does not (nothing will follow).
   */
  close(tabId: string, byUser?: boolean): Promise<boolean>
  /** A tab main held is gone; the renderer removes its editor tab now (commit 18). */
  onTabClosed(callback: (event: TabClosedEvent) => void): () => void
  /** The app menu's **New browser tab** (025-FR-001). */
  onNewTabCommand(callback: (event: NewTabCommandEvent) => void): () => void
  /**
   * **Open in system browser** (025-FR-057): the tab's committed address, or
   * `url`; main allows only `http` and `https` and opens it through the
   * checked external-open path.
   */
  openExternal(tabId: string, url?: string): Promise<OpenExternalResponse>
  /** Load what the user typed or chose; `{ refused }` carries the 025-FR-005 rule. */
  navigate(request: NavigateRequest): Promise<NavigateResponse>
  /**
   * **Open in browser tab** (025-FR-010): load the previewed file at the
   * absolute `filePath` in the tab, from its served folder; the bar shows its
   * `file://` address. `{ refused }` carries the 025-FR-005 reason.
   */
  openLocalFile(tabId: string, filePath: string): Promise<NavigateResponse>
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
  /** **Pick element**: pick mode on or off for the tab; `ok: false` when it did not change (an empty tab, 025-FR-025). */
  pickMode(tabId: string, on: boolean): Promise<PickActionResponse>
  /** Up, Down, **Parent element**, **Child element** or a name of the ancestor path on the held capture (025-FR-027). */
  refine(request: RefineRequest): Promise<PickActionResponse>
  /** The menu or dialog closed (`esc`, `cancel`, …) – or a send succeeded (`sent`): pick mode ends (025-FR-032). */
  closePick(request: ClosePickRequest): Promise<PickActionResponse>
  /**
   * The held capture's surface is now the panel (`menu`) or the instruction
   * dialog: a navigation then closes the panel but keeps the dialog (025-FR-053).
   */
  pickSurface(tabId: string, captureId: string, surface: PickSurfaceName): Promise<PickActionResponse>
  /** The page as a still image (raw BGRA), for a surface drawn over the page area; `{ error }` when none could be taken. */
  still(tabId: string): Promise<StillResponse>
  /** The shell guard, then the capture files: `{ paths }`, `{ guard }` (no file written) or `{ error }` (025-FR-046, 025-FR-061). */
  writeCapture(request: WriteCaptureRequest): Promise<WriteCaptureResponse>
  /** The terminal write failed after the files were written: delete them; the capture stays held (025-FR-046). */
  discardCaptureFiles(tabId: string, captureId: string): Promise<PickActionResponse>
  /** The target terminal's foreground class for the toolbar (025-FR-061). */
  targetStatus(terminalId: string): Promise<TargetStatusResponse>
  /**
   * Find in page (025-FR-008); results arrive as {@link BrowserTabBridge.onFindResult}.
   * `findNext` keeps Electron's meaning: `true` starts a new search (the text
   * changed), `false` moves to the next (`forward`) or previous match.
   */
  find(request: FindRequest): Promise<void>
  /** Close the find bar: the highlights go. */
  stopFind(tabId: string): Promise<void>
  /** "N of M" for the latest find; "0 of 0" when nothing matches. */
  onFindResult(callback: (event: FindResultEvent) => void): () => void
  /** Zoom in, out or back to 100% (025-FR-008); per site, the new level arrives in `state.zoomPercent`. */
  zoom(tabId: string, step: ZoomStep): Promise<void>
  /** A width preset (025-FR-012); the zoom resets to 100%, the new preset arrives in `state.widthPreset`. */
  widthPreset(tabId: string, preset: WidthPresetChoice): Promise<void>
  /** **Clear browsing data** for this window's project (025-FR-023); `failed` names each kind whose step did not finish. */
  clearData(categories: ClearDataRequest['categories']): Promise<ClearDataResponse>
  /** **Forget this project's browser data** after the user confirmed (025-FR-023); closes the project's tabs. */
  forget(): Promise<ForgetResponse>
  /** History rows for typed text, most recent first; every row for `''` (the empty tab shows 8) – 025-FR-063. */
  suggest(prefix: string): Promise<SuggestResponse>
  /** The page right-click menu to draw: its id, items, link origin and point (025-FR-057). */
  onContextMenu(callback: (event: ContextMenuEvent) => void): () => void
  /** Run one item of the live menu `menuId`; main checks it is one the menu offered. */
  contextAction(request: ContextActionRequest): Promise<void>
  /** Whether a browser page wrote the clipboard's text (025-FR-009, S-17); main reads the clipboard itself. */
  pageClipboard(): Promise<PageClipboardResponse>
}

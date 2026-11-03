// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser IPC payload schemas (spec 025, solution design § 8 and
 * § 3.4; naming contract "IPC payload schemas"). zod v4.
 * Every object is `.strict()`, every string and list is capped and every
 * number bounded (zod 4's `z.number()` already refuses `NaN` and `±Infinity`).
 * Requests name main-minted ids (tab, capture, strip request, menu,
 * certificate decision) – never a project path or a window; main resolves
 * the project from the sender's window. A request's `source` can never be
 * `page`: page-started navigations and tabs are created in main (§ 3.4).
 * @see src/shared/ipc/browser-tab-channels.ts for the channel names
 */
import { z } from 'zod'
import { TerminalIdSchema } from './terminal-schema'
import { PanelIdSchema } from './preview-schema'
import { CertificateWarningSchema, SignInRowSchema } from './browser-tab-site-schema'
import { LoadErrorPageSchema } from './browser-tab-page-schema'

/** Longest address or typed input accepted, in UTF-16 code units (Chromium's display cap is 2 MB; this is the bar's). */
export const BROWSER_URL_MAX_CHARS = 8192
/** Longest find text. */
export const BROWSER_FIND_MAX_CHARS = 1000
/** Longest local file path. */
export const BROWSER_PATH_MAX_CHARS = 32_767
/** Longest page title sent to the renderer (already cleaned in main, design § 3.5). */
export const BROWSER_TITLE_MAX_CHARS = 200
/** Largest site icon sent to the renderer: a PNG of at most 32 px (design § 3.5). */
export const BROWSER_ICON_MAX_BYTES = 64 * 1024
/** Largest still image sent to the renderer (a downscaled raw bitmap, design § 6.1). */
export const BROWSER_STILL_MAX_BYTES = 64 * 1024 * 1024
/** Longest display text of a strip row, notice or label. */
export const BROWSER_TEXT_MAX_CHARS = 2000
/** Most history suggestions per answer (025-FR-063 keeps 100 addresses). */
export const BROWSER_SUGGEST_MAX_ROWS = 100
/** Largest pixel coordinate or size accepted. */
const BROWSER_MAX_PX = 100_000

/** A tab id: `browser-tab-<counter>`, assigned by main. */
export const BrowserTabIdSchema = z.string().regex(/^browser-tab-\d{1,9}$/, 'Invalid browser tab id')
/** A capture id: 128 random bits as lower-case hex, minted by main at confirm. */
export const CaptureIdSchema = z.string().regex(/^[0-9a-f]{32}$/, 'Invalid capture id')
/** An opaque main-minted id for a strip request, a context menu or a certificate decision. */
export const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id')

const urlString = z.string().min(1).max(BROWSER_URL_MAX_CHARS)
const text = z.string().max(BROWSER_TEXT_MAX_CHARS)
const px = z.number().min(-BROWSER_MAX_PX).max(BROWSER_MAX_PX)
const size = z.number().min(0).max(BROWSER_MAX_PX)
const count = z.number().int().min(0).max(1_000_000)

export const BrowserRectSchema = z.object({ x: px, y: px, width: size, height: size }).strict()
export type BrowserRect = z.infer<typeof BrowserRectSchema>

/**
 * Every navigation source (design § 3.4). `page` is set only in main, for a
 * navigation or tab the page started; it is never accepted from the renderer.
 */
export const NavigationSourceSchema = z.enum([
  'address',
  'history',
  'reload',
  'back',
  'forward',
  'terminalLink',
  'previewOpen',
  'contextMenuLink',
  'page'
])
export type NavigationSource = z.infer<typeof NavigationSourceSchema>

/** The sources `navigate` accepts: typed or chosen addresses and links the user clicked. */
export const NavigateSourceSchema = z.enum(['address', 'history', 'terminalLink', 'contextMenuLink'])

const tabOnly = z.object({ tabId: BrowserTabIdSchema }).strict()

export const CreateRequestSchema = z.object({ panelId: PanelIdSchema }).strict()
export const CreateResponseSchema = z.union([
  z.object({ tabId: BrowserTabIdSchema }).strict(),
  z.object({ error: text }).strict()
])
/** `byUser: false` – the editor tab is already gone (Erfana's close): no leave-page prompt (S-31). */
export const CloseRequestSchema = z.object({ tabId: BrowserTabIdSchema, byUser: z.boolean().optional() }).strict()
export const NavigateRequestSchema = z
  .object({ tabId: BrowserTabIdSchema, input: urlString, source: NavigateSourceSchema })
  .strict()
/** `navigate` answer: loaded, or refused by 025-FR-005 with the address-bar rule number. */
export const NavigateResponseSchema = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ refused: z.enum(['scheme', 'network-path', 'app-entry', 'local-file']) }).strict(),
  z.object({ error: text }).strict()
])
export const OpenLocalFileRequestSchema = z
  .object({ tabId: BrowserTabIdSchema, filePath: z.string().min(1).max(BROWSER_PATH_MAX_CHARS) })
  .strict()
export const HistoryRequestSchema = z.object({ tabId: BrowserTabIdSchema, step: z.enum(['back', 'forward', 'reload', 'stop']) }).strict()
/** `bounds` (send): the page area; main drops `seq` ≤ the last applied, as the preview does. */
export const BoundsRequestSchema = z
  .object({
    tabId: BrowserTabIdSchema,
    bounds: BrowserRectSchema,
    seq: z.number().int().nonnegative(),
    ack: z.boolean(),
    visible: z.boolean(),
    /** The clipping parent's rectangle (the panel), for presets wider than it (ADR 0011 decision 6). */
    clip: BrowserRectSchema
  })
  .strict()
export const FocusPageRequestSchema = tabOnly
/** Where keyboard focus came from when it entered the tab (first-click rule, ADR 0011 decision 16). */
export const FocusOriginRequestSchema = z
  .object({ tabId: BrowserTabIdSchema, from: z.enum(['outside', 'toolbar']) })
  .strict()
export const ToolbarFocusRequestSchema = z.object({ tabId: BrowserTabIdSchema, focused: z.boolean() }).strict()
export const FindRequestSchema = z
  .object({
    tabId: BrowserTabIdSchema,
    text: z.string().min(1).max(BROWSER_FIND_MAX_CHARS),
    forward: z.boolean(),
    findNext: z.boolean()
  })
  .strict()
export const StopFindRequestSchema = tabOnly
export const ZoomRequestSchema = z.object({ tabId: BrowserTabIdSchema, step: z.enum(['in', 'out', 'reset']) }).strict()
export const WidthPresetRequestSchema = z.object({ tabId: BrowserTabIdSchema, preset: z.enum(['phone', 'tablet', 'full']) }).strict()
export const DevToolsRequestSchema = z
  .object({ tabId: BrowserTabIdSchema, inspectAt: z.object({ x: px, y: px }).strict().optional() })
  .strict()
/** The current address, or the link of the open context menu; main re-checks it on the external-open path. */
export const OpenExternalRequestSchema = z.object({ tabId: BrowserTabIdSchema, url: urlString.optional() }).strict()
export const PickModeRequestSchema = z.object({ tabId: BrowserTabIdSchema, on: z.boolean() }).strict()
export const RefineRequestSchema = z
  .object({
    tabId: BrowserTabIdSchema,
    captureId: CaptureIdSchema,
    move: z.union([
      z.enum(['parent', 'child']),
      z.object({ ancestor: z.number().int().min(0).max(10_000) }).strict()
    ])
  })
  .strict()
export const ClosePickRequestSchema = z
  .object({
    tabId: BrowserTabIdSchema,
    captureId: CaptureIdSchema,
    reason: z.enum(['esc', 'cancel', 'clickOutside', 'toolbar', 'focusLeft', 'tabHidden', 'sent'])
  })
  .strict()

/**
 * `writeCapture` (design § 6.2): main runs the shell guard on `terminalId`
 * first. `sendAnyway` answers a wrapper or unknown banner (S-23); it never
 * passes a shell or a missing terminal.
 */
export const WriteCaptureRequestSchema = z
  .object({
    tabId: BrowserTabIdSchema,
    captureId: CaptureIdSchema,
    terminalId: TerminalIdSchema,
    sendAnyway: z.literal(true).optional()
  })
  .strict()
const projectPath = z.string().min(1).max(BROWSER_PATH_MAX_CHARS)
/** What the guard found when it refused (025-FR-061, S-23). */
export const CaptureGuardSchema = z
  .object({ kind: z.enum(['shell', 'wrapper', 'unknown', 'noTerminal']), process: text.nullable() })
  .strict()
export const WriteCaptureResponseSchema = z.union([
  z.object({ paths: z.object({ context: projectPath, screenshot: projectPath, crop: projectPath }).strict() }).strict(),
  z.object({ guard: CaptureGuardSchema }).strict(),
  z.object({ error: text }).strict()
])
export const DiscardCaptureFilesRequestSchema = z
  .object({ tabId: BrowserTabIdSchema, captureId: CaptureIdSchema })
  .strict()
export const TargetStatusRequestSchema = z.object({ terminalId: TerminalIdSchema }).strict()
export const TargetStatusResponseSchema = z
  .object({ kind: z.enum(['agent', 'shell', 'wrapper', 'unknown']), process: text.nullable(), fresh: z.boolean() })
  .strict()

/** Answers to strip rows (025-FR-011, 019, 020, 022, 056, 058, 018). */
export const StripAnswerSchema = z.enum([
  'allow',
  'allowOnce',
  'alwaysAllow',
  'block',
  'dismiss',
  'signIn',
  'cancel',
  'ok',
  'leave',
  'stay',
  'wait',
  'reload'
])
/** Fields a strip row may return: a sign-in box, a page `prompt()`, the dialog checkbox. */
export const StripFieldsSchema = z
  .object({
    username: z.string().max(1024).optional(),
    password: z.string().max(1024).optional(),
    remember: z.boolean().optional(),
    promptText: z.string().max(BROWSER_TEXT_MAX_CHARS).optional(),
    suppressDialogs: z.boolean().optional()
  })
  .strict()
export const AnswerStripRequestSchema = z
  .object({
    tabId: BrowserTabIdSchema,
    requestId: OpaqueIdSchema,
    answer: StripAnswerSchema,
    fields: StripFieldsSchema.optional()
  })
  .strict()
/** The page right-click menu's items (025-FR-057). */
export const ContextActionSchema = z.enum([
  'back',
  'forward',
  'reload',
  'copy',
  'paste',
  'selectAll',
  'openLinkInNewTab',
  'openLinkInSystemBrowser',
  'copyLinkAddress',
  'copyImage',
  'openImageInNewTab',
  'pickThisElement',
  'inspect'
])
export const ContextActionRequestSchema = z
  .object({ tabId: BrowserTabIdSchema, menuId: OpaqueIdSchema, action: ContextActionSchema })
  .strict()
/** **Proceed anyway** or **Back to safety**; main enforces the 500 ms input guard too. */
export const CertificateRequestSchema = z
  .object({ tabId: BrowserTabIdSchema, decisionId: OpaqueIdSchema, proceed: z.boolean() })
  .strict()
/** The five checkboxes of **Clear browsing data** (025-FR-023); at least one is ticked. */
export const ClearDataRequestSchema = z
  .object({
    categories: z
      .object({
        cookies: z.boolean(),
        cache: z.boolean(),
        permissions: z.boolean(),
        credentials: z.boolean(),
        captures: z.boolean()
      })
      .strict()
      .refine(c => Object.values(c).some(Boolean), 'Tick at least one kind of data')
  })
  .strict()
export const ForgetRequestSchema = z.object({}).strict()
export const SuggestRequestSchema = z.object({ prefix: z.string().max(BROWSER_URL_MAX_CHARS) }).strict()
export const SuggestResponseSchema = z
  .object({ rows: z.array(z.object({ url: urlString }).strict()).max(BROWSER_SUGGEST_MAX_ROWS) })
  .strict()

/** **Show in folder** on a finished download's notice; the id is the notice's, valid in the window it went to. */
export const ShowDownloadRequestSchema = z.object({ downloadId: OpaqueIdSchema }).strict()

export const PopupStripRequestSchema = z.object({}).strict()
export const PopupAnswerRequestSchema = z
  .object({ requestId: OpaqueIdSchema, answer: StripAnswerSchema, fields: StripFieldsSchema.optional() })
  .strict()
export const PopupCloseRequestSchema = z.object({}).strict()

export type CreateRequest = z.infer<typeof CreateRequestSchema>
export type CreateResponse = z.infer<typeof CreateResponseSchema>
export type NavigateRequest = z.infer<typeof NavigateRequestSchema>
export type NavigateResponse = z.infer<typeof NavigateResponseSchema>
export type BoundsRequest = z.infer<typeof BoundsRequestSchema>
export type RefineRequest = z.infer<typeof RefineRequestSchema>
export type WriteCaptureRequest = z.infer<typeof WriteCaptureRequestSchema>
export type WriteCaptureResponse = z.infer<typeof WriteCaptureResponseSchema>
export type TargetStatusResponse = z.infer<typeof TargetStatusResponseSchema>
export type AnswerStripRequest = z.infer<typeof AnswerStripRequestSchema>
export type StripAnswer = z.infer<typeof StripAnswerSchema>
export type ClearDataRequest = z.infer<typeof ClearDataRequestSchema>
export type FocusOrigin = z.infer<typeof FocusOriginRequestSchema>['from']

// ── Events (main → the owning window) ────────────────────────────────────────

const bytes = (max: number): z.ZodType<Uint8Array> =>
  z.instanceof(Uint8Array).refine(b => b.byteLength <= max, `At most ${max} bytes`)

/**
 * The address split for display by main's formatter (`originFormat.ts`), so the
 * renderer never needs the public-suffix list (design OD-1).
 */
export const OriginPartsSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('web'),
      scheme: z.literal('http').nullable(),
      subdomain: text,
      registrableDomain: text,
      port: z.string().regex(/^\d{1,5}$/).nullable(),
      punycode: z.boolean()
    })
    .strict(),
  z.object({ kind: z.literal('file') }).strict(),
  z.object({ kind: z.literal('nonWeb'), scheme: z.string().max(64) }).strict()
])

/** The address bar's badge state (design § Address bar). */
export const SecurityStateSchema = z.enum([
  'secure',
  'local',
  'file',
  'notSecureHttp',
  'warningUp',
  'proceeded',
  'subresourceFailed'
])
/** Erfana's own pages, drawn in DOM in the page area (ADR 0011 decision 5). */
export const ErfanaPageSchema = z.enum(['empty', 'certificate', 'loadError', 'crashed'])

/** `state`: what the toolbar and the editor tab show. `icon` is absent when unchanged. */
export const TabStateEventSchema = z
  .object({
    tabId: BrowserTabIdSchema,
    committedUrl: urlString.nullable(),
    /** Shown only for a navigation the user started (025-FR-002). */
    pendingUrl: urlString.nullable(),
    origin: OriginPartsSchema.nullable(),
    title: z.string().max(BROWSER_TITLE_MAX_CHARS),
    icon: bytes(BROWSER_ICON_MAX_BYTES).nullable().optional(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    loading: z.boolean(),
    zoomPercent: z.number().int().min(25).max(500),
    widthPreset: z.enum(['phone', 'tablet', 'full']),
    security: SecurityStateSchema,
    inUse: z.object({ camera: z.boolean(), microphone: z.boolean(), screen: z.boolean() }).strict(),
    erfanaPage: ErfanaPageSchema.nullable(),
    certificate: CertificateWarningSchema.optional(), // the warning page's parts, with `erfanaPage: 'certificate'` (025-FR-021)
    loadError: LoadErrorPageSchema.optional(), // the load-error page's parts, with `erfanaPage: 'loadError'` (025-FR-059)
    devToolsOpen: z.boolean()
  })
  .strict()
export const FocusEventSchema = z.object({ tabId: BrowserTabIdSchema, pageFocused: z.boolean() }).strict()

/** Keys main handled from page focus and hands to the renderer as named actions (ADR 0011 decision 14). */
export const ForwardedKeyActionSchema = z.enum([
  'focusAddress',
  'reload',
  'closeTab',
  'newTab',
  'back',
  'forward',
  'devTools',
  'find',
  'nextEditorTab',
  'previousEditorTab',
  'focusNextZone',
  'focusPreviousZone',
  'focusPanel'
])
export const ForwardedKeyEventSchema = z
  .object({ tabId: BrowserTabIdSchema, action: ForwardedKeyActionSchema })
  .strict()

/** The picked element as the menu header shows it (025-FR-026, 025-FR-027). */
const PickSummarySchema = z
  .object({
    name: z.string().max(200),
    size: z.string().max(40),
    ancestors: z.array(z.string().max(200)).max(1000),
    box: BrowserRectSchema,
    atTop: z.boolean(),
    atStart: z.boolean(),
    gone: z.boolean(),
    changedAfterPick: z.boolean()
  })
  .strict()
const pickBase = { tabId: BrowserTabIdSchema }
export const PickEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...pickBase, kind: z.literal('mode'), on: z.boolean() }).strict(),
  z.object({ ...pickBase, kind: z.literal('highlight'), label: z.string().max(200).nullable() }).strict(),
  z
    .object({
      ...pickBase,
      kind: z.literal('note'),
      note: z.enum(['loadAPage', 'moveTheMouse', 'pageMoved', 'topOfPage', 'backAtStart', 'elementGone'])
    })
    .strict(),
  z.object({ ...pickBase, kind: z.literal('capturing') }).strict(),
  z
    .object({
      ...pickBase,
      kind: z.literal('captured'),
      captureId: CaptureIdSchema,
      still: bytes(BROWSER_STILL_MAX_BYTES),
      stillWidth: z.number().int().min(1).max(BROWSER_MAX_PX),
      stillHeight: z.number().int().min(1).max(BROWSER_MAX_PX),
      summary: PickSummarySchema
    })
    .strict(),
  z.object({ ...pickBase, kind: z.literal('captureFailed'), reason: text }).strict(),
  z.object({ ...pickBase, kind: z.literal('refined'), captureId: CaptureIdSchema, summary: PickSummarySchema }).strict(),
  z.object({ ...pickBase, kind: z.literal('frozen'), captureId: CaptureIdSchema }).strict(),
  z
    .object({
      ...pickBase,
      kind: z.literal('ended'),
      reason: z.enum(['user', 'sent', 'navigated', 'pageChanged', 'hidden', 'crashed', 'hung', 'closed'])
    })
    .strict()
])

/** The site permissions a prompt can name (025-FR-019). */
export const SitePermissionSchema = z.enum(['camera', 'microphone', 'screen', 'location', 'notifications', 'clipboardRead'])

/** A strip row (025-FR-054); its text is composed by main from fixed strings and formatted origins. */
export const StripRowSchema = z
  .object({
    requestId: OpaqueIdSchema,
    kind: z.enum([
      'permission',
      'popupBlocked',
      'download',
      'signIn',
      'pageDialog',
      'leavePage',
      'hung',
      'keyring',
      'fullscreen',
      'pointerLock'
    ]),
    text,
    answers: z.array(StripAnswerSchema).max(StripAnswerSchema.options.length),
    takesFocus: z.boolean(),
    /** The origin line, from the engine: the asker, and the top page when a frame asks (025-FR-019). */
    requester: z.object({ origin: OriginPartsSchema, inside: OriginPartsSchema.nullable() }).strict().optional(),
    /** What a `permission` row asks for. */
    permissions: z.array(SitePermissionSchema).min(1).max(SitePermissionSchema.options.length).optional(),
    /** Requests of the same kind queued behind this row ("+1 waiting"). */
    waiting: count.optional(),
    /** Whether Allow and Block are kept in the profile, for this run only (no keyring, S-26), or never (screen sharing). */
    remembered: z.enum(['saved', 'session', 'never']).optional(),
    signIn: SignInRowSchema.optional(), // a `signIn` row's pre-fill, notices and Remember state (025-FR-022)
    /** Main-clock ms when the row appeared or last changed; main ignores answers within the 500 ms input guard. */
    shownAt: z.number().nonnegative().optional()
  })
  .strict()
export const StripEventSchema = z.discriminatedUnion('op', [
  z.object({ tabId: BrowserTabIdSchema, op: z.literal('add'), row: StripRowSchema }).strict(),
  z.object({ tabId: BrowserTabIdSchema, op: z.literal('change'), row: StripRowSchema }).strict(),
  z.object({ tabId: BrowserTabIdSchema, op: z.literal('withdraw'), requestId: OpaqueIdSchema }).strict(),
  z.object({ tabId: BrowserTabIdSchema, op: z.literal('held'), count: count }).strict()
])
export const TabAddedEventSchema = z
  .object({ tabId: BrowserTabIdSchema, openerTabId: BrowserTabIdSchema, background: z.boolean() })
  .strict()
export const ContextMenuEventSchema = z
  .object({
    tabId: BrowserTabIdSchema,
    menuId: OpaqueIdSchema,
    items: z.array(ContextActionSchema).max(ContextActionSchema.options.length),
    linkOrigin: OriginPartsSchema.nullable(),
    at: z.object({ x: px, y: px }).strict()
  })
  .strict()
export const NoticeEventSchema = z
  .object({
    tabId: BrowserTabIdSchema.nullable(),
    kind: z.enum(['downloadDone', 'downloadFailed', 'pageChanged', 'localAddressSeen', 'error']),
    text,
    /** A download notice's parts (025-FR-020): `downloadId` for **Show in folder** on `downloadDone`; `reason` on `downloadFailed`. */
    download: z
      .object({
        fileName: text,
        downloadId: OpaqueIdSchema.nullable(),
        reason: z.enum(['interrupted', 'folderNotWritable', 'diskFull', 'refusedFolder']).nullable()
      })
      .strict()
      .optional()
  })
  .strict()
/** `boundsApplied`: the applied push's `seq` and whether the page is now shown. */
export const BoundsAppliedEventSchema = z
  .object({ tabId: BrowserTabIdSchema, seq: z.number().int().nonnegative(), visible: z.boolean() })
  .strict()
export const FindResultEventSchema = z
  .object({ tabId: BrowserTabIdSchema, active: count, total: count })
  .strict()
  .refine(r => r.active <= r.total, 'active match beyond total')

export type OriginPartsPayload = z.infer<typeof OriginPartsSchema>
export type TabStateEvent = z.infer<typeof TabStateEventSchema>
export type PickEvent = z.infer<typeof PickEventSchema>
export type StripEvent = z.infer<typeof StripEventSchema>
export type StripRow = z.infer<typeof StripRowSchema>
export type NoticeEvent = z.infer<typeof NoticeEventSchema>
export type BoundsAppliedEvent = z.infer<typeof BoundsAppliedEventSchema>
export type FocusEvent = z.infer<typeof FocusEventSchema>
export type ForwardedKeyAction = z.infer<typeof ForwardedKeyActionSchema>
export type ForwardedKeyEvent = z.infer<typeof ForwardedKeyEventSchema>
export type SitePermission = z.infer<typeof SitePermissionSchema>

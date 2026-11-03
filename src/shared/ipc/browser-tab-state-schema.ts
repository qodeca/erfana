// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The tab state event (`browser-tab:state`, spec 025 solution design § 8):
 * what the toolbar and the editor tab show, with the address split for
 * display, the badge state and Erfana's own pages. Re-exported from
 * `browser-tab-schema.ts`.
 */
import { z } from 'zod'
import { BROWSER_ICON_MAX_BYTES, BROWSER_TITLE_MAX_CHARS, BrowserTabIdSchema, bytes, text, urlString } from './browser-tab-base-schema'
import { LoadErrorPageSchema } from './browser-tab-page-schema'
import { CertificateWarningSchema } from './browser-tab-site-schema'

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

export type OriginPartsPayload = z.infer<typeof OriginPartsSchema>
export type TabStateEvent = z.infer<typeof TabStateEventSchema>
/** The page's camera, microphone and screen capture, for the address bar's in-use chips (025-FR-019). */
export type TabMediaInUse = TabStateEvent['inUse']

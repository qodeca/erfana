// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Versioned `.erfana/settings.json` HTML-preview allowlist schema (Issue #74,
 * work item 10; design §3.1).
 *
 * The allowlist is a one-way door: hosts the user has approved for remote
 * subresource loads inside a previewed page. It is deliberately NOT part of
 * `ProjectSettingsSchema` (§3.1, X1) — a clone-delivered bad host must never
 * block project load. `isApprovableHost` is applied on BOTH the read and the
 * write path (design §3.2/§3.3) so a non-approvable host can never be
 * persisted nor loaded into the live set.
 *
 * zod v4: `z.enum`/`z.literal`; `z.nativeEnum` is deprecated and unused.
 */
import { z } from 'zod'

/** On-disk allowlist schema version. Fail closed on any other value (§3.2). */
export const PREVIEW_ALLOWLIST_VERSION = 1

/** Hard cap on approved hosts; a larger set aborts with `PREVIEW_ALLOWLIST_FULL`. */
export const MAX_ALLOWLIST_HOSTS = 200

/**
 * True unless `host` is a form that must never be approvable: an IPv4 or IPv6
 * literal (including bracketed and hex/octal shorthands), an all-numeric label
 * set, `localhost`, any `*.localhost` / `*.local` / `*.internal` name, or a bare
 * single-label name (which a DNS search domain can resolve to an internal
 * service — an SSRF surface) — and never a value carrying a `\r` or `\n` (CSP /
 * header-injection guard).
 *
 * Pure and dependency-free so it can run in both the main and renderer bundles.
 */
export function isApprovableHost(host: string): boolean {
  // Control characters could break out of a CSP directive or a header line.
  if (/[\r\n]/.test(host)) return false

  const lower = host.toLowerCase()

  // IPv6 literals (bare or bracketed) always contain a colon or a bracket.
  if (lower.includes(':') || lower.includes('[') || lower.includes(']')) return false

  // Loopback / link-local / private-use names.
  if (lower === 'localhost') return false
  if (lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
    return false
  }

  const labels = lower.split('.')

  // A bare single-label name (e.g. `intranet`, `wiki`) can resolve to an internal
  // service via a DNS search domain — refuse anything without a registrable
  // (dotted) domain shape.
  if (labels.length < 2) return false

  // IPv4 dotted-decimal literal, e.g. 127.0.0.1.
  if (labels.length === 4 && labels.every((label) => /^\d{1,3}$/.test(label))) return false

  // Any all-numeric label set: a bare decimal like 2130706433 or a shorthand
  // IPv4 form such as 1.1.
  if (labels.every((label) => /^\d+$/.test(label))) return false

  // Hex / octal IPv4 shorthands, e.g. 0x7f.1.
  if (labels.some((label) => /^0x[\da-f]+$/.test(label))) return false

  // Every label must be a real DNS label: alphanumeric, inner hyphens only.
  //
  // Without this the predicate was WIDER than `PreviewHostSchema`, the regex
  // that actually gates the write. A trailing dot (`example.com.`, whose last
  // label is empty) or an underscore (`foo_bar.com`) passed here and failed
  // there, so the reader was offered an Approve button for a host the boundary
  // then refused — and the renderer discards that refusal, so the toast simply
  // dismissed and the decision looked made. The two must agree.
  if (lower.length > 253) return false
  if (!labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false

  return true
}

/**
 * A single approvable host. The regex admits no space, `;`, `'`, `"`, `,`,
 * `\r` or `\n`, so a value that passes cannot carry a CSP delimiter; the
 * `isApprovableHost` refinement then removes IP literals and loopback names.
 */
export const PreviewHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/)
  .refine(isApprovableHost, { message: 'host is not approvable' })

/** The versioned allowlist block persisted under `htmlPreview.allowlist`. */
export const PreviewAllowlistSchema = z.object({
  version: z.literal(PREVIEW_ALLOWLIST_VERSION),
  hosts: z.array(PreviewHostSchema).max(MAX_ALLOWLIST_HOSTS).default([])
})

export type PreviewAllowlist = z.infer<typeof PreviewAllowlistSchema>
export type PreviewHost = z.infer<typeof PreviewHostSchema>

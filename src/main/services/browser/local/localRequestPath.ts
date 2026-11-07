// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The path part of a local-file server request, checked before any file
 * system call (spec 025, 025-FR-005 rule 1; ADR 0012 decision 8, option 4).
 *
 * The raw path below the server's token is split on `/` and each segment is
 * decoded exactly once. Refused before decoding: an encoded separator or NUL
 * (`%2f`, `%5c`, `%00`), a raw backslash, an empty segment (a folder address –
 * there are no listings). Refused after decoding, per segment: `.`, `..`, a
 * separator or NUL, a control character, a `:` (Windows alternate data
 * streams and drive letters), a trailing dot or space, a reserved Windows
 * device name (on every platform, so the rule is the same everywhere), an 8.3
 * short-name alias on Windows, a dot-prefixed name (dot-files and
 * dot-folders, `.erfana/` first of all) and an `.asar` archive (Electron's
 * `fs` reads inside one as if it were a folder).
 *
 * Pure: the real-path confinement that follows is `localConfinedFile.ts`.
 */
import { isSafeSegment } from '../../preview/previewPathResolve'

/** 400 for a malformed path, 403 for a well-formed name that is never served. */
export type LocalPathRefusal = 400 | 403

export type LocalRequestPath =
  | { readonly ok: true; readonly segments: readonly string[] }
  | { readonly ok: false; readonly status: LocalPathRefusal }

/** Percent-encoded `/`, `\` and NUL: decoding them would smuggle a separator into one segment. */
const ENCODED_SEPARATOR = /%(?:2f|5c|00)/i
/** C0 controls and DEL. */
// eslint-disable-next-line no-control-regex -- the point is to match control characters
const CONTROL = /[\u0000-\u001f\u007f]/
/** Windows device names, with or without an extension (`CON`, `nul.txt`, `COM1`, `LPT¹`). */
const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i

/**
 * Whether a file or folder name is never served even when it is well formed:
 * a dot-prefixed name or an `.asar` archive. Also run on the resolved path,
 * so a link cannot reach one under another name.
 */
export function isRefusedName(name: string): boolean {
  return name.startsWith('.') || name.toLowerCase().endsWith('.asar')
}

function malformed(segment: string, platform: NodeJS.Platform): boolean {
  return (
    !isSafeSegment(segment, platform) ||
    CONTROL.test(segment) ||
    segment.includes(':') ||
    /[. ]$/.test(segment) ||
    RESERVED_WINDOWS_NAME.test(segment)
  )
}

/**
 * Check and decode the raw request path below the token (no leading `/`, no
 * query). `platform` is threaded through for the Windows short-name rule.
 */
export function parseLocalRequestPath(raw: string, platform: NodeJS.Platform = process.platform): LocalRequestPath {
  if (raw === '') return { ok: false, status: 403 }
  if (ENCODED_SEPARATOR.test(raw) || raw.includes('\\')) return { ok: false, status: 400 }
  const segments: string[] = []
  for (const part of raw.split('/')) {
    if (part === '') return { ok: false, status: 403 }
    let decoded: string
    try {
      decoded = decodeURIComponent(part)
    } catch {
      return { ok: false, status: 400 }
    }
    if (malformed(decoded, platform)) return { ok: false, status: 400 }
    if (isRefusedName(decoded)) return { ok: false, status: 403 }
    segments.push(decoded)
  }
  return { ok: true, segments }
}

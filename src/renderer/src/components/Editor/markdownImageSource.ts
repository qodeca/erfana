// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the Markdown preview does with an image `src` (#71).
 *
 * The preview's page is the app bundle, so a `src` handed to the DOM as written
 * resolves against the bundle: `./assets/icon.svg` never loaded (it pointed
 * into the app's own folder), and a rooted or protocol-relative `src` named a
 * place outside the project altogether. So a `src` is never passed through
 * unless it is a remote address:
 *
 * - `remote`   – `http:` / `https:`: kept exactly as before; the page's CSP
 *                decides, and nothing here fetches it;
 * - `relative` – a path relative to the document: its bytes are read by the
 *                main process, confined to the project, and shown as a
 *                `data:` URL (see `markdownImageStore.ts`);
 * - `blocked`  – anything else: an absolute or rooted path, a drive or UNC
 *                path, a protocol-relative address, `file:` and every other
 *                scheme. Shown as the alt text, never loaded.
 *
 * Pure string work; the sanitizer upstream already drops non-http(s) schemes,
 * and this is the second, independent check.
 *
 * @module components/Editor/markdownImageSource
 */

/** How the preview treats one image `src`. */
export type MarkdownImageSource =
  | { kind: 'remote' }
  | { kind: 'relative'; path: string }
  | { kind: 'blocked' }

const REMOTE = /^https?:/i
const ANY_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
const ROOTED = /^[\\/]/

const BLOCKED: MarkdownImageSource = { kind: 'blocked' }
const REMOTE_SOURCE: MarkdownImageSource = { kind: 'remote' }

/**
 * Classify an image `src` as written in the document.
 *
 * @param src - The `src` attribute after sanitizing (may be undefined)
 * @returns `remote`, `relative` with a decoded '/'-separated path, or `blocked`
 *
 * @example
 * classifyImageSource('./assets/a%20b.png') // { kind: 'relative', path: './assets/a b.png' }
 * classifyImageSource('https://x.test/a.png') // { kind: 'remote' }
 * classifyImageSource('/etc/a.png')           // { kind: 'blocked' }
 */
export function classifyImageSource(src: string | undefined): MarkdownImageSource {
  const raw = (src ?? '').trim()
  if (raw === '') return BLOCKED
  if (REMOTE.test(raw)) return REMOTE_SOURCE
  if (ANY_SCHEME.test(raw) || ROOTED.test(raw)) return BLOCKED

  // A query or fragment means nothing to a file on disk
  const pathPart = raw.replace(/[?#].*$/, '')
  if (pathPart === '') return BLOCKED

  let decoded: string
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    return BLOCKED
  }
  // Checked again after decoding, so an escaped scheme or root cannot pass
  if (decoded.includes('\0') || ANY_SCHEME.test(decoded) || ROOTED.test(decoded)) return BLOCKED

  return { kind: 'relative', path: decoded.replace(/\\/g, '/') }
}


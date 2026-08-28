// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload for the SEALED preview page (sd-074b §5.1).
 *
 * Its entire job is to notice that a link was clicked and tell main. It exposes
 * NOTHING: there is no `contextBridge` call in this file, so the page's own
 * JavaScript gains no new capability and cannot reach `ipcRenderer` — that lives
 * in the isolated preload world, which `contextIsolation: true` keeps separate.
 *
 * WHY A PRELOAD IS NEEDED AT ALL. The page's CSP sandbox has no `allow-popups`,
 * so `target="_blank"`, named targets and middle-clicks are killed by Blink
 * before any Electron event fires — `setWindowOpenHandler` never sees them.
 * `will-navigate` covers plain same-tab clicks and stays wired as the fallback,
 * but only a DOM listener sees the whole set, plus the modifier keys, the
 * `download` attribute, and whether the click was a real user gesture.
 *
 * IT NEVER CALLS `preventDefault()`. Two reasons. The page's own handlers must
 * win — a preload listener is registered before any page script, so among
 * document-level listeners this one runs FIRST, and cancelling here would hijack
 * clicks an app router was about to handle. And it does not need to: the
 * navigation the browser would attempt is already refused by the sandbox and by
 * main's `will-navigate` deny. So the click is observed, the decision is
 * deferred to a microtask, and if the page cancelled it in the meantime nothing
 * is sent.
 *
 * BUILD CONSTRAINT: preload entries must be self-contained. Importing a shared
 * module BY VALUE makes Rollup hoist a chunk that a sandboxed preload cannot
 * `require`, and the packaged app then opens on the root error screen (#73).
 * The channel name is therefore inlined here rather than imported.
 *
 * @see src/main/services/preview/PreviewNavigationPolicy.ts - what main does with this
 */
import { ipcRenderer } from 'electron'

/**
 * Page → main channel for an activated link.
 *
 * INLINED, not imported: see the build constraint above. It is registered with
 * `webContents.ipc`, never on the global `ipcMain`, so it is invisible to every
 * other handler in the app.
 */
const LINK_ACTIVATED_CHANNEL = 'preview-page:linkActivated'

/** Primary (left) and auxiliary (middle) buttons both open links. */
const ACTIVATING_BUTTONS = new Set([0, 1])

/**
 * The nearest link in the event's composed path.
 *
 * `composedPath()` rather than `event.target.closest()` so links inside an OPEN
 * shadow root are found. Closed shadow roots stay invisible — a documented
 * limitation, and the same class of gap as a page that calls
 * `stopPropagation()`.
 */
function findLink(path: readonly EventTarget[]): HTMLAnchorElement | HTMLAreaElement | null {
  for (const node of path) {
    if (node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement) {
      return node
    }
  }
  return null
}

/**
 * The document's default link target, re-read on EVERY click.
 *
 * There is no IDL surface for a document base target, and a page can insert or
 * mutate `<base>` at runtime, so it cannot be cached.
 */
function documentBaseTarget(): string {
  const base = document.querySelector('base[target]')
  return base?.getAttribute('target') ?? ''
}

/** Whether the href only moves the fragment within the current document. */
function isFragmentOfCurrentDocument(href: string): boolean {
  try {
    const target = new URL(href)
    if (target.hash === '') return false
    const current = new URL(window.location.href)
    return target.origin === current.origin && target.pathname === current.pathname
  } catch {
    return false
  }
}

/**
 * Report an activated link to main, unless the page handled it itself.
 *
 * The report is deferred to a microtask so every other listener has run and
 * `defaultPrevented` reflects the page's decision, not just this listener's
 * position in the queue.
 */
function onLinkActivation(event: MouseEvent): void {
  // Only a genuine user gesture. `HTMLElement.click()` and `dispatchEvent()`
  // both produce `isTrusted === false`, so a page cannot drive this itself.
  if (!event.isTrusted) return
  if (event.defaultPrevented) return
  if (!ACTIVATING_BUTTONS.has(event.button)) return

  const link = findLink(event.composedPath())
  if (link === null) return

  const href = link.href
  if (typeof href !== 'string' || href === '') return

  // Let Chromium scroll: an in-page anchor is not a navigation.
  if (isFragmentOfCurrentDocument(href)) return

  const target = link.getAttribute('target') ?? documentBaseTarget()
  const download = link.hasAttribute('download')

  queueMicrotask(() => {
    // The page's own handler may have cancelled the click after this listener
    // ran. Respect that.
    if (event.defaultPrevented) return

    ipcRenderer.send(LINK_ACTIVATED_CHANNEL, {
      href,
      target,
      download,
      modifiers: {
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey
      }
    })
  })
}

// Bubble phase on `document`: ancestors of the link get their turn first, and
// the microtask above covers listeners that run after this one.
document.addEventListener('click', onLinkActivation)
document.addEventListener('auxclick', onLinkActivation)

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload for the SEALED preview page (sd-074b §5.1).
 *
 * It has two jobs, and it exposes NOTHING for either: there is no
 * `contextBridge` call in this file, so the page's own JavaScript gains no new
 * capability and cannot reach `ipcRenderer` — that lives in the isolated preload
 * world, which `contextIsolation: true` keeps separate.
 *
 *  1. Notice that a link was clicked and tell main.
 *  2. Notice that the page's CSP refused a remote subresource and tell main.
 *
 * WHY (2) IS HERE RATHER THAN AT THE NETWORK LAYER. Erfana gates remote hosts
 * twice: the CSP built from the project allowlist, and an independent
 * `onBeforeRequest` filter. The filter is what raises the "Approve this host?"
 * prompt — but Chromium enforces the CSP in the RENDERER, before the request is
 * ever dispatched, so for a host that is not on the allowlist the filter never
 * sees it and the prompt could never appear. On a project with no approvals yet
 * that made the whole approve flow unreachable: the toast was the only way to
 * add a host, and nothing could produce the toast.
 *
 * A `securitypolicyviolation` listener closes that gap without weakening either
 * gate. Verified in Electron 39 against a sandboxed, context-isolated preload:
 * the isolated world shares the page's DOM, so the event arrives here with the
 * full `blockedURI`, and `isTrusted` is `true` for a real refusal.
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

/**
 * Page → main channel for a CSP refusal. INLINED for the same build reason as
 * the channel above; must match `previewCspViolationBridge.ts`.
 */
const CSP_VIOLATION_CHANNEL = 'preview-page:cspViolation'

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

/**
 * Whether the href addresses the current document, fragment or not.
 *
 * No `hash === ''` guard: `<a href="#">` and `<a href="">` both resolve to an
 * empty hash, and both are same-document. Requiring a fragment reported the
 * standard no-op link idiom to main as a navigation, which mirrors the same
 * hole in `PreviewNavigationPolicy`.
 */
function isFragmentOfCurrentDocument(href: string): boolean {
  try {
    const target = new URL(href)
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

/**
 * Report a CSP refusal of a remote subresource to main.
 *
 * Sends the URI, never a decision — main re-parses it, re-validates the host and
 * owns every policy question. Everything here is a cheap filter to keep obvious
 * noise off the channel, not a security boundary.
 */
function onCspViolation(event: SecurityPolicyViolationEvent): void {
  // A page can `dispatchEvent` a forged `securitypolicyviolation` to make Erfana
  // prompt for a host it never referenced. Only the browser can set `isTrusted`.
  if (!event.isTrusted) return

  const blockedURI = event.blockedURI
  if (typeof blockedURI !== 'string' || blockedURI === '') return

  // `blockedURI` is often a keyword rather than a URL — `inline`, `eval`,
  // `wasm-eval`, `trusted-types-sink`. Those carry no host and are not something
  // a reader can approve.
  if (!blockedURI.startsWith('https://') && !blockedURI.startsWith('http://')) return

  ipcRenderer.send(CSP_VIOLATION_CHANNEL, {
    blockedURI,
    effectiveDirective: event.effectiveDirective ?? ''
  })
}

// Bubble phase on `document`: ancestors of the link get their turn first, and
// the microtask above covers listeners that run after this one.
document.addEventListener('click', onLinkActivation)
document.addEventListener('auxclick', onLinkActivation)

// CAPTURE phase, so a page listener that calls `stopPropagation()` on its own
// violation events cannot hide its remote hosts from Erfana.
document.addEventListener('securitypolicyviolation', onCspViolation, true)

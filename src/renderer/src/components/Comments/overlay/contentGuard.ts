// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment mode's pointer guard for a renderer-hosted preview (spec 024
 * 024-AC-001, 024-FR-004; overlay suite OVL-M-03, OVL-G-03 … OVL-G-11;
 * architecture note 001 § 2 option C – one behaviour, two hosts).
 *
 * The HTML Preview keeps the click family from its page in its preload
 * (`src/preload/previewPageComments/input.ts`). Here the "page" is the
 * preview's own content – its React handlers (a link's click and middle
 * click, the preview's mouse-up and right-click) and any listener inside the
 * rendered column – so the guard stops propagation in the CAPTURE phase at
 * the content root, never at the document:
 *
 * - Erfana's listeners on the scroller and above in the capture phase (the
 *   overlay host's own pick and menu listeners, the selection Comment
 *   button's mouse-up, `ContextMenu`'s outside-press check) still run first.
 * - Focus is untouched: no press default is prevented except the middle
 *   button's (autoscroll) and a primary press on a form control (security
 *   review L-2), so a press still focuses the scroller and dockview still
 *   activates the panel on focus.
 * - A primary press keeps its default: in comment mode a drag selects words
 *   (024-FR-004).
 * - A release is kept from the content only when its press was – a drag that
 *   started elsewhere (a divider, the editor) still ends where it started it.
 *
 * `click` and `contextmenu` are the overlay host's (`useHostPointerKeys.ts`):
 * it stops them at the scroller when it takes them.
 *
 * @module components/Comments/overlay/contentGuard
 */

/** Presses comment mode keeps from the content. */
const PRESS_EVENTS = ['pointerdown', 'mousedown'] as const
/** Releases, kept only when their press was. */
const RELEASE_EVENTS = ['pointerup', 'mouseup'] as const
/** Clicks the host does not take itself; their default is cancelled too (a middle click on a link opens nothing). */
const CLICK_EVENTS = ['auxclick', 'dblclick'] as const

/** The middle button: its press starts autoscroll. */
const MIDDLE_BUTTON = 1

/**
 * Controls whose default a primary press works by itself – none of which a
 * comment-mode click may do (security review L-2; the preload's list).
 */
const PRESS_CONTROLS = 'select, input, textarea, button, summary, video, audio, [contenteditable]'

type Family = 'pointer' | 'mouse'

const familyOf = (event: Event): Family => (event.type.startsWith('pointer') ? 'pointer' : 'mouse')

/** Whether a press's own default would work a control or start autoscroll. */
function pressDefaultActs(event: MouseEvent): boolean {
  if (event.button === MIDDLE_BUTTON) return true
  return event.button === 0 && event.target instanceof Element && event.target.closest(PRESS_CONTROLS) !== null
}

/**
 * Keep the click family from `content`'s own listeners while `modeOn()` says
 * comment mode is on.
 *
 * @param content - The preview's rendered content root (`adapter.root()`).
 * @param modeOn - Read at each event: the guard stays registered across mode changes.
 * @returns Removes every listener.
 *
 * @example
 * ```ts
 * const stop = guardContent(adapter.root()!, () => latest.current.mode)
 * ```
 */
export function guardContent(content: HTMLElement, modeOn: () => boolean): () => void {
  const win = content.ownerDocument.defaultView
  /** Families whose last press inside the content was kept from it. */
  const held = new Set<Family>()
  /** The release now in flight whose press was kept: decided at the window, before it reaches the content. */
  let owed: Event | null = null

  const onPress = (event: Event): void => {
    const family = familyOf(event)
    if (!modeOn()) {
      held.delete(family)
      return
    }
    event.stopPropagation()
    held.add(family)
    if (pressDefaultActs(event as MouseEvent)) event.preventDefault()
  }
  const onReleaseAnywhere = (event: Event): void => {
    owed = held.delete(familyOf(event)) ? event : null
  }
  const onRelease = (event: Event): void => {
    if (owed === event) event.stopPropagation()
  }
  const onClick = (event: Event): void => {
    if (!modeOn()) return
    event.stopPropagation()
    event.preventDefault()
  }

  for (const type of PRESS_EVENTS) content.addEventListener(type, onPress, true)
  for (const type of RELEASE_EVENTS) {
    win?.addEventListener(type, onReleaseAnywhere, true)
    content.addEventListener(type, onRelease, true)
  }
  for (const type of CLICK_EVENTS) content.addEventListener(type, onClick, true)
  return () => {
    for (const type of PRESS_EVENTS) content.removeEventListener(type, onPress, true)
    for (const type of RELEASE_EVENTS) {
      win?.removeEventListener(type, onReleaseAnywhere, true)
      content.removeEventListener(type, onRelease, true)
    }
    for (const type of CLICK_EVENTS) content.removeEventListener(type, onClick, true)
  }
}

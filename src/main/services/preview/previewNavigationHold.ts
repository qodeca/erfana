// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Holds a page's `will-navigate` until the preload has said what the click was
 * (sd-074b §5.1).
 *
 * One plain click reaches main twice: the preload's report and Chromium's
 * `will-navigate`, over two pipes that nothing orders. The preload sends its
 * report one task AFTER the click, so that it can see whether a later page
 * listener cancelled it — but the browser starts the navigation as soon as the
 * click's dispatch ends, so `will-navigate` normally arrives FIRST. Routed on
 * its own it counts as the page navigating itself: an external link is
 * refused with a badge, and a same-tab link opens a new tab.
 *
 * So the preload also sends a small "seen" note DURING the click (the href and
 * an id), and a "cancelled" note in place of the report when the page cancelled
 * the click. A `will-navigate` then waits:
 *
 *  - for a short grace, which covers a note that is still in flight;
 *  - after that, while a seen click on the same href is pending, until that
 *    click's report or cancelled note arrives — capped, so a lost note costs at
 *    most a second and then falls back to routing the navigation on its own.
 *
 * Holding only ever DELAYS a navigation; it never upgrades one. A held
 * navigation still routes as `navigation`, and a click routes as `gesture` only
 * through the preload's own report of a trusted click.
 */

/**
 * How long every `will-navigate` waits before it is routed on its own, unless
 * a seen click on its href asks it to wait longer. Covers a "seen" note that
 * reaches main a moment after the navigation; a page that navigates itself (no
 * preload, no click) is merely this much slower.
 */
export const NAVIGATION_GRACE_MS = 50

/**
 * The longest a `will-navigate` waits for a seen click to settle, counted from
 * its arrival, and the longest a seen click stays pending without news. A busy
 * page delays the preload's report by as long as it is busy; past this, the
 * click is treated as lost and the navigation is routed as one.
 */
export const CLICK_SETTLE_CAP_MS = 1000

/**
 * Seen clicks tracked at once. A person cannot have more in flight; the bound
 * keeps a misbehaving renderer from growing the map, and the oldest is settled
 * to make room.
 */
const MAX_PENDING_CLICKS = 16

/** The per-view hold the link bridge drives. */
export interface NavigationHold {
  /** The preload saw a trusted click on `href`; its report or withdrawal follows. */
  clickSeen(gestureId: number, href: string): void
  /** The click's report or "cancelled" note arrived; let its navigations go. */
  clickSettled(gestureId: number): void
  /** Run `dispatch` for a `will-navigate` to `href` once it may be routed. */
  hold(href: string, dispatch: () => void): void
  /** Drop every held navigation and pending click without routing them. */
  dispose(): void
}

interface PendingClick {
  readonly href: string
  readonly expiry: ReturnType<typeof setTimeout>
}

interface HeldNavigation {
  readonly href: string
  readonly dispatch: () => void
  timer: ReturnType<typeof setTimeout>
}

/** Build the hold for one live view. */
export function createNavigationHold(): NavigationHold {
  const pendingClicks = new Map<number, PendingClick>()
  const heldNavigations = new Set<HeldNavigation>()

  const isClickPending = (href: string): boolean =>
    [...pendingClicks.values()].some((click) => click.href === href)

  const release = (navigation: HeldNavigation): void => {
    clearTimeout(navigation.timer)
    heldNavigations.delete(navigation)
    navigation.dispatch()
  }

  const clickSettled = (gestureId: number): void => {
    const click = pendingClicks.get(gestureId)
    if (click === undefined) return
    clearTimeout(click.expiry)
    pendingClicks.delete(gestureId)
    // Another pending click on the same href still speaks for its navigation.
    if (isClickPending(click.href)) return
    for (const navigation of [...heldNavigations]) {
      if (navigation.href === click.href) release(navigation)
    }
  }

  return {
    clickSeen(gestureId: number, href: string): void {
      const previous = pendingClicks.get(gestureId)
      if (previous !== undefined) {
        clearTimeout(previous.expiry)
        pendingClicks.delete(gestureId)
      }
      if (pendingClicks.size >= MAX_PENDING_CLICKS) {
        const [oldest] = pendingClicks.keys()
        clickSettled(oldest)
      }
      const expiry = setTimeout(() => clickSettled(gestureId), CLICK_SETTLE_CAP_MS)
      pendingClicks.set(gestureId, { href, expiry })
    },

    clickSettled,

    hold(href: string, dispatch: () => void): void {
      const navigation: HeldNavigation = {
        href,
        dispatch,
        timer: setTimeout(() => {
          if (!isClickPending(href)) {
            release(navigation)
            return
          }
          navigation.timer = setTimeout(
            () => release(navigation),
            CLICK_SETTLE_CAP_MS - NAVIGATION_GRACE_MS
          )
        }, NAVIGATION_GRACE_MS)
      }
      heldNavigations.add(navigation)
    },

    dispose(): void {
      for (const navigation of heldNavigations) clearTimeout(navigation.timer)
      heldNavigations.clear()
      for (const click of pendingClicks.values()) clearTimeout(click.expiry)
      pendingClicks.clear()
    }
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewGroupKeys hook – the preview's keys while focus sits on its
 * dockview GROUP rather than inside the panel.
 *
 * When a tab becomes active, `EditorAreaSplitPanel` and `openFileInPanel` call
 * `panel.group.focus()`, which leaves keyboard focus on dockview's group
 * element (`.dv-groupview`). A preview renders with `renderer: 'always'`, so its
 * DOM lives in dockview's overlay layer – OUTSIDE that element. Neither of the
 * two existing key routes hears a key there:
 *
 * - main's forwarder (`previewInputForward.ts`) only while the PAGE has focus;
 * - the panel root's React `onKeyDown` only while focus is INSIDE the root.
 *
 * So the comment-mode toggle (Ctrl+Alt+M / Cmd+Option+M) and Back/Forward did
 * nothing right after a preview tab was opened or switched to. This hook is the
 * third route: one native `keydown` listener on the group element, handing the
 * event to the same handler the root uses.
 *
 * The gates, each of which a simplification would break:
 *
 * - **Active panel at key time.** Several previews can share one group, and
 *   dockview keeps every one mounted, so each attaches its own listener to the
 *   same element. Only the one whose `api.isActive` is true acts (CLAUDE.md,
 *   panel-scoped globals). Read when the key arrives, never captured at attach.
 * - **Not from inside the root.** A key typed in the panel's own DOM is already
 *   the root handler's; if the root ever sits inside the group element (a
 *   renderer change), it would otherwise run twice.
 * - **Not already handled.** A `defaultPrevented` event belongs to whoever
 *   prevented it.
 * - **Follows the group.** A panel moved to another group re-attaches there
 *   (`onDidGroupChange`); the old group's listener is removed.
 *
 * @module usePreviewGroupKeys
 * @see ../HtmlPreviewPanel.tsx - `onPanelKey`, the handler both routes share
 */

import { useEffect, type RefObject } from 'react'
import type { DockviewPanelApi } from 'dockview'
import { useLatestRef } from '../../../../hooks/useLatestRef'

/**
 * The slice of a keyboard event the preview's key handlers read.
 *
 * A structural pick so that both a React `KeyboardEvent` (the root's
 * `onKeyDown`) and a native DOM `KeyboardEvent` (this hook) fit one handler.
 * `type` is part of it because the Back/Forward table (`navKeyFromDomEvent`)
 * reads it.
 */
export type PreviewKeyEventLike = Pick<
  KeyboardEvent,
  | 'type'
  | 'key'
  | 'code'
  | 'metaKey'
  | 'altKey'
  | 'ctrlKey'
  | 'shiftKey'
  | 'defaultPrevented'
  | 'preventDefault'
>

/** The dockview api members the hook reads. */
type GroupKeysApi = Pick<DockviewPanelApi, 'isActive' | 'group' | 'onDidGroupChange'>

/** Options for {@link usePreviewGroupKeys}. */
export interface UsePreviewGroupKeysOptions {
  /**
   * The panel's dockview api. Without one (or without a group) the hook
   * attaches nothing – there is no group element to hear.
   */
  readonly api: GroupKeysApi | undefined
  /** The panel root; keys whose target is inside it are the root's own. */
  readonly rootRef: RefObject<HTMLElement | null>
  /**
   * The panel's key chain. Called at most once per key event, only for the
   * active panel. May change every render; the listener always calls the
   * latest one without re-attaching.
   */
  readonly onKey: (event: PreviewKeyEventLike) => void
}

/**
 * Routes keys pressed on the preview's dockview group element to the panel's
 * key chain, for the active preview only.
 *
 * @param options - {@link UsePreviewGroupKeysOptions}
 * @returns Nothing; the listener lives for as long as the component is mounted.
 *
 * @example
 * ```tsx
 * const onPanelKey = (event: PreviewKeyEventLike): void => {
 *   comments.onRootKeyDown(event)
 *   if (!event.defaultPrevented) navigation.onRootKeyDown(event)
 * }
 * usePreviewGroupKeys({ api, rootRef: panelRootRef, onKey: onPanelKey })
 * ```
 */
export function usePreviewGroupKeys({ api, rootRef, onKey }: UsePreviewGroupKeysOptions): void {
  // The latest handler, read at key time: the effect below must not re-attach
  // on every render (the panel rebuilds its handler each render).
  const onKeyRef = useLatestRef(onKey)

  useEffect(() => {
    if (!api) return undefined

    const listener = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !api.isActive) return
      const root = rootRef.current
      if (root && event.target instanceof Node && root.contains(event.target)) return
      onKeyRef.current(event)
    }

    let attached: HTMLElement | null = null
    const attach = (): void => {
      attached?.removeEventListener('keydown', listener)
      // Defensive: a test double or a panel mid-teardown may have no group.
      attached = api.group?.element ?? null
      attached?.addEventListener('keydown', listener)
    }

    attach()
    const groupChange = api.onDidGroupChange?.(attach)

    return () => {
      groupChange?.dispose()
      attached?.removeEventListener('keydown', listener)
      attached = null
    }
  }, [api, rootRef, onKeyRef])
}

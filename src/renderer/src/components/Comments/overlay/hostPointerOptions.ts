// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The comment overlay host's wiring for `useHostPointerKeys` (#445): it turns
 * the host's state and actions into the pointer hook's options, so
 * `useCommentOverlayHost.ts` keeps room under the 500-line limit.
 */
import { pointerOnLines } from '../../../../../shared/comments/overlayCore/selectionRules'
import { ANNOUNCE } from '../commentCopy'
import { commentMarkAt } from './commentHighlights'
import { spokenTarget } from './hostParts'
import {
  useHostPointerKeys,
  type HostPointerKeys,
  type HostPointerKeysOptions
} from './useHostPointerKeys'
import type { SelectionComments } from './useSelectionComments'

/** What the host already holds; the rest of the options are built from it. */
export interface HostPointerParts extends Pick<
  HostPointerKeysOptions,
  | 'live'
  | 'mode'
  | 'activePanel'
  | 'adapter'
  | 'scroller'
  | 'scrollerLabel'
  | 'windowOpen'
  | 'onToggleMode'
  | 'onWindowEscape'
  | 'onPick'
  | 'onMenu'
  | 'onSay'
> {
  readonly placements: Parameters<typeof spokenTarget>[2]
  readonly file: Parameters<typeof spokenTarget>[3]
  readonly markOwner: string
  readonly selection: Pick<SelectionComments, 'read' | 'readInView' | 'hideButton'>
  /** Comment mode on or off. */
  readonly setMode: (on: boolean) => void
  /** The mode button, which takes focus when Esc leaves the mode. */
  readonly modeButton: () => HTMLButtonElement | null
  readonly openThreads: (threadKeys: string[], at: HTMLElement | null) => void
  readonly onScroll: () => void
}

export function hostPointerOptions(parts: HostPointerParts): HostPointerKeysOptions {
  const { placements, file, markOwner, selection, setMode, modeButton, openThreads, ...passed } =
    parts
  return {
    ...passed,
    onExit: () => {
      setMode(false)
      parts.onSay(ANNOUNCE.modeOff)
      modeButton()?.focus()
    },
    speak: target => spokenTarget(target, parts.adapter, placements, file),
    markAt: (x, y) => commentMarkAt(markOwner, x, y),
    onOpenMark: (threadKey, at) => openThreads([threadKey], at),
    selectionRect: () => selection.read()?.rect ?? null,
    selectionTarget: () => selection.readInView()?.target ?? null,
    onSelectionAt: (x, y) => pointerOnLines(selection.read()?.lines ?? [], { x, y }),
    onKeyMove: selection.hideButton
  }
}

/** `useHostPointerKeys` with the options built from the host's parts. */
export function useHostPointer(parts: HostPointerParts): HostPointerKeys {
  return useHostPointerKeys(hostPointerOptions(parts))
}

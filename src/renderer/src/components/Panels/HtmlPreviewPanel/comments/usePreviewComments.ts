// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – everything one preview tab does with comments
 * (docs/designs/html-preview-comments.md §7, §10; R-010, R-015, R-018,
 * R-021, R-023).
 *
 * The panel stays glue (`HtmlPreviewPanel.tsx`): this hook subscribes to
 * main's four comment events for THIS panel id, keeps the tab's entry in
 * `usePreviewCommentStore`, and hands back ready props for the three toolbar
 * tools, the drawer, and the layer that draws the menu and the window.
 *
 * Main is the record for comment mode – Esc in the page and the forwarded
 * shortcut change it there and report `commentModeChanged` – so a request
 * from here is optimistic and reconciled with main's answer.
 *
 * Focus rules (§10.3, §10.4): closing the menu or a window opened from the
 * page hands NATIVE focus back to the page (`preview:focusPage`) – a DOM
 * `focus()` cannot reach into the native view; a window opened from a drawer
 * row returns focus to that row (BaseDialog's opener restore).
 *
 * @module HtmlPreviewPanel/comments/usePreviewComments
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DockviewApi } from 'dockview'
import type { CommentSaveRequest } from '../../../../../../shared/ipc/preview-comment-schema'
import { commentGateway } from '../../../../services/preview/commentGateway'
import { previewGateway } from '../../../../services/previewGateway'
import { textClipboard } from '../../../../services/textClipboard'
import { useGlobalSettingsStore } from '../../../../stores/useGlobalSettingsStore'
import {
  usePanelCommentState,
  usePreviewCommentStore
} from '../../../../stores/usePreviewCommentStore'
import { useOccluder } from '../../../../hooks/useOccluder'
import { useLatestRef } from '../../../../hooks/useLatestRef'
import { isMacOS } from '../../../../utils/platform'
import { openFileInPanel } from '../../../../utils/openFileInPanel'
import { getBasename } from '../../../../utils/fileUtils'
import { ANNOUNCE, COPY, DRAWER_COPY, savedAnnouncement } from './commentCopy'
import type { Box } from './commentPlacement'
import type { CommentDrawerProps } from './CommentDrawer'
import type { CommentToolbarToolsProps } from './CommentToolbarTools'
import { pinDraftToken, type CommentWindowRequest, type ElementDraft } from './commentWindowTypes'
import type { DrawerRow } from './commentRows'
import type { PreviewCommentsLayerProps } from './PreviewCommentsLayer'
import { useLiveText } from './commentLive'

/** Under this panel width the drawer takes the whole width (§10.6). */
export const DRAWER_FULL_BELOW_PX = 640

/** Options for {@link usePreviewComments}. */
export interface UsePreviewCommentsOptions {
  readonly panelId: string
  /** The page the tab shows now. */
  readonly filePath: string
  /** The page has loaded (`loadState === 'ready'`). */
  readonly ready: boolean
  /** The page area: the window is kept inside it. */
  readonly pageAreaRef: React.RefObject<HTMLElement | null>
  /** The panel root: its width decides the drawer's full-width mode. */
  readonly panelRootRef: React.RefObject<HTMLElement | null>
  /** The editor area, for "Open in source". */
  readonly containerApi: DockviewApi | undefined
}

/** What the panel renders. `enabled` false: nothing at all (the feature flag is off). */
export interface PreviewComments {
  readonly enabled: boolean
  readonly toolbar: CommentToolbarToolsProps
  /** The drawer's props while it is open, else `null`. */
  readonly drawer: CommentDrawerProps | null
  readonly layer: PreviewCommentsLayerProps
  /** Ctrl+Alt+M / Cmd+Option+M with focus in the panel's own chrome. */
  readonly onRootKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
}

/** Native focus back into the page, a frame after the overlay that held it is gone. */
function focusPageSoon(panelId: string): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void previewGateway.focusPage(panelId).catch(() => {})
    })
  })
}

/**
 * Wires one preview tab's comments.
 *
 * @param options - {@link UsePreviewCommentsOptions}
 * @returns {@link PreviewComments}
 *
 * @example
 * ```tsx
 * const comments = usePreviewComments({ panelId, filePath, ready, pageAreaRef, panelRootRef, containerApi })
 * {comments.enabled && <CommentToolbarTools {...comments.toolbar} />}
 * ```
 */
export function usePreviewComments({
  panelId,
  filePath,
  ready,
  pageAreaRef,
  panelRootRef,
  containerApi
}: UsePreviewCommentsOptions): PreviewComments {
  const settings = useGlobalSettingsStore(s => s.settings)
  const updateCommentIdentity = useGlobalSettingsStore(s => s.updateCommentIdentity)
  // Read defensively: a partial settings object may lack `htmlPreview`.
  const enabled =
    settings !== null &&
    settings.htmlPreview?.comments?.enabled !== false &&
    commentGateway.available()
  const state = usePanelCommentState(panelId)
  const store = usePreviewCommentStore
  const drawerId = `comment-drawer-${useId().replace(/[^\w-]/g, '')}`
  const [menu, setMenu] = useState<ElementDraft | null>(null)
  const [request, setRequest] = useState<CommentWindowRequest | null>(null)
  // Both regions are cleared, then set a frame later, so the same sentence
  // twice is still announced twice (H1).
  const [polite, announce] = useLiveText()
  const [assertive, alert] = useLiveText()
  const [narrow, setNarrow] = useState(false)
  const listButtonRef = useRef<HTMLButtonElement>(null)
  // The state as of the last commit, for event handlers and async answers.
  const latestRef = useLatestRef(state)

  const refreshList = useCallback(async () => {
    const generation = store.getState().beginList(panelId)
    const result = await commentGateway.list(panelId)
    store.getState().finishList(panelId, generation, result)
  }, [panelId, store])

  // ---- main's events, for this panel only ----
  useEffect(() => {
    if (!enabled) return undefined
    const offDraft = commentGateway.onDraftOpened(payload => {
      if (payload.panelId !== panelId) return
      if (payload.kind === 'icon') {
        setMenu(null)
        setRequest({
          kind: 'threads',
          panelId,
          fileKey: payload.fileKey,
          threadKeys: payload.threadKeys,
          blockKeys: payload.blockKeys,
          point: payload.point,
          opener: 'page',
          draftToken: pinDraftToken(payload),
          target: payload.target,
          file: {
            fileKey: payload.fileKey,
            displayPath: payload.displayPath,
            filePath: payload.filePath,
            frame: payload.frame
          }
        })
        void refreshList()
        return
      }
      // Decision 19: a left-click pick opens the window directly, no menu.
      if (
        payload.kind === 'open' &&
        payload.draftToken !== undefined &&
        payload.target !== undefined
      ) {
        setMenu(null)
        setRequest({
          kind: 'new',
          panelId,
          draftToken: payload.draftToken,
          target: payload.target,
          file: payload,
          point: payload.point,
          opener: 'page'
        })
        return
      }
      setMenu(payload)
    })
    const offChanged = commentGateway.onCommentsChanged(payload => {
      if (payload.panelId !== panelId) return
      store.getState().applyChanged(payload)
      if (latestRef.current.drawerOpen || latestRef.current.list.status !== 'idle')
        void refreshList()
    })
    const offAnchors = commentGateway.onAnchorStatus(payload => {
      if (payload.panelId !== panelId) return
      store.getState().patch(panelId, { notVisible: payload.notVisible })
    })
    const offMode = commentGateway.onModeChanged(payload => {
      if (payload.panelId !== panelId) return
      store.getState().patch(panelId, { mode: payload.on })
      announce(payload.on ? ANNOUNCE.modeOn : ANNOUNCE.modeOff)
    })
    return () => {
      offDraft()
      offChanged()
      offAnchors()
      offMode()
    }
  }, [enabled, panelId, store, refreshList, announce, latestRef])

  // A move to another page: the menu and the window were about the old one
  // (any typed draft stays in memory). The mode and the toggle stay (R-023).
  const [shownPath, setShownPath] = useState(filePath)
  if (shownPath !== filePath) {
    setShownPath(filePath)
    setMenu(null)
    setRequest(null)
  }
  useEffect(() => {
    if (latestRef.current.drawerOpen) void refreshList()
  }, [filePath, refreshList, latestRef])

  // The drawer's full-width mode follows the panel's width.
  useEffect(() => {
    const root = panelRootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return undefined
    const measure = (): void => setNarrow(root.getBoundingClientRect().width < DRAWER_FULL_BELOW_PX)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [panelRootRef, state.drawerOpen])

  // A full-width drawer covers the whole page area: the page has nowhere to
  // show, so its native view must be hidden, not left painting over the list.
  useOccluder('overlay', enabled && state.drawerOpen && narrow)

  const setMode = useCallback(
    async (on: boolean, showIcons: boolean) => {
      const before = latestRef.current
      store.getState().patch(panelId, { mode: on, showIcons })
      const result = await commentGateway.setMode({ panelId, on, showIcons })
      if (result.ok) {
        store.getState().patch(panelId, { mode: result.on, showIcons: result.showIcons })
        return result.on
      }
      store.getState().patch(panelId, { mode: before.mode, showIcons: before.showIcons })
      return before.mode
    },
    [panelId, store, latestRef]
  )

  const toggleMode = useCallback(
    (byKeyboard: boolean) => {
      const on = !latestRef.current.mode
      void setMode(on, latestRef.current.showIcons).then(now => {
        announce(now ? ANNOUNCE.modeOn : ANNOUNCE.modeOff)
        // Keyboard activation moves focus into the page with the picker started (§10.1).
        if (now && byKeyboard) void previewGateway.focusPage(panelId).catch(() => {})
      })
    },
    [setMode, announce, panelId, latestRef]
  )

  const toggleIcons = useCallback(() => {
    void setMode(latestRef.current.mode, !latestRef.current.showIcons)
  }, [setMode, latestRef])

  const setDrawerOpen = useCallback(
    (open: boolean) => {
      store.getState().patch(panelId, { drawerOpen: open })
      if (open) void refreshList()
      else requestAnimationFrame(() => listButtonRef.current?.focus())
    },
    [panelId, store, refreshList]
  )

  const openInSource = useCallback(
    (path: string, line: number) => {
      openFileInPanel(containerApi, path, { kind: 'editor', params: { initialLine: line } })
    },
    [containerApi]
  )

  const reveal = useCallback(
    (row: DrawerRow) => {
      if (row.threadKey === undefined) return
      // Under 640px the drawer covers the page: close it first (§10.6), and
      // hand focus natively to the page the element is shown in – the row
      // that had it is gone, and focus must not drop to <body> (H3).
      if (narrow) {
        store.getState().patch(panelId, { drawerOpen: false })
        focusPageSoon(panelId)
      }
      void commentGateway.reveal(panelId, row.threadKey)
      if (row.tags.some(tag => tag.text === DRAWER_COPY.notVisible))
        announce(DRAWER_COPY.notOnScreen)
    },
    [narrow, panelId, store, announce]
  )

  // `returnFocus: false` – "Go to tab" moves focus to the editor itself, and
  // the page must not take it back a frame later (H2).
  const closeWindow = useCallback(
    (returnFocus = true) => {
      setRequest(current => {
        if (returnFocus && current?.opener === 'page') focusPageSoon(panelId)
        return null
      })
    },
    [panelId]
  )

  const onWritten = useCallback(
    (save: CommentSaveRequest, file: string) => {
      const name = file || getBasename(filePath)
      if (save.op === 'add') {
        announce(savedAnnouncement(name))
        closeWindow()
      } else if (save.op === 'setStatus') {
        announce(save.status === 'resolved' ? ANNOUNCE.resolved : ANNOUNCE.reopened)
      } else if (
        save.op === 'deleteMessage' ||
        save.op === 'deleteThread' ||
        save.op === 'deleteBlock'
      ) {
        announce(ANNOUNCE.deleted(name))
      } else {
        announce(savedAnnouncement(name))
      }
      void refreshList()
    },
    [announce, closeWindow, filePath, refreshList]
  )

  const getArea = useCallback((): Box | null => {
    const box = pageAreaRef.current?.getBoundingClientRect()
    return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null
  }, [pageAreaRef])

  const onRootKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!enabled || !ready || menu !== null || request !== null) return
      const mods = isMacOS() ? event.metaKey && event.altKey : event.ctrlKey && event.altKey
      // The TYPED key, never the physical one: AltGr+M types µ on German layouts.
      // macOS Option changes the typed character, so there `code` stands in.
      // The physical key stands in only when the typed one is not printable
      // ASCII (µ under Option or AltGr): on AZERTY a typed "," sits on KeyM
      // and must not toggle the mode (L14).
      const typedAscii = event.key.length === 1 && event.key >= ' ' && event.key <= '~'
      const isM = event.key.toLowerCase() === 'm' || (event.code === 'KeyM' && !typedAscii)
      if (!mods || !isM || event.shiftKey) return
      event.preventDefault()
      toggleMode(false)
    },
    [enabled, ready, menu, request, toggleMode]
  )

  const toolbar: CommentToolbarToolsProps = {
    mode: state.mode,
    showIcons: state.showIcons,
    drawerOpen: state.drawerOpen,
    drawerId,
    counts: state.counts,
    ready,
    unavailable: state.unavailable,
    onToggleMode: toggleMode,
    onToggleDrawer: () => setDrawerOpen(!latestRef.current.drawerOpen),
    onToggleIcons: toggleIcons,
    listRef: listButtonRef
  }

  const drawer: CommentDrawerProps | null =
    enabled && state.drawerOpen
      ? {
          id: drawerId,
          list: state.list,
          notVisible: state.notVisible,
          showIcons: state.showIcons,
          full: narrow,
          pageFile: getBasename(filePath),
          onClose: () => setDrawerOpen(false),
          onShowIconsChange: show => void setMode(latestRef.current.mode, show),
          onReveal: reveal,
          onOpenInSource: row => openInSource(row.filePath, row.line),
          onOpen: row => {
            setRequest({
              kind: 'threads',
              panelId,
              fileKey: row.fileKey,
              threadKeys: row.threadKey !== undefined ? [row.threadKey] : [],
              blockKeys: row.blockKey !== undefined ? [row.blockKey] : [],
              point: centreOf(getArea()),
              opener: 'drawer',
              // The file, so a failed list read can name it (M7).
              file: {
                fileKey: row.fileKey,
                displayPath: row.displayPath,
                filePath: row.filePath,
                frame: row.frame
              }
            })
          },
          onRetry: () => void refreshList()
        }
      : null

  const identity = settings?.comments ?? null
  const layer: PreviewCommentsLayerProps = useMemo(
    () => ({
      menu,
      request,
      list: state.list,
      identity,
      notVisible: state.notVisible,
      polite,
      assertive,
      getArea,
      onMenuClose: (chosen: boolean) => {
        setMenu(null)
        if (!chosen) focusPageSoon(panelId)
      },
      onAddComment: (draft: ElementDraft) => {
        if (draft.draftToken === undefined || draft.target === undefined) return
        setRequest({
          kind: 'new',
          panelId,
          draftToken: draft.draftToken,
          target: draft.target,
          file: draft,
          point: draft.point,
          opener: 'page'
        })
      },
      onCloseWindow: closeWindow,
      onNewComment: next => setRequest(next),
      onSaveIdentity: data =>
        updateCommentIdentity({
          authorName: data.name,
          authorEmail: data.email === '' ? undefined : data.email,
          identityNoticeSeen: true
        }),
      onSave: save => commentGateway.save(save),
      onWritten,
      onRefresh: () => void refreshList(),
      onPickAgain: () => {
        closeWindow()
        if (!latestRef.current.mode) void setMode(true, latestRef.current.showIcons)
      },
      onOpenInSource: openInSource,
      onCopyRaw: (text: string) => {
        void textClipboard.writeText(text).then(ok => {
          if (ok) announce(COPY.rawCopied)
          else alert(COPY.copyFailed)
        })
      }
    }),
    [
      menu,
      request,
      state.list,
      identity,
      state.notVisible,
      polite,
      assertive,
      getArea,
      panelId,
      closeWindow,
      updateCommentIdentity,
      onWritten,
      refreshList,
      setMode,
      openInSource,
      announce,
      alert,
      latestRef
    ]
  )

  return { enabled, toolbar, drawer, layer, onRootKeyDown }
}

/** The middle of a box: where a window opened from the drawer is anchored. */
function centreOf(box: Box | null): { x: number; y: number } {
  if (box === null) return { x: 0, y: 0 }
  return { x: box.left + box.width / 2, y: box.top + box.height / 3 }
}

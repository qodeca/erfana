// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – everything one preview tab does with comments
 * (docs/designs/comments/html-preview-comments.md §7, §10; R-010, R-015, R-018,
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
import { useLatestRef } from '../../../../hooks/useLatestRef'
import { isMacOS } from '../../../../utils/platform'
import { commentModeKeyFromDomEvent, matchCommentModeKey } from '../../../../../../shared/commentModeKey'
import { openFileInPanel } from '../../../../utils/openFileInPanel'
import { getBasename } from '../../../../utils/fileUtils'
import { ANNOUNCE, COPY, DRAWER_COPY, writtenAnnouncement } from '../../../Comments/commentCopy'
import type { Box } from '../../../Comments/commentPlacement'
import type { CommentDrawerProps } from '../../../Comments/CommentDrawer'
import type { CommentToolbarToolsProps } from '../../../Comments/CommentToolbarTools'
import { pinDraftOf, type CommentWindowRequest, type ElementDraft } from '../../../Comments/commentWindowTypes'
import { useCommentSettleNotices } from '../../../Comments/useCommentSettleNotices'
import { useDrawerSheet } from './useDrawerSheet'
import { listCounts, type DrawerRow } from '../../../Comments/commentRows'
import type { PreviewCommentsLayerProps } from './PreviewCommentsLayer'
import { useLiveText } from '../../../Comments/commentLive'
import { COMMENT_LIST_COPY, HTML_WORDS } from '../../../Comments/commentCopyWords'
import { useRemovedOutside } from '../../../Comments/commentRemovedOutside'
import { newCommentRequest, withWords } from './previewCommentRequests'
import { pickerAnnouncement } from './commentLive'
import { usePreviewDraftKeepAlive } from './usePreviewDraftKeepAlive'
import type { PreviewKeyEventLike } from '../hooks/usePreviewGroupKeys'

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
  /** dockview shows this tab (default `true`). A hidden tab stays mounted: its window must not float over another (§19 Rev 4). */
  readonly visible?: boolean
}

/** What the panel renders. `enabled` false: nothing at all (the feature flag is off). */
export interface PreviewComments {
  readonly enabled: boolean
  readonly toolbar: CommentToolbarToolsProps
  /** The drawer's props while it is open, else `null`. */
  readonly drawer: CommentDrawerProps | null
  readonly layer: PreviewCommentsLayerProps
  /** Ctrl+Alt+M / Cmd+Option+M, focus in the chrome or on the group (native event too). */
  readonly onRootKeyDown: (event: PreviewKeyEventLike) => void
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
  containerApi,
  visible = true
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
  const listButtonRef = useRef<HTMLButtonElement>(null)
  const pickerSteps = useRef(0) // C-10: picker steps said since the mode last changed (the first ones add the keys).
  // OD-06: open comments that a list no longer holds, and Erfana did not delete.
  const removed = useRemovedOutside(state.list, HTML_WORDS)
  const keepDraft = usePreviewDraftKeepAlive(panelId, request?.kind === 'new' ? request.draftToken : null)
  const { ownDelete } = removed
  // The state as of the last commit, for event handlers and async answers.
  const latestRef = useLatestRef(state)

  // The generation of the list stored now: a thread window closes itself only on a newer one (M2).
  const listAfter = useCallback(() => store.getState().panels.get(panelId)?.list.generation ?? 0, [panelId, store])

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
          listAfter: listAfter(),
          ...pinDraftOf(payload),
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
      // Decision 19: a left-click pick opens the window directly, no menu – on the words when it was the Comment button.
      const opened = payload.kind === 'open' ? newCommentRequest(panelId, payload, 'words') : null
      if (opened !== null) {
        setMenu(null)
        setRequest(opened)
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
      // Newer than the flags a list keeps from its read: a list read while the
      // element was hidden must not keep "Not visible now" once it shows (E-005).
      const hidden = new Set(payload.notVisible)
      const list = store.getState().panels.get(panelId)?.list
      const files = list?.files.map(file => ({
        ...file,
        threads: file.threads.map(t => ({ ...t, notVisible: hidden.has(t.threadKey) }))
      }))
      store.getState().patch(panelId, {
        notVisible: payload.notVisible,
        ...(list !== undefined && files !== undefined ? { list: { ...list, files } } : {})
      })
    })
    const offMode = commentGateway.onModeChanged(payload => {
      if (payload.panelId !== panelId) return
      // The page's keyboard picker moved: the page holds no live region (E-022), so it is said here.
      if (payload.reason === 'picker') {
        const say = pickerAnnouncement(payload, pickerSteps.current)
        if (payload.say === 'showing') pickerSteps.current += 1
        if (say !== undefined) announce(say)
        return
      }
      pickerSteps.current = 0
      store.getState().patch(panelId, { mode: payload.on })
      announce(payload.on ? ANNOUNCE.modeOn : ANNOUNCE.modeOff)
    })
    return () => {
      offDraft()
      offChanged()
      offAnchors()
      offMode()
    }
  }, [enabled, panelId, store, refreshList, announce, latestRef, listAfter])

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

  // Tab hidden (§19 Rev 4): the menu pointed at a page no longer shown, so it goes; the
  // window's request is KEPT, only withheld from the layer, and returns with the tab.
  const [shownVisible, setShownVisible] = useState(visible)
  if (shownVisible !== visible) {
    setShownVisible(visible)
    if (!visible) setMenu(null)
  }

  // The drawer's full-width mode follows the panel's width; as a sheet it hides
  // THIS panel's page through its own gate, never the window's occluder.
  const narrow = useDrawerSheet({ panelId, panelRootRef, drawerOpen: enabled && state.drawerOpen })

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
      announce(writtenAnnouncement(save, file || getBasename(filePath)))
      if (save.op === 'add') closeWindow()
      void refreshList()
    },
    [announce, closeWindow, filePath, refreshList]
  )

  // A write answered "still saving" settled: say how, even with its window closed (H1).
  useCommentSettleNotices({ panelId, request, pageName: getBasename(filePath), announce, alert, closeWindow })

  const getArea = useCallback((): Box | null => {
    const box = pageAreaRef.current?.getBoundingClientRect()
    return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null
  }, [pageAreaRef])

  const onRootKeyDown = useCallback(
    (event: PreviewKeyEventLike) => {
      if (!enabled || !ready || menu !== null || request !== null) return
      // The one rule main forwards the page's key by (`shared/commentModeKey`, M3).
      if (!matchCommentModeKey(commentModeKeyFromDomEvent(event), isMacOS())) return
      event.preventDefault()
      toggleMode(false)
    },
    [enabled, ready, menu, request, toggleMode]
  )

  // C-06: the count's name adds how many open comments changed, from the list main last sent.
  const changed = useMemo(() => listCounts(state.list.files).changed, [state.list.files])
  const toolbar: CommentToolbarToolsProps = {
    mode: state.mode,
    changed,
    drawerOpen: state.drawerOpen,
    drawerId,
    counts: state.counts,
    ready,
    unavailable: state.unavailable,
    onToggleMode: toggleMode,
    onToggleDrawer: () => setDrawerOpen(!latestRef.current.drawerOpen),
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
            // Its element comes into view behind the window, out of any folded <details> (§19 Rev 4).
            if (row.main === 'reveal' && row.threadKey !== undefined) void commentGateway.reveal(panelId, row.threadKey)
            setRequest({
              kind: 'threads',
              panelId,
              fileKey: row.fileKey,
              threadKeys: row.threadKey !== undefined ? [row.threadKey] : [],
              blockKeys: row.blockKey !== undefined ? [row.blockKey] : [],
              point: centreOf(getArea()),
              opener: 'drawer',
              listAfter: listAfter(),
              // The file, so a failed list read can name it (M7).
              file: {
                fileKey: row.fileKey,
                displayPath: row.displayPath,
                filePath: row.filePath,
                frame: row.frame
              }
            })
          },
          onRetry: () => void refreshList(),
          // OD-06: the removed-outside note, and its Copy text.
          removed: removed.removed,
          onDismissRemoved: removed.dismiss,
          onCopyText: text => {
            void textClipboard.writeText(text).then(ok => (ok ? announce(COMMENT_LIST_COPY.textCopied) : alert(COMMENT_LIST_COPY.copyTextFailed)))
          }
        }
      : null

  const identity = settings?.comments ?? null
  const layer: PreviewCommentsLayerProps = useMemo(
    () => ({
      menu,
      // Withheld, not dropped, while the tab is hidden (see `shownVisible`).
      request: visible ? request : null,
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
      mode: state.mode,
      onAddComment: (draft: ElementDraft, scope = 'whole') => {
        const next = newCommentRequest(panelId, draft, scope)
        if (next === null) return
        setRequest(next)
      },
      onCloseWindow: closeWindow,
      onNewComment: next => setRequest(next),
      onSaveIdentity: data =>
        updateCommentIdentity({
          authorName: data.name,
          authorEmail: data.email === '' ? undefined : data.email,
          identityNoticeSeen: true
        }),
      onSave: (save, sel) => {
        // OD-06: a thread Erfana removes itself is never "removed outside Erfana".
        if (save.op === 'deleteThread' || save.op === 'deleteMessage') ownDelete(save.threadKey)
        return keepDraft(save).then(() => commentGateway.save(withWords(save, sel)))
      },
      onWritten,
      onRefresh: () => void refreshList(),
      // C-13: a step brings its thread's element into view behind the window, as the drawer's Open does.
      onReveal: (threadKey: string) => void commentGateway.reveal(panelId, threadKey),
      onPickAgain: () => {
        closeWindow()
        if (!latestRef.current.mode) void setMode(true, latestRef.current.showIcons)
      },
      onOpenInSource: (path: string, line: number) => {
        // Close first, as "Go to tab" does: a modal left open would sit over the editor and
        // trap its focus. Typed text stays in the session drafts; the editor takes focus.
        closeWindow(false)
        openInSource(path, line)
      },
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
      visible,
      state.mode,
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
      latestRef,
      ownDelete,
      keepDraft
    ]
  )

  return { enabled, toolbar, drawer, layer, onRootKeyDown }
}

/** The middle of a box: where a window opened from the drawer is anchored. */
function centreOf(box: Box | null): { x: number; y: number } {
  if (box === null) return { x: 0, y: 0 }
  return { x: box.left + box.width / 2, y: box.top + box.height / 3 }
}

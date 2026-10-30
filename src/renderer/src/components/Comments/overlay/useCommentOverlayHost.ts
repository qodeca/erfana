// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment overlay host for previews Erfana draws in its own DOM (spec
 * 024 architecture note 001 § 2 option C, § 3; 024-FR-001, 024-FR-002).
 *
 * One behaviour, two hosts: the HTML Preview's overlay runs in its sealed
 * preload; this hook is the other host, driven by a {@link PreviewCommentAdapter}
 * and a {@link RendererCommentSource}, so a later `<!-- -->` text preview
 * plugs in with its own adapter and nothing here changes. It owns:
 *
 * - **comment mode** – the shared `overlayCore/modeState` rules; the mode is
 *   per panel in `usePreviewCommentStore`, off while the host is not shown or
 *   no new comment can be written (menu matrix § 2);
 * - **the list** – read through the source on show, on a file change and
 *   after a write, newest answer wins (the store's generations);
 * - **the menu and the window** – the target's menu (`hostMenu.ts`) and the
 *   shared `CommentWindow`, whose `add` is completed here with the adapter's
 *   description of the target (main locates it, C7);
 * - pointer and keyboard picking – `useHostPointerKeys.ts`.
 *
 * Nothing here writes to the preview's content: outline, icons and the mode
 * tab are drawn by `CommentOverlayLayer` outside it (024-FR-024).
 *
 * @module components/Comments/overlay/useCommentOverlayHost
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { hashText } from '../../../../../shared/comments/blocks'
import type { CommentSaveRequest } from '../../../../../shared/ipc/preview-comment-schema'
import type {
  FileCommentListResult,
  FileCommentOpenDraftResult,
  FileCommentSaveRequest,
  FileCommentSaveResult,
  PickedTargetRequest,
  ThreadPlacement
} from '../../../../../shared/ipc/file-comment-schema'
import { reduceCommentMode } from '../../../../../shared/comments/overlayCore/modeState'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { usePanelCommentState, usePreviewCommentStore, type CommentCounts } from '../../../stores/usePreviewCommentStore'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { textClipboard } from '../../../services/textClipboard'
import { getBasename } from '../../../utils/fileUtils'
import { ANNOUNCE, COPY, writtenAnnouncement } from '../commentCopy'
import { ErrorCode } from '../../../../../shared/errors'
import { MARKDOWN_COPY, MD_SURFACE_COPY } from '../commentCopyWords'
import type { CommentDrawerProps } from '../CommentDrawer'
import type { CommentToolbarToolsProps } from '../CommentToolbarTools'
import type { CommentWindowProps } from '../CommentWindow'
import type { CommentWindowRequest } from '../commentWindowTypes'
import { useLiveText } from '../commentLive'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import type { ContextMenuItem } from '../../ContextMenu/ContextMenu'
import { hostMenuItems, hostMenuLabel } from './hostMenu'
import type { PreviewCommentAdapter } from './previewAdapter'
import { useHostPointerKeys } from './useHostPointerKeys'

/** One file's comments as the host reads and writes them (`fileCommentGateway`, bound to a panel and a file). */
export interface RendererCommentSource {
  readonly list: (bufferText?: string) => Promise<FileCommentListResult>
  readonly openDraft: () => Promise<FileCommentOpenDraftResult>
  readonly save: (request: FileCommentSaveRequest) => Promise<FileCommentSaveResult>
  /** Called when main says the file changed on disk; returns the unsubscribe. */
  readonly onChanged: (callback: () => void) => () => void
}

/** Options for {@link useCommentOverlayHost}. */
export interface CommentOverlayHostOptions {
  readonly panelId: string
  readonly filePath: string
  /** Comments are on for this preview (Settings, bridge, file kind). Off: nothing at all. */
  readonly enabled: boolean
  /** The preview is shown where comments live (Markdown: preview-only view, tab visible). */
  readonly shown: boolean
  /** This panel is the active one: the mode shortcut is its own (src/renderer/CLAUDE.md). */
  readonly activePanel: boolean
  readonly adapter: PreviewCommentAdapter
  readonly source: RendererCommentSource
  /** The scrolling element of the preview: pointer, keys and scroll are read there. */
  readonly scroller: HTMLElement | null
  /** The pane the overlay covers: its box is the overlay's and the window's area. */
  readonly area: HTMLElement | null
  /** The scroller's accessible name while live (C-08.1). */
  readonly scrollerLabel: string
  /** Why comments are paused (unsaved editor edits, F-02/F-03), or `null`. */
  readonly paused: string | null
  /** The editor's text while it differs from the file: listed for display only (C-09). */
  readonly bufferText?: string
  readonly onOpenInSource: (line: number) => void
}

/** The open menu: where, about what, and its comment items. */
export interface HostMenu {
  readonly x: number
  readonly y: number
  readonly label: string
  readonly items: ContextMenuItem[]
  readonly mode: boolean
  readonly target: HTMLElement
}

/** Everything the preview draws for comments. */
export interface CommentOverlayHost {
  readonly enabled: boolean
  readonly shown: boolean
  readonly mode: boolean
  readonly showIcons: boolean
  readonly toolbar: CommentToolbarToolsProps
  readonly drawer: CommentDrawerProps | null
  readonly menu: HostMenu | null
  readonly closeMenu: () => void
  readonly window: CommentWindowProps | null
  readonly polite: string
  readonly assertive: string
  /** The target under the pointer or picked by key in comment mode. */
  readonly outlined: HTMLElement | null
  readonly placements: readonly ThreadPlacement[]
  readonly file: CommentFileView | null
  /** Open the thread window on these threads (an icon). */
  readonly openThreads: (threadKeys: readonly string[], anchor: HTMLElement | null) => void
  readonly scrollTick: number
}

/** A pick's draft key: 128 bits of the target's place, so the same target gets its text back. */
function draftKeyOf(pick: PickedTargetRequest): string {
  return hashText(`${pick.lineStart}|${pick.tag}|${pick.ordinal}|${pick.quote?.exact ?? ''}`).slice(0, 32)
}

/** Toolbar counts from the list: open, resolved, and what needs attention. */
function countsOf(file: CommentFileView | null): CommentCounts | null {
  if (file === null) return null
  let open = 0
  let resolved = 0
  let attention = file.damaged.length + file.newer.length
  for (const thread of file.threads) {
    if (thread.status === 'resolved') resolved += 1
    else if (thread.attached) open += 1
    else attention += 1
  }
  return { open, resolved, attention }
}

/** Where a window opened on `el` is anchored: its top-right corner, else the area's upper middle. */
function pointOf(el: HTMLElement | null, area: HTMLElement | null): { x: number; y: number } {
  const box = el?.getBoundingClientRect() ?? area?.getBoundingClientRect()
  if (box === undefined) return { x: 0, y: 0 }
  return el ? { x: box.right, y: box.top } : { x: box.left + box.width / 2, y: box.top + box.height / 3 }
}

/**
 * Wires one renderer-hosted preview's comments.
 *
 * @param options - {@link CommentOverlayHostOptions}
 * @returns {@link CommentOverlayHost}
 */
export function useCommentOverlayHost(options: CommentOverlayHostOptions): CommentOverlayHost {
  const { panelId, filePath, enabled, shown, activePanel, adapter, source, scroller, area, paused } = options
  const words = adapter.words
  const live = enabled && shown
  const identity = useGlobalSettingsStore(s => s.settings?.comments ?? null)
  const updateCommentIdentity = useGlobalSettingsStore(s => s.updateCommentIdentity)
  const state = usePanelCommentState(panelId)
  const store = usePreviewCommentStore
  const drawerId = `comment-drawer-${useId().replace(/[^\w-]/g, '')}`
  const [polite, announce] = useLiveText()
  const [assertive, alert] = useLiveText()
  const [request, setRequest] = useState<CommentWindowRequest | null>(null)
  const [menu, setMenu] = useState<HostMenu | null>(null)
  const [placements, setPlacements] = useState<readonly ThreadPlacement[]>([])
  const [scrollTick, setScrollTick] = useState(0)
  // Main said comments are off in Settings (a race with another window's switch): nothing listed, no new comment.
  const [off, setOff] = useState(false)
  const picks = useRef(new Map<string, PickedTargetRequest>())
  const listButtonRef = useRef<HTMLButtonElement>(null)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  const optionsRef = useLatestRef(options)
  // Set once the pointer hook exists: the mode toggle moves focus with it.
  const focusFirst = useRef<() => void>(() => {})

  const file = state.list.files[0] ?? null
  const fileName = file?.displayPath ?? getBasename(filePath)
  const readOnly = file !== null && !file.writable ? words.readOnlyReasonText(file.readOnlyReason, fileName) : null
  // Off and read-only win over paused: saving the editor would not make the file writable (state table § 4).
  const blocked = (off ? MARKDOWN_COPY.off : null) ?? readOnly ?? paused
  const mode = live && blocked === null && state.mode

  // ---- the list ----
  const refreshList = useCallback(async () => {
    const generation = store.getState().beginList(panelId)
    const result = await optionsRef.current.source.list(optionsRef.current.bufferText)
    const turnedOff = !result.ok && result.reason === 'comments-off'
    const stored = store
      .getState()
      .finishList(
        panelId,
        generation,
        result.ok ? { ok: true, files: [result.file] } : turnedOff ? { ok: true, files: [] } : { ok: false, code: result.code }
      )
    if (!stored) return
    setPlacements(result.ok ? result.placements : [])
    setOff(turnedOff)
  }, [panelId, store, optionsRef])

  const bufferText = options.bufferText
  useEffect(() => {
    if (live) void refreshList()
  }, [live, filePath, bufferText, refreshList])

  useEffect(() => {
    if (!enabled) return undefined
    return source.onChanged(() => {
      if (optionsRef.current.shown) void refreshList()
    })
  }, [enabled, source, refreshList, optionsRef])

  // ---- comment mode (overlayCore/modeState): off while hidden or blocked ----
  const setMode = useCallback(
    (on: boolean) => {
      const step = reduceCommentMode({ on: store.getState().panels.get(panelId)?.mode ?? false }, { type: 'set', on })
      if (step.changed) store.getState().patch(panelId, { mode: step.on })
      return step.changed
    },
    [panelId, store]
  )
  useEffect(() => {
    if (state.mode && (!live || blocked !== null)) {
      store.getState().patch(panelId, { mode: false })
      if (blocked !== null && live) announce(MD_SURFACE_COPY.modeUnavailable(blocked))
    }
  }, [state.mode, live, blocked, panelId, store, announce])

  const toggleMode = useCallback(
    (byKeyboard: boolean) => {
      const on = !(store.getState().panels.get(panelId)?.mode ?? false)
      if (on && blocked !== null) {
        announce(MD_SURFACE_COPY.modeUnavailable(blocked))
        return
      }
      setMode(on)
      announce(on ? words.modeOn : ANNOUNCE.modeOff)
      if (on && byKeyboard) requestAnimationFrame(() => focusFirst.current())
    },
    [panelId, store, blocked, setMode, announce, words]
  )

  // ---- the new-comment window ----
  const openNew = useCallback(
    async (target: HTMLElement, opener: 'page' | 'drawer') => {
      setMenu(null)
      if (blocked !== null || !adapter.canComment(target).ok) return
      const pick = adapter.describe(target)
      if (pick === null) return
      const listed = store.getState().panels.get(panelId)?.list.files[0]
      const draft = await optionsRef.current.source.openDraft()
      if (!draft.ok) {
        alert(words.saveFailure(draft.code, fileName, pick.tag, draft.reason).text)
        return
      }
      picks.current.set(draft.draftToken, pick)
      setRequest({
        kind: 'new',
        panelId,
        draftToken: draft.draftToken,
        draftKey: draftKeyOf(pick),
        target: { tag: pick.tag, classes: [], line: pick.lineStart, excerpt: '' },
        file: {
          fileKey: listed?.fileKey ?? 'pending',
          displayPath: listed?.displayPath ?? fileName,
          filePath: listed?.filePath ?? filePath,
          frame: false
        },
        point: pointOf(target, optionsRef.current.area),
        opener
      })
    },
    [blocked, adapter, store, panelId, optionsRef, alert, words, fileName, filePath]
  )

  const openThreads = useCallback(
    (threadKeys: readonly string[], anchor: HTMLElement | null, opener: 'page' | 'drawer' = 'page') => {
      const listed = store.getState().panels.get(panelId)?.list
      const current = listed?.files[0]
      if (current === undefined) return
      setMenu(null)
      setRequest({
        kind: 'threads',
        panelId,
        fileKey: current.fileKey,
        threadKeys,
        blockKeys: [],
        point: pointOf(anchor, optionsRef.current.area),
        opener,
        listAfter: listed?.generation ?? 0,
        file: { fileKey: current.fileKey, displayPath: current.displayPath, filePath: current.filePath, frame: false }
      })
    },
    [store, panelId, optionsRef]
  )

  const openMenu = useCallback(
    (target: HTMLElement, at: { x: number; y: number }) => {
      const on = store.getState().panels.get(panelId)?.mode === true
      const tag = adapter.tagOf(target)
      const can = adapter.canComment(target)
      const input = { mode: on, tag, blocked, refused: can.ok ? null : can.reason, words }
      setMenu({
        ...at,
        label: hostMenuLabel(input),
        items: hostMenuItems(input, () => void openNew(target, 'page')),
        mode: on,
        target
      })
    },
    [store, panelId, adapter, blocked, words, openNew]
  )

  const pointer = useHostPointerKeys({
    live,
    mode,
    activePanel,
    adapter,
    scroller,
    scrollerLabel: options.scrollerLabel,
    windowOpen: request !== null || menu !== null,
    onToggleMode: toggleMode,
    onExit: () => {
      setMode(false)
      announce(ANNOUNCE.modeOff)
      modeButtonRef.current?.focus()
    },
    onPick: target => void openNew(target, 'page'),
    onMenu: openMenu,
    onSay: announce,
    onScroll: () => setScrollTick(n => n + 1)
  })
  useEffect(() => {
    focusFirst.current = pointer.focusFirst
  }, [pointer.focusFirst])

  // ---- writes ----
  const save = useCallback(
    (request: CommentSaveRequest): Promise<FileCommentSaveResult> => {
      const { source: src, panelId: id, filePath: path, scroller: el } = optionsRef.current
      // A write main could not confirm (C12) may have landed and used up the draft: list again before any retry.
      const relistOnUnconfirmed = (answer: FileCommentSaveResult): FileCommentSaveResult => {
        if (!answer.ok && answer.reason === 'changed-during-save') void refreshList()
        return answer
      }
      if (request.op !== 'add') return src.save(request).then(relistOnUnconfirmed)
      const target = picks.current.get(request.draftToken)
      if (target === undefined) return Promise.resolve({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID, reason: 'key-invalid' })
      const view = {
        w: Math.round(el?.clientWidth ?? 0),
        h: Math.round(el?.clientHeight ?? 0),
        dpr: window.devicePixelRatio || 1,
        x: 0,
        y: Math.round(el?.scrollTop ?? 0)
      }
      return src
        .save({ panelId: id, filePath: path, op: 'add', draftToken: request.draftToken, target, text: request.text, view })
        .then(relistOnUnconfirmed)
    },
    [optionsRef, refreshList]
  )

  const closeWindow = useCallback(() => setRequest(null), [])
  const onWritten = useCallback(
    (written: CommentSaveRequest, name: string) => {
      announce(writtenAnnouncement(written, name || fileName))
      if (written.op === 'add') {
        picks.current.delete(written.draftToken)
        setRequest(null)
      }
      void refreshList()
    },
    [announce, fileName, refreshList]
  )

  const setDrawerOpen = useCallback(
    (open: boolean) => {
      store.getState().patch(panelId, { drawerOpen: open })
      if (open) void refreshList()
      else requestAnimationFrame(() => listButtonRef.current?.focus())
    },
    [panelId, store, refreshList]
  )

  const outlined = mode ? pointer.outlined : null
  const counts = useMemo(() => countsOf(file), [file])

  const toolbar: CommentToolbarToolsProps = {
    mode,
    showIcons: state.showIcons,
    drawerOpen: state.drawerOpen,
    drawerId,
    counts,
    ready: true,
    unavailable: null,
    variant: 'toolbar',
    modeUnavailableText: blocked === null ? null : MD_SURFACE_COPY.modeUnavailable(blocked),
    onToggleMode: toggleMode,
    onToggleDrawer: () => setDrawerOpen(!store.getState().panels.get(panelId)?.drawerOpen),
    onToggleIcons: () => store.getState().patch(panelId, { showIcons: !state.showIcons }),
    modeRef: modeButtonRef,
    listRef: listButtonRef
  }

  const drawer: CommentDrawerProps | null =
    live && state.drawerOpen
      ? {
          id: drawerId,
          list: state.list,
          notVisible: [],
          showIcons: state.showIcons,
          full: false,
          pageFile: fileName,
          onClose: () => setDrawerOpen(false),
          onShowIconsChange: show => store.getState().patch(panelId, { showIcons: show }),
          onReveal: row => {
            const placement = placements.find(p => p.threadKey === row.threadKey)
            const el = placement === undefined ? null : adapter.attach(placement)
            el?.scrollIntoView({ block: 'center' })
          },
          onOpenInSource: row => options.onOpenInSource(row.line),
          onOpen: row => {
            if (row.threadKey !== undefined) openThreads([row.threadKey], null, 'drawer')
            else if (file !== null && row.blockKey !== undefined) {
              setRequest({
                kind: 'threads',
                panelId,
                fileKey: file.fileKey,
                threadKeys: [],
                blockKeys: [row.blockKey],
                point: pointOf(null, area),
                opener: 'drawer',
                listAfter: state.list.generation ?? 0,
                file: { fileKey: file.fileKey, displayPath: file.displayPath, filePath: file.filePath, frame: false }
              })
            }
          },
          onRetry: () => void refreshList()
        }
      : null

  const window_: CommentWindowProps | null =
    live && request !== null
      ? {
          request,
          list: state.list,
          identity,
          notVisible: [],
          getArea: () => {
            const box = optionsRef.current.area?.getBoundingClientRect()
            return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null
          },
          onClose: closeWindow,
          onNewComment: next => setRequest(next),
          onSaveIdentity: data =>
            updateCommentIdentity({
              authorName: data.name,
              authorEmail: data.email === '' ? undefined : data.email,
              identityNoticeSeen: true
            }),
          onSave: save,
          onWritten,
          onRefresh: () => void refreshList(),
          onPickAgain: () => {
            closeWindow()
            if (blocked === null) setMode(true)
          },
          onOpenInSource: (_path, line) => {
            closeWindow()
            options.onOpenInSource(line)
          },
          onCopyRaw: text => {
            void textClipboard.writeText(text).then(ok => (ok ? announce(COPY.rawCopied) : alert(COPY.copyFailed)))
          },
          pausedText: paused
        }
      : null

  return {
    enabled,
    shown: live,
    mode,
    showIcons: state.showIcons,
    toolbar,
    drawer,
    menu: live ? menu : null,
    closeMenu: () => setMenu(null),
    window: window_,
    polite,
    assertive,
    outlined,
    placements,
    file,
    openThreads,
    scrollTick
  }
}

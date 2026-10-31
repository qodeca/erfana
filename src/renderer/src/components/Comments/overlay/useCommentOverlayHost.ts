// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment overlay host for previews Erfana draws in its own DOM (spec
 * 024 architecture note 001 § 2 option C, § 3; 024-FR-001, 024-FR-002).
 *
 * One behaviour, two hosts: the HTML Preview's overlay runs in its sealed
 * preload; this hook is the other host, driven by a `PreviewCommentAdapter`
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
 * - pointer and keyboard picking – `useHostPointerKeys.ts`. A pick on a
 *   target with open threads opens them, not a blank new comment (C-22);
 *   a click on commented words opens that thread (C-17); the menu's "Add
 *   comment" stays the explicit new thread. Turning the mode on with words
 *   selected only turns it on and shows the Comment button (C-16);
 * - the removed-outside note (OD-06, `commentRemovedOutside.ts`);
 * - the window's dock, its reveal of a stepped-to thread, the parent retarget
 *   and the draft keep-alive (C-18, C-13, W-07, C-14.2 – `hostWindow.ts`).
 *
 * Nothing here writes to the preview's content: outline, icons and the mode
 * tab are drawn by `CommentOverlayLayer` outside it (024-FR-024).
 *
 * @module components/Comments/overlay/useCommentOverlayHost
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CommentSaveRequest } from '../../../../../shared/ipc/preview-comment-schema'
import type { FileCommentSaveResult, PickedTargetRequest, ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import { reduceCommentMode } from '../../../../../shared/comments/overlayCore/modeState'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { usePanelCommentState, usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { textClipboard } from '../../../services/textClipboard'
import { getBasename } from '../../../utils/fileUtils'
import { ANNOUNCE, COPY, writtenAnnouncement } from '../commentCopy'
import { ErrorCode } from '../../../../../shared/errors'
import { COMMENT_LIST_COPY, MARKDOWN_COPY, MD_SPOKEN_COPY, MD_SURFACE_COPY, SELECTION_COPY } from '../commentCopyWords'
import { useRemovedOutside } from '../commentRemovedOutside'
import type { CommentDrawerProps } from '../CommentDrawer'
import type { CommentToolbarToolsProps } from '../CommentToolbarTools'
import type { CommentWindowProps } from '../CommentWindow'
import type { CommentWindowRequest, NewCommentWords } from '../commentWindowTypes'
import { useLiveText } from '../commentLive'
import type { AnchorSelection } from '../../../../../shared/comments/anchorSel'
import { commentMarkAt } from './commentHighlights'
import { targetText } from './domWords'
import { blockWindowRequest, revealRow, useNotVisible } from './hostDrawer'
import { draftKeyOf, noNewCommentText, pointOf, spokenTarget, threadsOn, toolbarCounts, viewOf } from './hostParts'
import { hostMenuItems, hostMenuLabel, targetlessMenu } from './hostMenu'
import { drawn, newRequestExtras, threadTarget, useDraftKeepAlive, type HostDock } from './hostWindow'
import type { CommentOverlayHost, CommentOverlayHostOptions, HostMenu } from './hostTypes'
import { useSelectionComments, useWordsCheck } from './useSelectionComments'
import { nounTargetOf } from './previewAdapter'
import { useHostPointerKeys } from './useHostPointerKeys'

export type { CommentOverlayHost, CommentOverlayHostOptions, HostMenu, RendererCommentSource } from './hostTypes'

const NO_THREADS: readonly string[] = []

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
  // The picked element of each new-comment draft: the dock follows it, a retarget climbs from it.
  const pickedTargets = useRef(new Map<string, HTMLElement>())
  const listButtonRef = useRef<HTMLButtonElement>(null)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  const optionsRef = useLatestRef(options)
  // Set once the pointer hook exists: the mode toggle moves focus with it.
  const focusFirst = useRef<(lead?: boolean) => void>(() => {})
  const markOwner = `marks-${drawerId}`

  const file = state.list.files[0] ?? null
  const removed = useRemovedOutside(state.list, words)
  const { ownDelete } = removed
  const fileName = file?.displayPath ?? getBasename(filePath)
  const readOnly = noNewCommentText(file, fileName, words)
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

  const selection = useSelectionComments({ live, blocked, adapter, scroller, area })

  const toggleMode = useCallback(
    (byKeyboard: boolean) => {
      const on = !(store.getState().panels.get(panelId)?.mode ?? false)
      if (on && blocked !== null) {
        announce(MD_SURFACE_COPY.modeUnavailable(blocked))
        return
      }
      setMode(on)
      // C-16: words selected in view – the mode only turns on, with the Comment button over them.
      const selected = on && selection.showButton()
      announce(!on ? ANNOUNCE.modeOff : selected ? MD_SPOKEN_COPY.modeOnSelected : words.modeOn)
      if (on && byKeyboard) {
        requestAnimationFrame(() => {
          // C-10: one sentence on keyboard entry; with words selected, the button's sentence stays the last word.
          focusFirst.current(!selected)
          if (selected) announce(MD_SPOKEN_COPY.modeOnSelected)
        })
      }
    },
    [panelId, store, blocked, setMode, announce, words, selection]
  )

  // ---- the new-comment window ----
  const openNew = useCallback(
    async (target: HTMLElement, opener: 'page' | 'drawer', chosen?: NewCommentWords) => {
      setMenu(null)
      if (blocked !== null || !adapter.canComment(target).ok) return
      const pick = adapter.describe(target)
      if (pick === null) return
      const listed = store.getState().panels.get(panelId)?.list.files[0]
      const draft = await optionsRef.current.source.openDraft(pick)
      if (!draft.ok) {
        alert(words.saveFailure(draft.code, fileName, nounTargetOf(adapter, target), draft.reason).text)
        return
      }
      picks.current.set(draft.draftToken, pick)
      pickedTargets.current.set(draft.draftToken, target)
      setRequest({
        kind: 'new',
        panelId,
        draftToken: draft.draftToken,
        draftKey: draftKeyOf(pick),
        target: { ...nounTargetOf(adapter, target), tag: pick.tag, classes: [], line: pick.lineStart, excerpt: '' },
        file: {
          fileKey: listed?.fileKey ?? 'pending',
          displayPath: listed?.displayPath ?? fileName,
          filePath: listed?.filePath ?? filePath,
          frame: false
        },
        point: pointOf(target, optionsRef.current.area),
        opener,
        // The target's text, for the words and Narrow to words (C-07); a selection brings its range.
        words: chosen ?? { text: targetText(target), start: 0, end: 0, cut: false },
        ...newRequestExtras(target, adapter, draft)
      })
    },
    [blocked, adapter, store, panelId, optionsRef, alert, words, fileName, filePath]
  )

  const openThreads = useCallback(
    (threadKeys: readonly string[], anchor: HTMLElement | null, opener: 'page' | 'drawer' = 'page', blockKeys: readonly string[] = NO_THREADS) => {
      const listed = store.getState().panels.get(panelId)?.list
      const current = listed?.files[0]
      if (current === undefined) return
      setMenu(null)
      setRequest({
        kind: 'threads',
        panelId,
        fileKey: current.fileKey,
        threadKeys,
        blockKeys,
        point: pointOf(anchor, optionsRef.current.area),
        opener,
        listAfter: listed?.generation ?? 0,
        file: { fileKey: current.fileKey, displayPath: current.displayPath, filePath: current.filePath, frame: false }
      })
    },
    [store, panelId, optionsRef]
  )

  // C-22: a pick on a target with open threads opens them; Enter on the target holding the selection opens the words.
  const pickTarget = useCallback(
    (target: HTMLElement, byKey: boolean) => {
      const words = byKey ? selection.read() : null
      if (words !== null && words.target === target && words.refused === null) {
        void openNew(target, 'page', words.words)
        return
      }
      const open = threadsOn(target, adapter, placements, file)
      if (open.length > 0) openThreads(open, target)
      else void openNew(target, 'page')
    },
    [selection, adapter, placements, file, openThreads, openNew]
  )

  // With words selected the menu is about them (M-12, M-14, M-16, M-19, M-21); the target is where they start.
  const openMenu = useCallback(
    (under: HTMLElement | null, at: { x: number; y: number }) => {
      const pick = selection.read()
      const target = pick?.target ?? under
      const on = store.getState().panels.get(panelId)?.mode === true
      if (target === null) {
        if (on) setMenu({ ...at, ...targetlessMenu(words) })
        return
      }
      selection.hideButton()
      const can = adapter.canComment(target)
      const input = { mode: on, ...nounTargetOf(adapter, target), blocked, refused: can.ok ? null : can.reason, words, selection: pick !== null }
      const open = (): void => void openNew(target, 'page')
      const openWords = pick === null ? {} : { openWords: () => void openNew(target, 'page', pick.words) }
      setMenu({
        ...at,
        label: hostMenuLabel(input),
        items: hostMenuItems(input, { open, ...openWords }),
        mode: on,
        target,
        ...(pick === null ? {} : { selectedText: pick.text })
      })
    },
    [store, panelId, adapter, blocked, words, openNew, selection]
  )

  const onSelectionButton = useCallback(() => {
    const pick = selection.read()
    selection.hideButton()
    if (pick !== null && pick.refused === null) void openNew(pick.target, 'page', pick.words)
  }, [selection, openNew])

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
    onWindowEscape: () => setRequest(null),
    onPick: pickTarget,
    speak: target => spokenTarget(target, adapter, placements, file),
    markAt: (x, y) => commentMarkAt(markOwner, x, y),
    onOpenMark: (threadKey, at) => openThreads([threadKey], at),
    onMenu: openMenu,
    selectionRect: () => selection.read()?.rect ?? null,
    onSay: announce,
    onScroll: () => setScrollTick(n => n + 1)
  })
  useEffect(() => {
    focusFirst.current = pointer.focusFirst
  }, [pointer.focusFirst])
  // ---- writes ----
  const liveDraft = useDraftKeepAlive(request?.kind === 'new' ? request.draftToken : null, () => optionsRef.current.source.openDraft())
  const expectWords = useWordsCheck(placements, target => announce(SELECTION_COPY.wordsDropped(words.noun(target), fileName)))
  const save = useCallback(
    (request: CommentSaveRequest, sel?: AnchorSelection): Promise<FileCommentSaveResult> => {
      const { source: src, panelId: id, filePath: path, scroller: el } = optionsRef.current
      // A write main could not confirm (C12) may have landed and used up the draft: list again before any retry.
      const relistOnUnconfirmed = (answer: FileCommentSaveResult): FileCommentSaveResult => {
        if (!answer.ok && answer.reason === 'changed-during-save') void refreshList()
        return answer
      }
      // OD-06: a thread Erfana removes itself is never "removed outside Erfana".
      if (request.op === 'deleteThread' || request.op === 'deleteMessage') ownDelete(request.threadKey)
      if (request.op !== 'add') return src.save(request).then(relistOnUnconfirmed)
      const target = picks.current.get(request.draftToken)
      if (target === undefined) return Promise.resolve({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID, reason: 'key-invalid' })
      const words = sel === undefined ? {} : { sel }
      // C-14.2: the newest draft of the open window, renewed first when it may have lapsed.
      return liveDraft(request.draftToken).then(async draftToken => {
        const add = { panelId: id, filePath: path, op: 'add' as const, draftToken, target, ...words }
        const answer = await src.save({ ...add, text: request.text, view: viewOf(el) })
        // Main keeps the words only where its own parse finds them once (024-FR-004): checked on the next list.
        // When main already said it dropped them, the window says so – the host does not say it twice.
        if (answer.ok && sel !== undefined && answer.threadKey !== null && answer.wordsDropped !== true) {
          expectWords(answer.threadKey, target.tag)
        }
        return relistOnUnconfirmed(answer)
      })
    },
    [optionsRef, refreshList, expectWords, ownDelete, liveDraft]
  )

  const closeWindow = useCallback(() => setRequest(null), [])
  const onWritten = useCallback(
    (written: CommentSaveRequest, name: string) => {
      announce(writtenAnnouncement(written, name || fileName))
      if (written.op === 'add') {
        picks.current.delete(written.draftToken)
        pickedTargets.current.delete(written.draftToken)
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

  // C-18: the docked window follows its target and sits beside the text column; F6 goes to the scroller.
  const placementsRef = useLatestRef(placements)
  const dock = useMemo<HostDock>(
    () => ({
      anchor: threadKey => {
        if (threadKey !== null) return drawn(threadTarget(threadKey, placementsRef.current, adapter))
        return drawn(request?.kind === 'new' ? (pickedTargets.current.get(request.draftToken) ?? null) : null)
      },
      column: () => adapter.root?.() ?? null,
      preview: () => optionsRef.current.scroller
    }),
    [adapter, placementsRef, optionsRef, request]
  )

  const outlined = mode ? pointer.outlined : null
  const { counts, changed } = useMemo(() => toolbarCounts(file), [file])
  const notVisible = useNotVisible(live, adapter, placements, file, scroller)

  const toolbar: CommentToolbarToolsProps = {
    mode,
    drawerOpen: state.drawerOpen,
    drawerId,
    counts,
    changed,
    ready: true,
    unavailable: null,
    variant: 'toolbar',
    modeUnavailableText: blocked === null ? null : MD_SURFACE_COPY.modeUnavailable(blocked),
    onToggleMode: toggleMode,
    onToggleDrawer: () => setDrawerOpen(!store.getState().panels.get(panelId)?.drawerOpen),
    modeRef: modeButtonRef,
    listRef: listButtonRef
  }

  const drawer: CommentDrawerProps | null =
    live && state.drawerOpen
      ? {
          id: drawerId,
          list: state.list,
          notVisible,
          showIcons: state.showIcons,
          full: false,
          pageFile: fileName,
          onClose: () => setDrawerOpen(false),
          onShowIconsChange: show => store.getState().patch(panelId, { showIcons: show }),
          onReveal: row => revealRow(row, placements, adapter, announce),
          onOpenInSource: row => options.onOpenInSource(row.line),
          onOpen: row => {
            if (row.threadKey !== undefined) openThreads([row.threadKey], null, 'drawer')
            else if (file !== null && row.blockKey !== undefined) {
              setRequest(blockWindowRequest(file, row.blockKey, panelId, area, state.list.generation ?? 0))
            }
          },
          onRetry: () => void refreshList(),
          // OD-06: the removed-outside note, and its Copy text.
          removed: removed.removed,
          onDismissRemoved: removed.dismiss,
          onCopyText: text => {
            void textClipboard
              .writeText(text)
              .then(ok => (ok ? announce(COMMENT_LIST_COPY.textCopied) : alert(COMMENT_LIST_COPY.copyTextFailed)))
          }
        }
      : null

  const window_: CommentWindowProps | null =
    live && request !== null
      ? {
          request,
          list: state.list,
          identity,
          notVisible,
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
          pausedText: paused,
          dock,
          // C-13: a step reached this thread – bring its target into view.
          onReveal: threadKey => threadTarget(threadKey, placements, adapter)?.scrollIntoView({ block: 'center' }),
          // W-07: "Comment on the whole {parent}".
          onRetarget: from => {
            const picked = pickedTargets.current.get(from.draftToken)
            const parent = picked === undefined ? null : adapter.parentOf(picked)
            if (parent !== null) void openNew(parent, from.opener)
          }
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
    scrollTick,
    selectionButton: request === null && menu === null ? selection.button : null,
    onSelectionButton,
    markOwner,
    activeThreads: live && request?.kind === 'threads' ? request.threadKeys : NO_THREADS
  }
}

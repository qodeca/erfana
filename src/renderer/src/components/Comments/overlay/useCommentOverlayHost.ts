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
 * - **comment mode** – `useHostCommentMode.ts`: it belongs to the tab, and goes
 *   with the preview view or when no new comment can be written; Esc leaves it
 *   from anywhere in the panel (`onPanelKey`, `commentModeEscape.ts`);
 * - **the list** – `useHostList.ts`: read through the source on show, on a
 *   file change and after a write, newest answer wins;
 * - **the menu and the window** – the target's menu (`hostMenu.ts`) and the
 *   shared `CommentWindow`, whose `add` is completed here with the adapter's
 *   description of the target (main locates it, C7);
 * - pointer and keyboard picking – `useHostPointerKeys.ts`. A pick on a
 *   target with open threads opens them, not a blank new comment (C-22),
 *   with "New comment" minting its draft on demand (I-4), unless text carried
 *   by Pick again is waiting (I-23); a click on commented words opens that
 *   thread (C-17); the menu's "Add comment" stays the explicit new thread.
 *   Turning the mode on with words selected only turns it on and shows the
 *   Comment button (C-16);
 * - a slow save – `useCommentSettleNotices.ts` says how a "still saving" write
 *   ended (W-10), `useSavingSign.ts` stands until a new icon is drawn (P-F17);
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
import type { FileCommentSaveResult, PickedTargetRequest } from '../../../../../shared/ipc/file-comment-schema'
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
import { useNarrowElement } from '../useNarrowPanel'
import type { CommentToolbarToolsProps } from '../CommentToolbarTools'
import type { CommentWindowProps } from '../CommentWindow'
import type { CommentWindowRequest, NewCommentWords } from '../commentWindowTypes'
import { useLiveText } from '../commentLive'
import { renewTrackedDraft } from '../commentPendingWrites'
import { useSaveCommentIdentity } from '../useIdentityGate'
import { fileCommentGateway } from '../../../services/comments/fileCommentGateway'
import { useCommentSettleNotices } from '../useCommentSettleNotices'
import type { AnchorSelection } from '../../../../../shared/comments/anchorSel'
import { pointerOnLines } from '../../../../../shared/comments/overlayCore/selectionRules'
import { commentMarkAt } from './commentHighlights'
import { targetText } from './domWords'
import { areaBox, useNotVisible } from './hostDrawer'
import { draftKeyOf, noNewCommentText, pointOf, spokenTarget, threadsOn, toolbarCounts, unavailableOf, viewOf } from './hostParts'
import { hostMenuItems, hostMenuLabel, targetlessMenu } from './hostMenu'
import { drawn, newRequestExtras, newTargetOf, threadTarget, useDraftKeepAlive, windowTargetOf, type HostDock } from './hostWindow'
import type { CommentOverlayHost, CommentOverlayHostOptions, HostMenu } from './hostTypes'
import { useSelectionComments, useWordsCheck } from './useSelectionComments'
import { nounTargetOf } from './previewAdapter'
import { useHostCommentMode } from './useHostCommentMode'
import { useHostPointerKeys } from './useHostPointerKeys'
import { useHostList } from './useHostList'
import { useSavingSign } from './useSavingSign'
import { useHostThreads } from './useHostThreads'
import { useHostPanelKeys } from './useHostPanelKeys'
import { useHostReveal } from './useHostReveal'

export type { CommentOverlayHost, CommentOverlayHostOptions, HostMenu, RendererCommentSource } from './hostTypes'

const NO_THREADS: readonly string[] = []

/**
 * Wires one renderer-hosted preview's comments.
 *
 * @param options - {@link CommentOverlayHostOptions}
 * @returns {@link CommentOverlayHost}
 */
export function useCommentOverlayHost(options: CommentOverlayHostOptions): CommentOverlayHost {
  const { panelId, filePath, enabled, shown, previewView, activePanel, adapter, scroller, area, paused } = options
  const words = adapter.words
  const live = enabled && shown
  const identity = useGlobalSettingsStore(s => s.settings?.comments ?? null)
  const saveCommentIdentity = useSaveCommentIdentity()
  const state = usePanelCommentState(panelId)
  const store = usePreviewCommentStore
  const drawerId = `comment-drawer-${useId().replace(/[^\w-]/g, '')}`
  const [polite, announce] = useLiveText()
  const [assertive, alert] = useLiveText()
  const [request, setRequest] = useState<CommentWindowRequest | null>(null)
  const [menu, setMenu] = useState<HostMenu | null>(null)
  const [scrollTick, setScrollTick] = useState(0)
  const picks = useRef(new Map<string, PickedTargetRequest>())
  // The picked element of each new-comment draft: the dock follows it, a retarget climbs from it.
  const pickedTargets = useRef(new Map<string, HTMLElement>())
  const listButtonRef = useRef<HTMLButtonElement>(null)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  const optionsRef = useLatestRef(options)
  // Set once the pointer hook exists: the mode toggle moves focus with it.
  const focusFirst = useRef<(lead?: boolean) => void>(() => {})
  const markOwner = `marks-${drawerId}`

  const { refreshList, placements, off, unreadable } = useHostList(options, live)
  const file = state.list.files[0] ?? null
  const removed = useRemovedOutside(state.list, words)
  const { ownDelete } = removed
  const fileName = file?.displayPath ?? getBasename(filePath)
  const readOnly = noNewCommentText(file, fileName, words)
  // Off and read-only win over paused: saving the editor would not make the file writable (state table § 4).
  const blocked = (off ? MARKDOWN_COPY.off : null) ?? readOnly ?? paused
  const mode = live && blocked === null && state.mode

  const setMode = useHostCommentMode({ panelId, inPreview: enabled && previewView, live, blocked, announce })
  const selection = useSelectionComments({ live, blocked, adapter, scroller, area })
  const reveal = useHostReveal(adapter, placements, announce)
  const { openedOn } = reveal

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
      openedOn(draft.draftToken, target)
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
        // The target's text, for the words and Comment on specific words (C-07); a selection brings its range.
        words: chosen ?? { text: targetText(target), start: 0, end: 0, cut: false },
        ...newRequestExtras(target, adapter, draft)
      })
    },
    [blocked, adapter, store, panelId, optionsRef, alert, words, fileName, filePath, openedOn]
  )

  const { onTarget, openThreads, openStepped, openRow } = useHostThreads({
    panelId,
    adapter,
    area,
    onRequest: next => (setMenu(null), setRequest(next)),
    openNew: target => void openNew(target, 'page')
  })

  // C-22: a pick on a target with open threads opens them; Enter on the target holding the selection opens the words.
  const pickTarget = useCallback(
    (target: HTMLElement, byKey: boolean) => {
      const words = byKey ? selection.readInView() : null
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

  // The pointer decides the subject (I-22): on selected words the menu is about them (M-12, M-14, M-16, M-19, M-21). A key has
  // no pointer: it takes the selection, except in comment mode, where it acts on what is outlined (K-11).
  const openMenu = useCallback(
    (under: HTMLElement | null, at: { x: number; y: number }, byKey = false) => {
      const on = store.getState().panels.get(panelId)?.mode === true
      const read = selection.read()
      const subject = byKey ? !on || read?.target === under : read !== null && pointerOnLines(read.lines, at)
      const pick = subject ? read : null
      const target = pick?.target ?? under
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

  const panelKeys = useHostPanelKeys({ live, adapter, file, placements, drawerId, reveal: reveal.showThread, openThreads: openStepped, mode, windowOpen: request !== null, menuOpen: menu !== null, leaveMode: () => (setMode(false), announce(ANNOUNCE.modeOff)), closeWindow: () => setRequest(null) })

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
    onWindowEscape: panelKeys.dismissWindow,
    onPick: pickTarget,
    speak: target => spokenTarget(target, adapter, placements, file),
    markAt: (x, y) => commentMarkAt(markOwner, x, y),
    onOpenMark: (threadKey, at) => openThreads([threadKey], at),
    onMenu: openMenu,
    selectionRect: () => selection.read()?.rect ?? null,
    selectionTarget: () => selection.readInView()?.target ?? null,
    onSelectionAt: (x, y) => pointerOnLines(selection.read()?.lines ?? [], { x, y }),
    onSay: announce,
    onKeyMove: selection.hideButton,
    onScroll: () => setScrollTick(n => n + 1)
  })
  useEffect(() => {
    focusFirst.current = pointer.focusFirst
  }, [pointer.focusFirst])

  const liveDraft = useDraftKeepAlive(request?.kind === 'new' ? request.draftToken : null, () => optionsRef.current.source.openDraft())
  const { saving, expectIcon } = useSavingSign()
  const expectWords = useWordsCheck(placements, target => announce(SELECTION_COPY.wordsDropped(words.noun(target))))
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
        renewTrackedDraft(id, request.draftToken, draftToken)
        const answer = await src.save({ ...add, text: request.text, view: viewOf(el) })
        if (answer.ok && answer.threadKey !== null) expectIcon(answer.threadKey)
        // Main keeps the words only where its own parse finds them once (024-FR-004): checked on the next list.
        // When main already said it dropped them, the window says so – the host does not say it twice.
        if (answer.ok && sel !== undefined && answer.threadKey !== null && answer.wordsDropped !== true) {
          expectWords(answer.threadKey, target.tag)
        }
        return relistOnUnconfirmed(answer)
      })
    },
    [optionsRef, refreshList, expectWords, ownDelete, liveDraft, expectIcon]
  )

  const closeWindow = useCallback(() => setRequest(null), [])
  // W-10: a write answered "still saving" ended: say how, even with its window closed.
  useCommentSettleNotices({
    panelId,
    request,
    pageName: fileName,
    announce,
    alert,
    closeWindow,
    failureText: (code, name, reason) => words.saveFailure(code, name, undefined, reason).text,
    onSettled: landed => {
      if (landed) optionsRef.current.source.written?.()
      void refreshList()
    }
  })
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
  const narrow = useNarrowElement(area, state.drawerOpen)

  const toolbar: CommentToolbarToolsProps = {
    mode,
    drawerOpen: state.drawerOpen,
    drawerId,
    counts,
    changed,
    saving,
    ready: true,
    unavailable: unavailableOf(off, unreadable, file),
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
          full: narrow,
          pageFile: fileName,
          onClose: () => setDrawerOpen(false),
          onShowIconsChange: show => store.getState().patch(panelId, { showIcons: show }),
          onReveal: row => reveal.showRow(row.threadKey),
          revealNote: reveal.note,
          onOpenInSource: row => options.onOpenInSource(row.line),
          onOpen: row => {
            if (row.threadKey !== undefined && row.main === 'reveal') reveal.showThread(row.threadKey)
            if (row.threadKey !== undefined) openRow([row.threadKey], NO_THREADS)
            else if (row.blockKey !== undefined) openRow(NO_THREADS, [row.blockKey])
          },
          onRetry: () => void refreshList(),
          // OD-06: the removed-outside note, and its Copy text.
          removed: removed.removed,
          onDismissRemoved: removed.dismiss,
          onCopyText: text => {
            void textClipboard
              .writeText(text)
              .then(ok => (ok ? announce(COMMENT_LIST_COPY.textCopied) : alert(COMMENT_LIST_COPY.copyTextFailed)))
          },
          onTurnOnMode: mode || blocked !== null ? undefined : () => toggleMode(false),
          bulk: { run: request => fileCommentGateway.bulk({ panelId, ...request }), onSettled: listener => fileCommentGateway.onBulkSettled(event => {
              if (event.panelId === panelId) listener(event)
            }), identity, onSaveIdentity: saveCommentIdentity }
        }
      : null

  const newOnThread = (threadKey: string): (() => void) | null => {
    if (request?.kind !== 'threads' || blocked !== null) return null
    const target = newTargetOf(threadKey, { threadKeys: request.threadKeys, target: onTarget }, placements, adapter)
    return target === null ? null : () => void openNew(target, 'page')
  }
  const shownThread = reveal.steppedIn(request)
  const window_: CommentWindowProps | null =
    live && request !== null
      ? {
          request,
          list: state.list,
          identity,
          notVisible,
          getArea: () => areaBox(optionsRef.current.scroller ?? optionsRef.current.area),
          onClose: closeWindow,
          onNewComment: next => setRequest(next),
          newOnThread,
          onSaveIdentity: saveCommentIdentity,
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
          onReveal: threadKey => reveal.stepTo(request, threadKey),
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
    stepSaid: panelKeys.stepSaid,
    outlined,
    placements,
    file,
    openThreads,
    openStepped,
    scrollTick,
    selectionButton: request === null && menu === null ? selection.button : null,
    onSelectionButton,
    onPanelKey: panelKeys.onPanelKey,
    onPanelKeyCapture: panelKeys.onPanelKeyCapture,
    markOwner,
    activeThreads: !live || request?.kind !== 'threads' ? NO_THREADS : shownThread === null ? request.threadKeys : [shownThread],
    flash: live ? reveal.flash : null,
    windowTarget: live ? windowTargetOf(request, shownThread, reveal.pickedFor, placements, adapter) : null
  }
}

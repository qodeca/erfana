// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One terminal session: the xterm.js instance and the PTY behind it.
 *
 * The hook owns the whole life of a session:
 *
 * - **create** – build the xterm instance, load its addons and the bundled
 *   font, open it in the container (deferring until the container is visible)
 * - **attach** – wire the panel's handlers (parser hooks, keyboard, wheel,
 *   context menu, file drop), run the start-up clear handshake and create the
 *   PTY
 * - **dispose** – {@link UseXtermSessionReturn.teardownTerminal}, the single
 *   teardown every exit path (unmount, project switch, restart) goes through
 *
 * Every timer id and every unsubscribe function lives in a ref, so the
 * teardown can reach all of them (lens review [51], [52], [53]).
 *
 * Start-up is guarded (lens review [18]). Each teardown bumps a generation
 * counter; a start checks it after every await and gives up when it changed,
 * killing a PTY that main created for it in the meantime. Only one start runs
 * per generation – a second call joins the one in flight – so a remount, a
 * restart or a fast project switch can never open two xterms, start two PTYs
 * or attach a late PTY's output to the terminal that replaced it. Before this
 * hook the panel had three hand-maintained teardown copies that had drifted
 * apart: the one-time clear listener and the test-hook registration survived a
 * restart, and the fit and WebGL-recovery timers could fire on a disposed
 * instance.
 *
 * @module TerminalPanel/hooks/useXtermSession
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalStore } from '../../../../stores/useTerminalStore'
import { useClaudeStatusStore } from '../../../../stores/useClaudeStatusStore'
import { registerTestTerminal } from '../../../../testHooks/terminalTestHook'
import { isElementVisible } from '../../../../utils/domUtils'
import { logger } from '../../../../utils/logger'
import type { ShellKind } from '../../../../utils/shellPathEscape'
import { terminalGateway } from '../../../../services/terminalGateway'
import { claudeStatusGateway } from '../../../../services/claudeStatusGateway'
import { hasBridgeMethod } from '../../../../services/bridgePresence'
import { createTerminalLinkHandler, ensureTerminalFontLoaded } from '../terminalPanel.logic'
import { routeTerminalMenuKey } from '../terminalMenuKey'
import { isKeyboardMenuEcho } from '../../../ContextMenu/contextMenuKey'

/**
 * Options of the xterm instance.
 *
 * NOTE: not `TERMINAL_OPTIONS` from terminalPanel.logic – that constant also
 * carries scrollbar colours the panel has never applied. Switching to it would
 * change how the terminal looks, which is out of scope for this refactor.
 */
const XTERM_OPTIONS = {
  cursorBlink: true,
  fontSize: 12,
  fontFamily: "'Cascadia Mono', 'SF Mono', 'Monaco', Consolas, 'Courier New', monospace",
  fontWeight: 'normal',
  fontWeightBold: 'bold',
  allowTransparency: false,
  theme: {
    background: '#000000',
    foreground: '#ffffff',
    cursor: '#4fc1ff',
    cursorAccent: '#000000',
    selectionBackground: '#264f78',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff'
  },
  scrollback: 10000,
  // Keep a manual scroll position while the user types
  scrollOnUserInput: false,
  // No animation lag on wheel or keyboard scroll
  smoothScrollDuration: 0,
  allowProposedApi: true
} as const

/** Resets the screen and scrollback; written at start-up and on main's clear event */
const CLEAR_SEQUENCE = '\x1b[2J\x1b[3J\x1b[H'
/** Delay before the first fit, so the container has its final size */
const INITIAL_FIT_DELAY_MS = 50
/** Pause before the single WebGL recovery attempt, to let the GPU settle */
const WEBGL_RECOVERY_DELAY_MS = 100
/** Trailing debounce of the Claude-status nudge (#216); main gates re-checks too */
const CLAUDE_NUDGE_DEBOUNCE_MS = 1000
/** Output in this window after create is shell start-up noise, not activity */
const WARMUP_MS = 500

/** Anything with a `dispose()` – xterm disposables, parser hooks */
interface Disposable {
  dispose: () => void
}

/**
 * Options for {@link useXtermSession}. The functions are read when a session
 * starts or tears down, never captured at mount, so passing new ones on each
 * render is fine.
 */
export interface UseXtermSessionOptions {
  /**
   * Ref holding the live xterm instance. Created by the panel because the
   * scroll, clipboard and screenshot hooks read it too.
   */
  xtermRef: MutableRefObject<Terminal | null>
  /** The element xterm opens in */
  containerRef: RefObject<HTMLDivElement | null>
  /** Registers the scroll-preserving parser hooks; called right after `open()` */
  registerParserHooks: (xterm: Terminal) => Disposable[]
  /** Custom key handler (clipboard keys, wrapped by scroll lock) */
  keyEventHandler: (event: KeyboardEvent) => boolean
  /** Custom wheel handler (scroll lock) */
  wheelEventHandler: (event: WheelEvent) => boolean
  /** Opens the terminal context menu at viewport coordinates */
  onContextMenu: (x: number, y: number) => void
  /** Attaches the external file-drop listeners for this instance and session */
  attachFileDrop: (xterm: Terminal, terminalIdRef: RefObject<string | null>) => void
  /** Detaches the external file-drop listeners */
  detachFileDrop: () => void
}

/**
 * Options for {@link UseXtermSessionReturn.teardownTerminal}.
 */
export interface TeardownOptions {
  /**
   * Also clear `terminalId` and `error` state. True when another session
   * follows (restart, project switch); false on unmount, where setting state
   * on an unmounting component is pointless.
   */
  resetState: boolean
}

/**
 * What {@link useXtermSession} returns.
 */
export interface UseXtermSessionReturn {
  /** Id of the live PTY session, or null while none exists */
  terminalId: string | null
  /** Same id, for callbacks that must read it without re-rendering */
  terminalIdRef: MutableRefObject<string | null>
  /** Quoting flavour of the live session's shell (#164), from `terminal:create` */
  shellKindRef: MutableRefObject<ShellKind | null>
  /** Fit addon of the live instance */
  fitAddonRef: MutableRefObject<FitAddon | null>
  /** Output before this timestamp is start-up noise and not counted as activity */
  warmupUntilRef: MutableRefObject<number>
  /** Start-up or runtime error shown by the panel */
  error: string | null
  /** Set or clear the panel error (PTY `terminal:error` events report here) */
  setError: (error: string | null) => void
  /**
   * Create the xterm instance and its PTY. Waits for the container to become
   * visible first when it is hidden. Errors are reported through `error`,
   * never thrown. A call while a start of the same generation is running
   * returns that start's promise; a call while a session is live does nothing.
   */
  start: () => Promise<void>
  /**
   * The single teardown. Synchronously, in this order: invalidates a start in
   * flight (see the module doc), clears every timer,
   * stops a deferred start, removes every listener, releases the session in
   * the app stores, disposes xterm and nulls its refs; then kills the PTY.
   *
   * @returns Resolves once the PTY kill has been answered (errors are logged)
   */
  teardownTerminal: (options: TeardownOptions) => Promise<void>
  /** Debounced Claude-status re-check for activity on `id` (#216) */
  nudgeClaudeStatus: (id: string) => void
  /**
   * Report that the `terminal:data` listener for `id` is attached. A clear
   * confirmation waiting for it is sent now: main flushes the output it held
   * back as soon as it gets the confirmation, so the listener must exist first.
   */
  onDataListenerAttached: (id: string) => void
  /** Report that the `terminal:data` listener for `id` is gone */
  onDataListenerDetached: (id: string) => void
}

/**
 * Own one xterm.js instance and the PTY session behind it.
 *
 * @param options - Container, shared xterm ref, and the handlers to attach
 * @returns Session state plus `start` and the single `teardownTerminal`
 *
 * @example
 * ```tsx
 * const session = useXtermSession({ xtermRef, containerRef, ...handlers })
 * useEffect(() => {
 *   if (isAvailable) void session.start()
 *   return () => void session.teardownTerminal({ resetState: false })
 * }, [isAvailable, session.start, session.teardownTerminal])
 * ```
 */
export function useXtermSession(options: UseXtermSessionOptions): UseXtermSessionReturn {
  const { xtermRef, containerRef } = options
  // Latest handlers, read when a start or teardown runs (see the options doc)
  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    optionsRef.current = options
  })

  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const shellKindRef = useRef<ShellKind | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const warmupUntilRef = useRef(0)

  // Timers – every id is held so teardown can clear it ([52])
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const webglRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const claudeNudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listeners and disposables – every one is held so teardown can release it ([51])
  const clearUnsubscribeRef = useRef<(() => void) | null>(null)
  const testTerminalUnregisterRef = useRef<(() => void) | null>(null)
  const contextMenuHandlerRef = useRef<((e: MouseEvent) => void) | null>(null)
  const parserDisposablesRef = useRef<Disposable[]>([])
  const inputDisposableRef = useRef<Disposable | null>(null)

  // Start-up guard ([18]): bumped by every teardown, checked after every await
  const generationRef = useRef(0)
  const inFlightStartRef = useRef<{ generation: number; promise: Promise<void> } | null>(null)

  // Deferred start while the container is hidden
  const pendingStartRef = useRef(false)
  const visibilityObserverRef = useRef<ResizeObserver | null>(null)

  // Clear handshake: id whose data listener is attached, and confirmations waiting for it
  const dataListeningIdRef = useRef<string | null>(null)
  const clearConfirmWaitersRef = useRef(new Map<string, () => void>())

  useEffect(() => {
    terminalIdRef.current = terminalId
  }, [terminalId])

  const nudgeClaudeStatus = useCallback((id: string) => {
    if (claudeNudgeTimerRef.current) clearTimeout(claudeNudgeTimerRef.current)
    claudeNudgeTimerRef.current = setTimeout(() => {
      claudeNudgeTimerRef.current = null
      // Asked first: tests and non-Electron renders have no bridge (#352)
      if (hasBridgeMethod('claudeStatus', 'nudge')) void claudeStatusGateway.nudge(id)
    }, CLAUDE_NUDGE_DEBOUNCE_MS)
  }, [])

  const confirmWhenDataListening = useCallback((id: string, confirm: () => void) => {
    if (dataListeningIdRef.current === id) {
      confirm()
    } else {
      clearConfirmWaitersRef.current.set(id, confirm)
    }
  }, [])

  const onDataListenerAttached = useCallback((id: string) => {
    dataListeningIdRef.current = id
    const waiting = clearConfirmWaitersRef.current.get(id)
    if (waiting) {
      clearConfirmWaitersRef.current.delete(id)
      waiting()
    }
  }, [])

  const onDataListenerDetached = useCallback((id: string) => {
    if (dataListeningIdRef.current === id) dataListeningIdRef.current = null
    clearConfirmWaitersRef.current.delete(id)
  }, [])

  const stopVisibilityWait = useCallback(() => {
    pendingStartRef.current = false
    const observer = visibilityObserverRef.current
    visibilityObserverRef.current = null
    if (!observer) return
    try {
      observer.disconnect()
    } catch (e) {
      logger.warn('Failed to disconnect visibility observer', errorFields(e))
    }
  }, [])

  /** Release what a start attached before it failed, or what outlives a session */
  const releaseStartListeners = useCallback(() => {
    clearUnsubscribeRef.current?.()
    clearUnsubscribeRef.current = null
    testTerminalUnregisterRef.current?.()
    testTerminalUnregisterRef.current = null
    optionsRef.current.detachFileDrop()
  }, [])

  const teardownTerminal = useCallback(
    ({ resetState }: TeardownOptions): Promise<void> => {
      const id = terminalIdRef.current

      // 0. Invalidate a start still in flight: it gives up at its next await
      generationRef.current += 1
      inFlightStartRef.current = null

      // 1. Timers, so none fires on what is torn down below
      for (const timerRef of [fitTimerRef, webglRecoveryTimerRef, claudeNudgeTimerRef]) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = null
      }

      // 2. A start still waiting for the container to become visible
      stopVisibilityWait()

      // 3. Listeners: clear handshake, test hook, file drop, context menu,
      //    parser hooks, user input – all before the instance they point at goes
      releaseStartListeners()
      const xterm = xtermRef.current
      if (xterm?.element && contextMenuHandlerRef.current) {
        xterm.element.removeEventListener('contextmenu', contextMenuHandlerRef.current)
      }
      contextMenuHandlerRef.current = null
      parserDisposablesRef.current.forEach((d) => d.dispose())
      parserDisposablesRef.current = []
      inputDisposableRef.current?.dispose()
      inputDisposableRef.current = null

      // 4. The session in the app stores: no active terminal, no Claude tracking (#216)
      terminalIdRef.current = null
      shellKindRef.current = null
      useTerminalStore.getState().setActiveTerminal(null)
      if (id) {
        if (hasBridgeMethod('claudeStatus', 'unregister')) void claudeStatusGateway.unregister(id)
        // Prune the slice, or the map keeps a stale entry per closed terminal
        useClaudeStatusStore.getState().clearTerminal(id)
      }

      // 5. The instance itself
      xterm?.dispose()
      xtermRef.current = null
      fitAddonRef.current = null

      if (resetState) {
        setTerminalId(null)
        setError(null)
      }

      // 6. The PTY. Last, and awaited by the callers that start a new session,
      //    so the next one is never created while this one is still alive
      if (!id) return Promise.resolve()
      // An async IIFE calls kill synchronously, before the first await, so an
      // unmount still sends it in the same tick
      return (async () => {
        try {
          await terminalGateway.kill(id)
        } catch (err) {
          logger.error('Failed to kill terminal', err instanceof Error ? err : undefined)
        }
      })()
    },
    [xtermRef, stopVisibilityWait, releaseStartListeners]
  )

  // Stable identity; the implementation below is republished each render
  const startImplRef = useRef<(generation: number) => Promise<void>>(() => Promise.resolve())
  const start = useCallback((): Promise<void> => {
    const generation = generationRef.current
    // One start per generation: a second call (a remount, an effect re-run,
    // a restart racing a project switch) joins the one already running
    const inFlight = inFlightStartRef.current
    if (inFlight && inFlight.generation === generation) return inFlight.promise
    const promise: Promise<void> = startImplRef.current(generation).finally(() => {
      if (inFlightStartRef.current?.promise === promise) inFlightStartRef.current = null
    })
    inFlightStartRef.current = { generation, promise }
    return promise
  }, [])

  /** Defer the start until the container has a size (xterm cannot open hidden) */
  const waitForVisibility = (container: HTMLElement): void => {
    logger.warn('Terminal container not visible, waiting for visibility...')
    stopVisibilityWait()
    pendingStartRef.current = true
    const observer = new ResizeObserver(() => {
      const current = containerRef.current
      if (current && pendingStartRef.current && isElementVisible(current)) {
        stopVisibilityWait()
        void start()
      }
    })
    visibilityObserverRef.current = observer
    try {
      observer.observe(container)
    } catch (e) {
      logger.warn('Failed to observe terminal visibility', errorFields(e))
    }
  }

  /** Load the GPU renderer after open(); on context loss try once, then stay on canvas */
  const loadWebgl = async (xterm: Terminal, isCurrent: () => boolean): Promise<void> => {
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl')
      // Torn down during the import: the instance is already disposed
      if (!isCurrent()) return
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        logger.warn('WebGL context lost, attempting recovery')
        webglAddon.dispose()
        webglRecoveryTimerRef.current = setTimeout(() => {
          webglRecoveryTimerRef.current = null
          // The instance may have been replaced or disposed meanwhile
          if (xtermRef.current !== xterm) return
          try {
            const recoveryAddon = new WebglAddon()
            recoveryAddon.onContextLoss(() => {
              logger.warn('Second WebGL context loss, staying with canvas renderer')
              recoveryAddon.dispose()
            })
            xterm.loadAddon(recoveryAddon)
            logger.info('WebGL context recovered successfully')
          } catch (err) {
            logger.warn('WebGL recovery failed, canvas renderer active', errorFields(err))
          }
        }, WEBGL_RECOVERY_DELAY_MS)
      })
      xterm.loadAddon(webglAddon)
    } catch (err) {
      logger.warn('WebGL renderer failed, falling back to canvas', errorFields(err))
    }
  }

  /** Attach the panel's handlers to a freshly opened instance */
  const attachHandlers = (xterm: Terminal): void => {
    const handlers = optionsRef.current
    // After open(), when the parser API exists
    parserDisposablesRef.current = handlers.registerParserHooks(xterm)
    xterm.attachCustomKeyEventHandler((event) => {
      // Shift+F10 / the Menu key open the terminal's context menu (#90)
      // instead of reaching the shell. xterm keeps its helper textarea at
      // the cursor, so its box is where the menu opens.
      const caret = xterm.textarea ?? xterm.element ?? null
      const open = (x: number, y: number): void => optionsRef.current.onContextMenu(x, y)
      /* deviates: design/system/components/menu/index.html — no aria-haspopup/expanded: xterm owns its textarea. */
      if (routeTerminalMenuKey(event, caret, open)) return false
      return handlers.keyEventHandler(event)
    })
    xterm.attachCustomWheelEventHandler(handlers.wheelEventHandler)

    if (!xterm.element) return
    // On xterm.element, not the container: xterm captures the event
    // internally, and the element travels with the terminal when it is portaled
    const handleContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      // Windows also sends a native contextmenu for the Menu key, after
      // the key handler above already opened the menu at the cursor.
      if (isKeyboardMenuEcho()) return
      // No xterm.blur() any more: the menu moves focus into itself on open
      // (#90), and it must see the terminal as its opener so that Escape
      // hands focus back to the terminal rather than to <body>.
      optionsRef.current.onContextMenu(e.clientX, e.clientY)
    }
    xterm.element.addEventListener('contextmenu', handleContextMenu)
    contextMenuHandlerRef.current = handleContextMenu
    handlers.attachFileDrop(xterm, terminalIdRef)
  }

  /**
   * Undo what a failed start attached to its instance once it was in the
   * refs – timers, context menu, parser hooks, input – then dispose it and
   * clear the refs. The PTY was never created, so there is nothing to kill.
   */
  const releaseFailedInstance = (xterm: Terminal): void => {
    for (const timerRef of [fitTimerRef, webglRecoveryTimerRef]) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (xterm.element && contextMenuHandlerRef.current) {
      xterm.element.removeEventListener('contextmenu', contextMenuHandlerRef.current)
    }
    contextMenuHandlerRef.current = null
    parserDisposablesRef.current.forEach((d) => d.dispose())
    parserDisposablesRef.current = []
    inputDisposableRef.current?.dispose()
    inputDisposableRef.current = null
    xtermRef.current = null
    fitAddonRef.current = null
    disposeQuietly(xterm)
  }

  const startImpl = async (generation: number): Promise<void> => {
    // False once a teardown ran after this start began
    const isCurrent = (): boolean => generation === generationRef.current
    const container = containerRef.current
    if (!container) return
    // A session already lives in this generation; a second one would orphan it
    if (xtermRef.current) return
    if (!isElementVisible(container)) {
      waitForVisibility(container)
      return
    }

    // Outside the try, so a failure at any step can still dispose it (no leak)
    let started: Terminal | null = null
    try {
      // --- create ---
      const xterm = new Terminal(XTERM_OPTIONS)
      started = xterm
      const fitAddon = new FitAddon()
      // Links go through the checked IPC path, never the addon's default window.open
      const webLinksAddon = new WebLinksAddon(
        createTerminalLinkHandler(
          (url) => window.electron.shell.openExternal(url),
          (err) => logger.warn('Terminal link not opened', { error: err instanceof Error ? err.message : String(err) })
        )
      )
      xterm.loadAddon(fitAddon)
      xterm.loadAddon(webLinksAddon)

      // xterm measures glyphs at open(); a web font that has not loaded yet
      // would be cached as fallback metrics and misalign the grid later
      await ensureTerminalFontLoaded()
      // Not in the refs yet, so nothing else would dispose it
      if (!isCurrent() || !containerRef.current) {
        xterm.dispose()
        return
      }
      xterm.open(containerRef.current)
      // In the refs from here on, so a teardown during the awaits below
      // disposes this instance and releases what is attached to it
      xtermRef.current = xterm
      fitAddonRef.current = fitAddon

      // --- attach ---
      attachHandlers(xterm)

      xterm.clear()
      xterm.write(CLEAR_SEQUENCE)
      // After open(): loading it earlier breaks canvas rendering in Electron
      await loadWebgl(xterm, isCurrent)
      if (!isCurrent()) return

      fitTimerRef.current = setTimeout(() => {
        fitTimerRef.current = null
        if (xtermRef.current === xterm) fitAddon.fit()
      }, INITIAL_FIT_DELAY_MS)

      // Subscribe to clear events BEFORE the PTY exists: main starts marker
      // detection immediately. The id is only known once create resolves, so
      // events seen before then are held, and every event is matched against
      // the id so another terminal's start-up cannot clear this one.
      let createdId: string | null = null
      const earlyClearIds = new Set<string>()
      const runClear = (id: string): void => {
        logger.info(`[INIT] Received clear event for terminal ${id}`)
        xterm.write(CLEAR_SEQUENCE, () => {
          logger.info('[INIT] Clear sequence complete, confirming once the data listener is attached')
          confirmWhenDataListening(id, () => terminalGateway.markClearComplete(id))
          // One clear per session: drop this listener – only this one, the ref
          // may already hold the next session's
          unsubscribeClear()
          if (clearUnsubscribeRef.current === unsubscribeClear) clearUnsubscribeRef.current = null
        })
      }
      const unsubscribeClear = terminalGateway.onClear((data) => {
        if (createdId === null) {
          earlyClearIds.add(data.terminalId)
          return
        }
        if (data.terminalId === createdId) runClear(createdId)
      })
      clearUnsubscribeRef.current = unsubscribeClear

      // No cwd: main opens the terminal in the session's project root, so a
      // stale path during a project switch cannot fail the start
      const result = await terminalGateway.create({ cols: xterm.cols, rows: xterm.rows })
      if (!isCurrent()) {
        // Torn down while main was creating it: nothing owns this PTY, so end
        // it here rather than leave a shell running with no terminal
        if (result.success) killOrphan(result.terminalId)
        return
      }
      if (!result.success) {
        throw new Error(result.error || 'Failed to create terminal')
      }

      const id = result.terminalId
      createdId = id
      // Synchronously, not only through the state effect: a teardown before
      // the next commit must still see the id, or it could not kill the PTY
      terminalIdRef.current = id
      setTerminalId(id)
      if (earlyClearIds.has(id)) runClear(id)
      testTerminalUnregisterRef.current = registerTestTerminal(id, xterm)
      // Kept with the id so a screenshot path-paste quotes for this shell (#164)
      shellKindRef.current = result.shellKind ?? null
      useTerminalStore.getState().setActiveTerminal({ id, shellKind: result.shellKind ?? null })
      if (hasBridgeMethod('claudeStatus', 'register')) void claudeStatusGateway.register(id)
      warmupUntilRef.current = Date.now() + WARMUP_MS

      inputDisposableRef.current = xterm.onData((data) => {
        const store = useTerminalStore.getState()
        // Input counts as activity, so a long command with sparse output still reads as busy
        store.markActivity(id)
        store.markUserInput(id)
        nudgeClaudeStatus(id)
        terminalGateway.write(id, data)
      })
    } catch (err) {
      if (!isCurrent()) {
        // The listeners in the refs now belong to the next session, or to none.
        // An instance that never reached the refs was not disposed by that
        // teardown, so it is disposed here.
        if (started && xtermRef.current !== started) disposeQuietly(started)
        logger.warn('Superseded terminal start failed', errorFields(err))
        return
      }
      releaseStartListeners()
      // This start's instance must not survive it: one left in the refs would
      // block every later start (the `xtermRef.current` guard above), so
      // "Recheck" could never create a terminal again. One that failed before
      // reaching the refs (font load, open()) would simply leak.
      if (started) {
        if (xtermRef.current === started) releaseFailedInstance(started)
        else disposeQuietly(started)
      }
      logger.error('Failed to initialize terminal', err instanceof Error ? err : undefined)
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  // Published after commit, before any effect can call `start`
  useLayoutEffect(() => {
    startImplRef.current = startImpl
  })

  return {
    terminalId,
    terminalIdRef,
    shellKindRef,
    fitAddonRef,
    warmupUntilRef,
    error,
    setError,
    start,
    teardownTerminal,
    nudgeClaudeStatus,
    onDataListenerAttached,
    onDataListenerDetached
  }
}

/** Dispose an instance on a failure path, where a second error must not mask the first */
function disposeQuietly(xterm: Terminal): void {
  try {
    xterm.dispose()
  } catch (err) {
    logger.warn('Failed to dispose terminal instance', errorFields(err))
  }
}

/** End a PTY that main created for a start that was torn down meanwhile */
function killOrphan(terminalId: string): void {
  logger.info('Killing a terminal created after its start was superseded')
  void (async () => {
    try {
      await terminalGateway.kill(terminalId)
    } catch (err) {
      logger.error('Failed to kill superseded terminal', err instanceof Error ? err : undefined)
    }
  })()
}

/** Log fields for an unknown thrown value */
function errorFields(e: unknown): Record<string, unknown> {
  return e instanceof Error ? { error: e.message, stack: e.stack } : { error: String(e) }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Api } from './index'
import type { LogEntry } from '../shared/ipc/logging-schema'

/** The bridges the renderer reaches through a gateway in `services/`, never off `window.api`. */
type GatewayBridges =
  | 'file'
  | 'terminal'
  | 'fileWatch'
  | 'directoryWatch'
  | 'git'
  | 'gitWatcher'
  | 'gitPolling'
  | 'settings'
  | 'globalSettings'
  | 'logging'
  | 'quit'
  | 'system'
  | 'clipboard'
  | 'testHooks'
  | 'import'
  | 'transcription'
  | 'whisper'
  | 'camera'
  | 'pdf'
  | 'docx'
  | 'imageExport'
  | 'browser'
  | 'markdownImage'

declare global {
  interface Window {
    electron: {
      shell: {
        openExternal: (url: string) => Promise<void>
      }
    }
    /**
     * Derived from the preload object itself, so it cannot drift from it. The
     * bridges that have a gateway are left out on purpose: the renderer reaches
     * them through their gateway in `services/` (see docs/ipc-patterns.md §
     * Renderer gateways).
     */
    api: Omit<Api, GatewayBridges>
    /**
     * Area-select overlay API exposed only by the per-display overlay
     * BrowserWindows via `src/preload/screenshotOverlay.ts`. `undefined`
     * in every other renderer — declared optional so callers must guard.
     *
     * @see Issue #164 (lens-review F[6]) - split preload bundle.
     */
    overlayApi?: {
      areaSelected: (
        selection: import('../shared/ipc/screenshot-schema').AreaSelection
      ) => void
      areaCancelled: () => void
      /**
       * One-way log forward over the shared `logging:log` channel — the only
       * evidence trail the overlay window can produce (#60). Optional so a
       * stale bundle without it still type-checks at the call site.
       */
      log?: (entry: LogEntry) => void
    }
    /**
     * E2E crash-injection flag, exposed by `src/preload/index.ts` only when the
     * main process appended `--erfana-force-crash` (unpackaged +
     * `ERFANA_E2E_FORCE_CRASH=1`). `undefined` in every normal run — declared
     * optional and literal `true` so callers must test for it explicitly.
     *
     * @see docs/design/design-issue-60.md §2.8
     */
    __ERFANA_FORCE_CRASH__?: true
    /** Installed by the renderer only when `api.testHooks.enabled` is true. */
    __erfanaTest?: {
      /** The text of a terminal's xterm buffer, or null for an unknown id */
      terminalText: (terminalId: string) => string | null
      /** The cursor position in a terminal's buffer, or null for an unknown id */
      terminalCursor: (terminalId: string) => { x: number; y: number } | null
      /**
       * The model value of the Monaco editor rendered inside `container`, or
       * null when no live editor is there
       */
      editorValue: (container: Element) => string | null
    }
  }
}

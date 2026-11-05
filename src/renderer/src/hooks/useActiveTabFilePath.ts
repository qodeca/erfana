// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The file the active editor-area tab shows, kept current (#453).
 *
 * "Active" is dockview's `activePanel`: the active tab of the focused group,
 * so in a split view only one tab counts. The path is the panel's
 * `params.filePath` – never read back out of a panel id (src/renderer/CLAUDE.md)
 * – which a preview tab rewrites when it moves to another page, so that move
 * counts as a change too.
 *
 * @module hooks/useActiveTabFilePath
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { DockviewApi, DockviewIDisposable, IDockviewPanel } from 'dockview'
import { useProjectStore } from '../stores/useProjectStore'

/** The path a panel shows, or `null` for a panel with no file (the Welcome tab). */
function panelFilePath(panel: IDockviewPanel | undefined): string | null {
  const value = (panel?.params as { filePath?: unknown } | undefined)?.filePath
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Subscribe to every change of the active tab's file: a tab switch, a group
 * switch, and a page change inside the active tab.
 */
function subscribeToActiveFile(api: DockviewApi, onChange: () => void): () => void {
  let params: DockviewIDisposable | null = null
  const follow = (): void => {
    params?.dispose()
    params = api.activePanel?.api.onDidParametersChange(onChange) ?? null
    onChange()
  }
  follow()
  const panel = api.onDidActivePanelChange(follow)
  const group = api.onDidActiveGroupChange(follow)
  return () => {
    panel.dispose()
    group.dispose()
    params?.dispose()
  }
}

/**
 * The absolute path of the file in the active editor-area tab.
 *
 * @returns The path, or `null` before the editor area is ready and while the
 *   active tab shows no file
 *
 * @example
 * ```tsx
 * const activeFile = useActiveTabFilePath()
 * useEffect(() => { if (activeFile) reveal(activeFile) }, [activeFile])
 * ```
 */
export function useActiveTabFilePath(): string | null {
  const api = useProjectStore((state) => state.dockviewApi)
  const subscribe = useCallback(
    (onChange: () => void) => (api ? subscribeToActiveFile(api, onChange) : () => {}),
    [api]
  )
  const getSnapshot = useCallback(() => panelFilePath(api?.activePanel), [api])
  return useSyncExternalStore(subscribe, getSnapshot)
}

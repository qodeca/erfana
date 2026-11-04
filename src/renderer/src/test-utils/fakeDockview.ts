// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A fake editor-area dockview API with just what "which file is active" reads:
 * `activePanel`, `onDidActivePanelChange`, `onDidActiveGroupChange`, and each
 * panel's `params` with `api.onDidParametersChange`.
 *
 * Install it with `useProjectStore.setState({ dockviewApi: fake.api })`, then
 * drive it from the test: `activate(path)` is a tab switch, `movePage(path)`
 * a preview tab moving to another page inside the same tab.
 */
import type { DockviewApi } from 'dockview'

type Listener = () => void

/** One fake tab: its params and its parameter-change event. */
interface FakePanel {
  params: { filePath?: string }
  api: { onDidParametersChange: (listener: Listener) => { dispose: () => void } }
}

/** Handle returned by {@link createFakeDockview}. */
export interface FakeDockview {
  /** Pass to `useProjectStore.setState({ dockviewApi })`. */
  api: DockviewApi
  /** Make a tab showing `filePath` active (`null`: a tab with no file, like Welcome). */
  activate: (filePath: string | null) => void
  /** The active tab moves to another page, as a preview tab does. */
  movePage: (filePath: string) => void
  /** How many listeners are attached right now – 0 after every unsubscribe. */
  listenerCount: () => number
}

function emitter(): { on: (l: Listener) => { dispose: () => void }; fire: () => void; size: () => number } {
  const listeners = new Set<Listener>()
  return {
    on: (listener) => {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    },
    fire: () => listeners.forEach((listener) => listener()),
    size: () => listeners.size
  }
}

/**
 * Build a fake dockview API.
 *
 * @returns The API and the controls that drive it
 */
export function createFakeDockview(): FakeDockview {
  const activeChange = emitter()
  const groupChange = emitter()
  const paramEmitters: Array<ReturnType<typeof emitter>> = []
  let active: FakePanel | undefined

  const makePanel = (filePath: string | null): FakePanel => {
    const params = emitter()
    paramEmitters.push(params)
    return { params: filePath === null ? {} : { filePath }, api: { onDidParametersChange: params.on } }
  }

  const api = {
    get activePanel() {
      return active
    },
    onDidActivePanelChange: activeChange.on,
    onDidActiveGroupChange: groupChange.on
  } as unknown as DockviewApi

  return {
    api,
    activate: (filePath) => {
      active = makePanel(filePath)
      activeChange.fire()
    },
    movePage: (filePath) => {
      if (!active) throw new Error('No active tab to move')
      active.params = { filePath }
      paramEmitters[paramEmitters.length - 1].fire()
    },
    listenerCount: () =>
      activeChange.size() + groupChange.size() + paramEmitters.reduce((sum, e) => sum + e.size(), 0)
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E test hook: `window.__erfanaTest.editorValue(container)`.
 *
 * Returns the model value of the Monaco editor rendered inside `container` (the
 * `editor-monaco` element an e2e locator resolved), so a test reads the editor
 * directly instead of through select-all, copy and the OS clipboard, which is
 * machine-wide and can hand back a stale copy (lens review finding 37).
 *
 * Installed only when the launcher switched the hooks on (see
 * testHookSurface.ts); in every other run nothing is recorded.
 */
import type * as monaco from 'monaco-editor'

import { hooksEnabled, provideTestHook } from './testHookSurface'

const editors = new Set<monaco.editor.ICodeEditor>()

function editorValue(container: Element): string | null {
  for (const editor of editors) {
    if (container.contains(editor.getContainerDomNode())) {
      return editor.getModel()?.getValue() ?? null
    }
  }
  return null
}

/**
 * Make an editor's model readable through the hook. A no-op unless the hooks
 * are on. The editor is forgotten when it is disposed, or when the returned
 * function is called, whichever comes first.
 *
 * @returns A function that forgets the editor again
 */
export function registerTestEditor(editor: monaco.editor.ICodeEditor): () => void {
  if (!hooksEnabled()) return () => {}
  provideTestHook('editorValue', editorValue)
  editors.add(editor)
  const forget = (): void => {
    editors.delete(editor)
  }
  editor.onDidDispose(forget)
  return forget
}

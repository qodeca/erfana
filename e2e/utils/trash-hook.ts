// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The trash test hook from a spec (#486). In an e2e build the project tree's
 * Delete goes to a stub trash that removes the item from disk and records it,
 * so a run never fills the real Recycle Bin / Trash
 * (`src/main/testHooks/trashHook.ts`).
 */
import type { ElectronApplication } from '@playwright/test'
import { basename } from 'path'

type TrashHookMethod = 'trashed' | 'handlesAtTrash' | 'failNext' | 'inUseNext' | 'reset'

/** Call `__erfanaTestHooks.trash.<name>(...args)` in main. */
export async function trashHook<T = unknown>(
  app: ElectronApplication,
  name: TrashHookMethod,
  ...args: unknown[]
): Promise<T> {
  return (await app.evaluate(
    async (_electron, [hookName, hookArgs]) => {
      const hooks = (
        globalThis as unknown as { __erfanaTestHooks?: { trash?: Record<string, (...a: unknown[]) => unknown> } }
      ).__erfanaTestHooks
      if (!hooks?.trash) throw new Error('Trash test hook is not installed (build with npm run build:e2e)')
      return hooks.trash[hookName as string]!(...(hookArgs as unknown[]))
    },
    [name, args] as const
  )) as T
}

/**
 * The names of the entries the stub trash received. Names, not paths: main
 * records the canonical path, which may spell the temp folder differently.
 */
export async function trashedNames(app: ElectronApplication): Promise<string[]> {
  return (await trashHook<string[]>(app, 'trashed')).map((p) => basename(p))
}

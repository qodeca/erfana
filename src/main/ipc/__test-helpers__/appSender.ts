// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Fake `webContents` for the IPC trust gates (spec 025 commit 1).
 *
 * Every gate now requires the sending `webContents` to be a registered Erfana
 * window (`appWebContents.ts`) as well as the right frame URL. Suites that
 * drive a real predicate use these instead of stubbing the identity check
 * away, so the identity half stays under test everywhere:
 *
 * - {@link createAppSender} – a registered window, as `src/main/index.ts`
 *   registers the main window.
 * - {@link createFakeWebContents} – an unregistered one, the stand-in for a
 *   browser tab that loaded the renderer entry file.
 *
 * Suites that call `vi.resetModules()` and re-import the predicate get a fresh
 * `appWebContents` module, which the static import below does not see. They
 * register with {@link registerInCurrentModule} after re-importing the code
 * under test.
 */
import { registerAppWebContents } from '../appWebContents'

/** A minimal `webContents` with the members the gates and the registry use. */
export interface FakeWebContents {
  readonly id: number
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): FakeWebContents
  /** Mark destroyed and fire the 'destroyed' listeners, as Electron does. */
  destroy(): void
}

/**
 * Ids start far above anything a suite would hand-pick, and every fake gets a
 * new one, so an unregistered fake can never share an id with a registered one.
 */
let nextId = 900_000

/**
 * An unregistered fake `webContents`. Takes a fresh unique id unless the suite
 * needs a specific one (an id the code under test records, such as the owning
 * window of a terminal); a suite that picks ids keeps them distinct itself.
 */
export function createFakeWebContents(id: number = nextId++): FakeWebContents {
  let destroyed = false
  const destroyedListeners: Array<() => void> = []
  const fake: FakeWebContents = {
    id,
    isDestroyed: () => destroyed,
    once: (_event, listener) => {
      destroyedListeners.push(listener)
      return fake
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      for (const listener of destroyedListeners.splice(0)) listener()
    }
  }
  return fake
}

/** A fake `webContents` registered as one of Erfana's own windows. */
export function createAppSender(): FakeWebContents {
  const fake = createFakeWebContents()
  registerAppWebContents(fake)
  return fake
}

/**
 * Register `fake` in the `appWebContents` copy that is loaded NOW. For suites
 * that call `vi.resetModules()`: call it after the dynamic import of the code
 * under test, so both resolve to the same fresh module.
 */
export async function registerInCurrentModule(fake: FakeWebContents): Promise<void> {
  const { registerAppWebContents: register } = await import('../appWebContents')
  register(fake)
}

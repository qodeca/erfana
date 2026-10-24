// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One table-driven check for a preload bridge against its wire.
 *
 * A test file mocks `electron` with this module's {@link ipc}:
 *
 *     vi.mock('electron', async () => ({ ipcRenderer: (await import('./bridgeHarness')).ipc }))
 *
 * and describes each bridge with the channel every method must use. The
 * channel names in those tables are written out as strings on purpose: they
 * are the wire, and must not change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: unknown, payload: unknown) => void

/** The `ipcRenderer` stand-in: records calls and keeps the registered listeners. */
function createIpcMock() {
  const listeners = new Map<string, Listener[]>()
  return {
    listeners,
    invoke: vi.fn(async (..._args: unknown[]): Promise<unknown> => 'invoke-result'),
    send: vi.fn(),
    on: vi.fn((channel: string, listener: Listener) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((registered) => registered !== listener)
      )
      // The real `removeListener` returns `ipcRenderer`; a bridge must not pass it on
      return 'ipc-renderer'
    })
  }
}

/** The one `ipcRenderer` stand-in a test file's `electron` mock hands out. */
export const ipc = createIpcMock()

/** A method that sends one message: what it is called with, and what goes on the wire. */
export interface WireCall {
  method: string
  args: unknown[]
  channel: string
  /** Everything after the channel name */
  wire: unknown[]
}

/** What a bridge sends and listens to. */
export interface BridgeWire {
  /** `ipcRenderer.invoke` round-trips; the bridge hands back the invoke result */
  invokes?: WireCall[]
  /** Fire-and-forget `ipcRenderer.send` */
  sends?: WireCall[]
  /** Event subscriptions: the method and the channel it listens on */
  events?: Array<{ method: string; channel: string }>
}

type Method = (...args: unknown[]) => unknown

/** Describe one bridge: every method's wire, and nothing beyond the table. */
export function describeBridge(name: string, bridge: object, wire: BridgeWire): void {
  const invokes = wire.invokes ?? []
  const sends = wire.sends ?? []
  const events = wire.events ?? []
  const call = (method: string, args: unknown[]): unknown =>
    (bridge as Record<string, Method>)[method](...args)

  describe(name, () => {
    beforeEach(() => {
      ipc.listeners.clear()
      ipc.invoke.mockClear()
      ipc.send.mockClear()
      ipc.on.mockClear()
      ipc.removeListener.mockClear()
    })

    it('has one member per wire entry, and nothing else', () => {
      const expected = [...new Set([...invokes, ...sends, ...events].map((entry) => entry.method))]
      expect(Object.keys(bridge).sort()).toEqual(expected.sort())
    })

    if (invokes.length > 0) {
      it.each(invokes)('$method invokes $channel', async ({ method, args, channel, wire: sent }) => {
        const result = await call(method, args)
        expect(ipc.invoke).toHaveBeenCalledTimes(1)
        expect(ipc.invoke).toHaveBeenCalledWith(channel, ...sent)
        expect(result).toBe('invoke-result')
        expect(ipc.send).not.toHaveBeenCalled()
      })
    }

    if (sends.length > 0) {
      it.each(sends)('$method sends $channel and waits for nothing', ({ method, args, channel, wire: sent }) => {
        expect(call(method, args)).toBeUndefined()
        expect(ipc.send).toHaveBeenCalledTimes(1)
        expect(ipc.send).toHaveBeenCalledWith(channel, ...sent)
        expect(ipc.invoke).not.toHaveBeenCalled()
      })
    }

    if (events.length > 0) {
      it.each(events)(
        '$method listens on $channel, delivers the payload and unsubscribes',
        ({ method, channel }) => {
          const callback = vi.fn()
          const unsubscribe = call(method, [callback]) as () => unknown
          expect(ipc.on).toHaveBeenCalledTimes(1)
          const [registered, listener] = ipc.on.mock.calls[0] as unknown as [string, Listener]
          expect(registered).toBe(channel)

          const payload = { from: channel }
          listener({ sender: 'ipc-event' }, payload)
          // The payload only: the IPC event never reaches the page
          expect(callback).toHaveBeenCalledWith(payload)

          expect(unsubscribe()).toBeUndefined()
          expect(ipc.removeListener).toHaveBeenCalledWith(channel, listener)
        }
      )
    }
  })
}

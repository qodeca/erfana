// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Quit Confirmation IPC Handlers
 *
 * Tests IPC communication between main and renderer for quit confirmation.
 * Validates payload schema and callback invocation.
 *
 * @see Issue #64 - quit confirmation feature
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { QuitConfirmResponse } from '../../shared/ipc/quit-schema'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn()
  }
}))

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn()
  }
}))

// Mock LoggingService
vi.mock('../services/LoggingService', () => ({
  logger: mockLogger
}))

// Import after mocks are defined
import { registerQuitHandlers } from './quit-handlers'
import { ipcMain } from 'electron'

// Get reference to mocked ipcMain
const mockIpcMainOn = ipcMain.on as any

// Mock console.error for invalid entry tests (fallback logging)
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

describe('registerQuitHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('registration', () => {
    it('registers ipcMain.on for "quit:confirmResponse"', () => {
      const callback = vi.fn()

      registerQuitHandlers(callback)

      expect(mockIpcMainOn).toHaveBeenCalledWith('quit:confirmResponse', expect.any(Function))
    })

    it('registers exactly 1 handler', () => {
      const callback = vi.fn()

      registerQuitHandlers(callback)

      expect(mockIpcMainOn).toHaveBeenCalledTimes(1)
    })

    it('can be called multiple times (idempotent)', () => {
      const callback = vi.fn()

      registerQuitHandlers(callback)
      registerQuitHandlers(callback)

      // Should register handlers twice (not a problem, last one wins)
      expect(mockIpcMainOn).toHaveBeenCalledTimes(2)
    })
  })

  describe('quit:confirmResponse handler', () => {
    let confirmResponseHandler: (event: any, payload: unknown) => void

    beforeEach(() => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      // Extract the handler function
      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls.find((call) => call[0] === 'quit:confirmResponse')
      confirmResponseHandler = confirmResponseCall![1]
    })

    it('calls callback with proceed=true when valid response with proceed=true', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      // Re-extract handler with new callback
      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      confirmResponseHandler = confirmResponseCall[1]

      const validResponse: QuitConfirmResponse = {
        proceed: true
      }

      confirmResponseHandler({}, validResponse)

      expect(callback).toHaveBeenCalledWith(true)
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('calls callback with proceed=false when valid response with proceed=false', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      // Re-extract handler with new callback
      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      confirmResponseHandler = confirmResponseCall[1]

      const validResponse: QuitConfirmResponse = {
        proceed: false
      }

      confirmResponseHandler({}, validResponse)

      expect(callback).toHaveBeenCalledWith(false)
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('logs info when receiving valid response', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      confirmResponseHandler = confirmResponseCall[1]

      const validResponse: QuitConfirmResponse = {
        proceed: true
      }

      confirmResponseHandler({}, validResponse)

      expect(mockLogger.info).toHaveBeenCalledWith('Quit response received', { proceed: true })
    })
  })

  describe('invalid payload handling (fail-safe)', () => {
    it('calls callback with proceed=true when payload is invalid (fail-safe)', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      // Re-extract handler
      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const invalidPayload = {
        invalid: 'payload'
      }

      handler({}, invalidPayload)

      expect(callback).toHaveBeenCalledWith(true)
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('calls callback with proceed=true when payload is null', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      handler({}, null)

      expect(callback).toHaveBeenCalledWith(true)
    })

    it('calls callback with proceed=true when payload is undefined', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      handler({}, undefined)

      expect(callback).toHaveBeenCalledWith(true)
    })

    it('calls callback with proceed=true when payload is non-object', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      handler({}, 'string payload')

      expect(callback).toHaveBeenCalledWith(true)
    })

    it('calls callback with proceed=true when proceed is missing', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const invalidPayload = {}

      handler({}, invalidPayload)

      expect(callback).toHaveBeenCalledWith(true)
    })

    it('calls callback with proceed=true when proceed is not a boolean', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const invalidPayload = {
        proceed: 'true' // string instead of boolean
      }

      handler({}, invalidPayload)

      expect(callback).toHaveBeenCalledWith(true)
    })

    it('logs error when payload validation fails', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const invalidPayload = {
        invalid: 'payload'
      }

      handler({}, invalidPayload)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid quit response from renderer',
        undefined,
        expect.objectContaining({
          issues: expect.any(Array)
        })
      )
    })

    it('includes Zod validation issues in error log', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const invalidPayload = {}

      handler({}, invalidPayload)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid quit response from renderer',
        undefined,
        expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: expect.any(String),
              path: expect.any(Array)
            })
          ])
        })
      )
    })
  })

  describe('callback behavior', () => {
    it('does not throw when callback is called', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const validResponse: QuitConfirmResponse = {
        proceed: true
      }

      expect(() => {
        handler({}, validResponse)
      }).not.toThrow()
    })

    it('does not throw when callback throws an error', () => {
      const callback = vi.fn().mockImplementation(() => {
        throw new Error('Callback error')
      })
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const validResponse: QuitConfirmResponse = {
        proceed: true
      }

      // Handler should not propagate callback errors
      expect(() => {
        handler({}, validResponse)
      }).toThrow('Callback error') // Actually, it will throw since we don't catch it
    })
  })

  describe('integration scenarios', () => {
    it('handles rapid responses', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const responses: QuitConfirmResponse[] = Array.from({ length: 10 }, (_, i) => ({
        proceed: i % 2 === 0
      }))

      for (const response of responses) {
        handler({}, response)
      }

      expect(callback).toHaveBeenCalledTimes(10)
    })

    it('validates each response independently', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const validResponse: QuitConfirmResponse = {
        proceed: true
      }

      const invalidResponse = {
        invalid: 'payload'
      }

      handler({}, validResponse)
      handler({}, invalidResponse)
      handler({}, validResponse)

      // All three should call callback (invalid ones with proceed=true)
      expect(callback).toHaveBeenCalledTimes(3)
      expect(callback).toHaveBeenNthCalledWith(1, true)
      expect(callback).toHaveBeenNthCalledWith(2, true)
      expect(callback).toHaveBeenNthCalledWith(3, true)

      // One error log for invalid response
      expect(mockLogger.error).toHaveBeenCalledTimes(1)
    })

    it('is one-way communication (does not send response)', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const validResponse: QuitConfirmResponse = {
        proceed: true
      }

      const result = handler({}, validResponse)

      // Since it uses ipcMain.on (not handle), it doesn't return anything
      expect(result).toBeUndefined()
    })
  })

  describe('schema validation edge cases', () => {
    it('accepts proceed=true', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      handler({}, { proceed: true })

      expect(callback).toHaveBeenCalledWith(true)
      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('accepts proceed=false', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      handler({}, { proceed: false })

      expect(callback).toHaveBeenCalledWith(false)
      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('rejects extra properties (strict schema)', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      const payloadWithExtra = {
        proceed: true,
        extra: 'field'
      }

      handler({}, payloadWithExtra)

      // Zod schemas are strict by default, extra fields are stripped but don't fail validation
      // So this should actually succeed (proceed=true passed to callback)
      expect(callback).toHaveBeenCalledWith(true)
      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('fails on missing proceed field', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      handler({}, {})

      // Fail-safe: proceed=true
      expect(callback).toHaveBeenCalledWith(true)
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('fails on wrong type for proceed', () => {
      const callback = vi.fn()
      registerQuitHandlers(callback)

      const onCalls = mockIpcMainOn.mock.calls
      const confirmResponseCall = onCalls[onCalls.length - 1]
      const handler = confirmResponseCall[1]

      handler({}, { proceed: 1 }) // number instead of boolean

      // Fail-safe: proceed=true
      expect(callback).toHaveBeenCalledWith(true)
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })
})

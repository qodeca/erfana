// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Gateway error normalisation: a request the main process refused on path
 * grounds rejects with a `FileGatewayError` that carries the refusal code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFINEMENT_MESSAGES, type ConfinementErrorCode } from '../../../shared/ipc/confinement'
import { FileGatewayError, fileGateway, isProjectChanged, normaliseFileError } from './fileGateway'

const original = window.api

/** What Electron makes of a handler that threw: the message gains a prefix. */
const ipcError = (message: string): Error =>
  new Error(`Error invoking remote method 'file:writeFile': ConfinementError: ${message}`)

const withBridge = (bridge: Record<string, unknown>): void => {
  window.api = { file: bridge } as unknown as typeof window.api
}

afterEach(() => {
  window.api = original
})

describe('fileGateway error normalisation', () => {
  it.each(Object.keys(CONFINEMENT_MESSAGES) as ConfinementErrorCode[])(
    'maps a %s refusal to a typed error with that code',
    async (code) => {
      withBridge({ readFile: vi.fn().mockRejectedValue(ipcError(CONFINEMENT_MESSAGES[code])) })

      const error = await fileGateway.readFile({ filePath: 'f' }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(FileGatewayError)
      expect((error as FileGatewayError).code).toBe(code)
    }
  )

  it('keeps the message as the main process wrote it', async () => {
    const raw = ipcError(CONFINEMENT_MESSAGES.PROJECT_CHANGED)
    withBridge({ writeFile: vi.fn().mockRejectedValue(raw) })

    const error = (await fileGateway
      .writeFile({ filePath: 'f', content: 'c', generation: 1 })
      .catch((e: unknown) => e)) as FileGatewayError

    expect(error.message).toBe(raw.message)
    expect(error.cause).toBe(raw)
    expect(isProjectChanged(error)).toBe(true)
  })

  it('passes a failure that is not a refusal through as the same error', async () => {
    const raw = new Error("ENOENT: no such file or directory, open 'x'")
    withBridge({ readFile: vi.fn().mockRejectedValue(raw) })

    const error = await fileGateway.readFile({ filePath: 'f' }).catch((e: unknown) => e)

    expect(error).toBe(raw)
    expect(error).not.toBeInstanceOf(FileGatewayError)
    expect(isProjectChanged(error)).toBe(false)
  })

  it('normalises an error the bridge throws before it returns a promise', async () => {
    withBridge({
      exists: () => {
        throw ipcError(CONFINEMENT_MESSAGES.NO_PROJECT)
      }
    })

    const error = (await fileGateway.exists({ filePath: 'f' }).catch((e: unknown) => e)) as FileGatewayError

    expect(error.code).toBe('NO_PROJECT')
  })

  it('lets a value that is not an Error pass through untouched', async () => {
    withBridge({ readFile: vi.fn().mockRejectedValue('plain string') })
    await expect(fileGateway.readFile({ filePath: 'f' })).rejects.toBe('plain string')
  })

  it('does not wrap an error twice', () => {
    const typed = new FileGatewayError('x', 'NOT_FOUND')
    expect(normaliseFileError(typed)).toBe(typed)
  })

  it('returns the bridge result on success, unchanged', async () => {
    withBridge({ writeFile: vi.fn().mockResolvedValue(true) })
    await expect(fileGateway.writeFile({ filePath: 'f', content: 'c' })).resolves.toBe(true)
  })

  it('passes the request object to the bridge as it is, generation included', async () => {
    const writeFile = vi.fn().mockResolvedValue(true)
    withBridge({ writeFile })
    const request = { filePath: 'f', content: 'c', generation: 6 }

    await fileGateway.writeFile(request)

    expect(writeFile).toHaveBeenCalledWith(request)
    expect(writeFile.mock.calls[0][0]).toBe(request)
  })

  it('does not wrap the project-changed subscription', () => {
    const unsubscribe = vi.fn()
    const onProjectChanged = vi.fn(() => unsubscribe)
    withBridge({ onProjectChanged })
    const callback = vi.fn()

    expect(fileGateway.onProjectChanged(callback)).toBe(unsubscribe)
    expect(onProjectChanged).toHaveBeenCalledWith(callback)
  })

  it('isProjectChanged is false for other errors and other values', () => {
    expect(isProjectChanged(new FileGatewayError('x', 'NOT_FOUND'))).toBe(false)
    expect(isProjectChanged(new Error(CONFINEMENT_MESSAGES.PROJECT_CHANGED))).toBe(false)
    expect(isProjectChanged(undefined)).toBe(false)
  })
})

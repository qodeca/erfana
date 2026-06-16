// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared mock setup and helpers for import-handlers.test.ts
 *
 * Exports mock variable references, setup helpers, and factory functions.
 * Note: vi.mock() calls must remain in the test file itself per Vitest requirements.
 *
 * @see import-handlers.test.ts
 */

import { vi } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import type { IpcMainInvokeEvent } from 'electron'

// Platform-safe absolute paths for tests. On Windows, hardcoded Unix paths
// like `/project` fail path.isAbsolute() and trigger PATH_TRAVERSAL errors
// before the test logic runs. Use OS tmpdir-based paths instead. See #157.
export const TEST_PROJECT_PATH = path.join(os.tmpdir(), 'erfana-test', 'project')
export const TEST_IMPORT_DIR = path.join(TEST_PROJECT_PATH, 'import')
export const TEST_DOC_PATH = path.join(os.tmpdir(), 'erfana-test', 'path', 'to', 'doc.pdf')
export const TEST_DOC_OTHER_PATH = path.join(os.tmpdir(), 'erfana-test', 'path', 'to', 'other.pdf')
export const TEST_DOC_XYZ_PATH = path.join(os.tmpdir(), 'erfana-test', 'path', 'to', 'doc.xyz')

// =============================================================================
// Mock variable declarations
// =============================================================================

export const mockGetConverter = vi.fn()
export const mockGetExtensionsByConversionType = vi.fn()
export const mockGetSupportedExtensions = vi.fn()

export const mockGetProjectPath = vi.fn()

export const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}

export const mockWriteFile = vi.fn()
export const mockMkdir = vi.fn()
export const mockRm = vi.fn()
export const mockCp = vi.fn()

export const mockChangeExtension = vi.fn((name: string) => name.replace(/\.[^.]+$/, '.md'))
export const mockSanitizeFileName = vi.fn((name: string) => name)
export const mockFindAvailableFileName = vi.fn((_dir: string, name: string) =>
  path.join(TEST_IMPORT_DIR, name)
)

export const mockIsConfigurableConverter = vi.fn()

// =============================================================================
// Helper functions
// =============================================================================

/** Retrieve a registered IPC handler by channel name */
export function getHandler(
  mockIpcMainHandle: ReturnType<typeof vi.fn>,
  channel: string
): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = mockIpcMainHandle.mock.calls.find((c) => c[0] === channel)
  return call?.[1] as ((...args: unknown[]) => Promise<unknown>) | undefined
}

/** Create a mock IpcMainInvokeEvent with a live webContents sender */
export function createMockEvent(overrides?: { isDestroyed?: () => boolean }): IpcMainInvokeEvent {
  return {
    sender: {
      isDestroyed: overrides?.isDestroyed ?? vi.fn().mockReturnValue(false),
      send: vi.fn()
    }
  } as unknown as IpcMainInvokeEvent
}

/** Create a minimal valid import request */
export function createValidRequest(filePath = TEST_DOC_PATH): { filePath: string } {
  return { filePath }
}

/** Reset all shared mocks to their default implementations */
export function resetMocks(): void {
  vi.clearAllMocks()

  mockGetProjectPath.mockReturnValue(TEST_PROJECT_PATH)
  mockWriteFile.mockResolvedValue(undefined)
  mockMkdir.mockResolvedValue(undefined)
  mockRm.mockResolvedValue(undefined)
  mockCp.mockResolvedValue(undefined)

  mockGetExtensionsByConversionType.mockReturnValue({
    requiresConversion: ['pdf', 'docx'],
    passthrough: ['txt', 'md']
  })

  mockIsConfigurableConverter.mockReturnValue(false)

  mockChangeExtension.mockImplementation((name: string) => name.replace(/\.[^.]+$/, '.md'))
  mockSanitizeFileName.mockImplementation((name: string) => name)
  mockFindAvailableFileName.mockImplementation((_dir: string, name: string) =>
    path.join(TEST_IMPORT_DIR, name)
  )
}

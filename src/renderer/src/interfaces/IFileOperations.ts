// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for file operations required by clipboard store
 * Enables dependency injection and testing
 */
import type { FileBridge } from '../../../shared/ipc/file-schema'

/**
 * `moveItem` moves a file or folder to a new parent directory (`replaceExisting`:
 * delete the existing item at the target first); `copyItem` copies it.
 */
export type IFileOperations = Pick<FileBridge, 'moveItem' | 'copyItem'>

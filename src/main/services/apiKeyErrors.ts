// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/** Shown in Settings when the OS cannot protect the key. Plain words on purpose. */
export const ENCRYPTION_UNAVAILABLE_MESSAGE =
  'Your system cannot protect the key, so it was not saved. On Linux, unlock or install a keyring (GNOME Keyring or KWallet) and try again.'

/** Thrown by storeKey when the key cannot be encrypted; the message is safe to show. */
export class ApiKeyEncryptionUnavailableError extends Error {
  constructor() {
    super(ENCRYPTION_UNAVAILABLE_MESSAGE)
    this.name = 'ApiKeyEncryptionUnavailableError'
  }
}

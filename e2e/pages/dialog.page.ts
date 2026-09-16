// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Dialog Page Object Model.
 *
 * Covers the surfaces every modal shares (`BaseDialog`) plus the two shapes
 * the file-management journeys drive: the confirm dialog and the
 * name-entry dialog behind New File / New Folder / Rename.
 *
 * Locator strategy, and why it differs per shape:
 *
 * - `ConfirmDialog` carries real testids (`DIALOG_CONFIRM`, `DIALOG_BTN_*`),
 *   so those are used directly.
 * - `FileSystemDialog` (new file / new folder / rename) carries none. Rather
 *   than reach for its CSS classes — which are styling, not a contract — this
 *   POM scopes to the shared `DIALOG_CONTAINER` and addresses the controls the
 *   way a user perceives them: the single textbox, and the button whose
 *   visible label is `Create` / `Rename` / `Cancel`.
 *
 * Every dialog renders into `#portal-root`, so locators must be page-scoped,
 * never scoped to the panel that opened them.
 *
 * @see src/renderer/src/components/Dialog/BaseDialog.tsx
 * @see src/renderer/src/components/Dialog/FileSystemDialog.tsx
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'

/** The primary-button label `FileSystemDialog` renders per operation. */
export type FileSystemDialogAction = 'Create' | 'Rename'

export class DialogPage {
  constructor(private readonly page: Page) {}

  // ---------------------------------------------------------------------------
  // Shared BaseDialog surfaces
  // ---------------------------------------------------------------------------

  /** The dialog card. Every dialog shape renders one. */
  container(): Locator {
    return byTestId(this.page, TEST_IDS.DIALOG_CONTAINER)
  }

  /** The dimming backdrop behind the dialog card. */
  overlay(): Locator {
    return byTestId(this.page, TEST_IDS.DIALOG_OVERLAY)
  }

  /** Wait until no dialog is on screen. */
  async waitForClosed(): Promise<void> {
    await expect(this.container()).toHaveCount(0, { timeout: 10_000 })
  }

  /** Dismiss the top dialog with Escape and wait for it to go. */
  async dismissWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await this.waitForClosed()
  }

  // ---------------------------------------------------------------------------
  // ConfirmDialog
  // ---------------------------------------------------------------------------

  confirmDialog(): Locator {
    return byTestId(this.page, TEST_IDS.DIALOG_CONFIRM)
  }

  confirmTitle(): Locator {
    return byTestId(this.page, TEST_IDS.DIALOG_TITLE)
  }

  confirmMessage(): Locator {
    return byTestId(this.page, TEST_IDS.DIALOG_CONFIRM_MESSAGE)
  }

  confirmButton(): Locator {
    return byTestId(this.page, TEST_IDS.DIALOG_BTN_CONFIRM)
  }

  cancelButton(): Locator {
    return byTestId(this.page, TEST_IDS.DIALOG_BTN_CANCEL)
  }

  /** Wait for a confirm dialog carrying the given title. */
  async waitForConfirm(title: string): Promise<void> {
    await expect(this.confirmDialog()).toBeVisible({ timeout: 10_000 })
    await expect(this.confirmTitle()).toHaveText(title)
  }

  /** Accept a confirm dialog and wait for it to close. */
  async accept(): Promise<void> {
    await this.confirmButton().click()
    await this.waitForClosed()
  }

  /** Decline a confirm dialog and wait for it to close. */
  async decline(): Promise<void> {
    await this.cancelButton().click()
    await this.waitForClosed()
  }

  // ---------------------------------------------------------------------------
  // FileSystemDialog (New File / New Folder / Rename)
  // ---------------------------------------------------------------------------

  /** The single name field. Scoped to the dialog card so the app behind it cannot match. */
  nameInput(): Locator {
    return this.container().getByRole('textbox')
  }

  /** The inline validation message, shown only when the typed name is rejected. */
  validationError(): Locator {
    return this.container().locator('.dialog-rename-validation-error')
  }

  /** The primary action button, addressed by its visible label. */
  primaryButton(action: FileSystemDialogAction): Locator {
    return this.container().getByRole('button', { name: action, exact: true })
  }

  /** The secondary Cancel button of a name-entry dialog. */
  namedCancelButton(): Locator {
    return this.container().getByRole('button', { name: 'Cancel', exact: true })
  }

  /**
   * Wait for a name-entry dialog with the given heading, then return once its
   * input has focus — `FileSystemDialog` autofocuses, and typing before that
   * lands silently drops characters.
   */
  async waitForNameEntry(title: string): Promise<void> {
    await expect(this.container()).toBeVisible({ timeout: 10_000 })
    await expect(this.container().getByRole('heading', { name: title })).toBeVisible()
    await expect(this.nameInput()).toBeFocused()
  }

  /**
   * Fill the name field and submit. `fill()` replaces any prefilled value,
   * which is what Rename needs (it seeds the current name).
   */
  async submitName(name: string, action: FileSystemDialogAction): Promise<void> {
    await this.nameInput().fill(name)
    const primary = this.primaryButton(action)
    await expect(primary).toBeEnabled()
    await primary.click()
    await this.waitForClosed()
  }
}

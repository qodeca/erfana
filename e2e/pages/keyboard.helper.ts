// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Platform-aware keyboard shortcut helper.
 *
 * Caches the platform modifier (Meta on macOS, Control on others)
 * to avoid redundant page.evaluate() calls per shortcut.
 *
 * @see e2e/utils/helpers.ts - Backward-compatible adapter
 */

import { Page } from '@playwright/test'

export class KeyboardHelper {
  private modifier: string | null = null

  constructor(private readonly page: Page) {}

  async getModifier(): Promise<string> {
    if (!this.modifier) {
      const platform = await this.page.evaluate(() => navigator.platform.toLowerCase())
      this.modifier = platform.includes('mac') ? 'Meta' : 'Control'
    }
    return this.modifier
  }

  async shortcut(key: string): Promise<void> {
    const modifier = await this.getModifier()
    await this.page.keyboard.press(`${modifier}+${key}`)
  }

  async selectAll(): Promise<void> {
    await this.shortcut('A')
  }

  async copy(): Promise<void> {
    await this.shortcut('C')
  }

  async paste(): Promise<void> {
    await this.shortcut('V')
  }

  async cut(): Promise<void> {
    await this.shortcut('X')
  }

  async undo(): Promise<void> {
    await this.shortcut('Z')
  }

  async redo(): Promise<void> {
    const modifier = await this.getModifier()
    if (modifier === 'Meta') {
      await this.page.keyboard.press('Meta+Shift+Z')
    } else {
      await this.page.keyboard.press('Control+Y')
    }
  }

  async save(): Promise<void> {
    await this.shortcut('S')
  }

  async find(): Promise<void> {
    await this.shortcut('F')
  }

  async newWindow(): Promise<void> {
    const modifier = await this.getModifier()
    await this.page.keyboard.press(`${modifier}+Shift+N`)
  }
}

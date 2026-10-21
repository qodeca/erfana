// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { create } from 'zustand'

/** A Settings section that can be opened directly (#250). */
export type SettingsSection = 'import-tools'

export interface OpenSettingsOptions {
  /** Scroll to this section and move focus to its heading. */
  section?: SettingsSection
}

interface SettingsState {
  isOpen: boolean
  /** The section the last `openSettings` asked for; null opens at the top. */
  focusSection: SettingsSection | null
  openSettings: (options?: OpenSettingsOptions) => void
  closeSettings: () => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  focusSection: null,
  openSettings: (options) => set({ isOpen: true, focusSection: options?.section ?? null }),
  closeSettings: () => set({ isOpen: false, focusSection: null })
}))

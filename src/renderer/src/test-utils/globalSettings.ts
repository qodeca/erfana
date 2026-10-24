// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import {
  getDefaultGlobalSettings,
  type GlobalSettings
} from '../../../shared/ipc/global-settings-schema'

/**
 * A complete `GlobalSettings` for a test: the schema defaults, with the
 * sections the test is about replaced.
 *
 * The store only ever holds settings the main process parsed through
 * `GlobalSettingsSchema`, which fills every section. A fixture that lists only
 * the sections one test cares about is a shape production never produces.
 */
export function globalSettings(sections: Partial<GlobalSettings> = {}): GlobalSettings {
  return { ...getDefaultGlobalSettings(), ...sections }
}

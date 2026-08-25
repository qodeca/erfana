// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Well-known dockview panel identifiers.
 *
 * These ids are matched against by code that has no business importing a React
 * component – the project store's panel sweep, the tab-operations helpers – so
 * they live in `constants/` rather than beside the component that registers
 * them. Anything else about a panel id is derived, not hard-coded: see
 * `utils/openFileInPanel.ts`.
 *
 * @module constants/panels
 */

/**
 * Id of the non-closable welcome/home panel in the editor dockview.
 *
 * Every "close all editor tabs" sweep must skip it, so the literal was copied
 * into three files before this constant existed (QG-6 finding L1). The leading
 * underscore keeps it out of the `editor-…` / `image-…` namespace that real
 * file panels use.
 */
export const WELCOME_PANEL_ID = '_center-placeholder'

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview Panel module (Issue #74).
 *
 * Public surface: the dockview panel component and its param type. Internals
 * (hooks, sub-components, pure logic) stay unexported so the folder can be
 * reshaped without a repo-wide import sweep.
 *
 * @module HtmlPreviewPanel
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

export { HtmlPreviewPanel } from './HtmlPreviewPanel'
export type { HtmlPreviewPanelParams } from './HtmlPreviewPanel'

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Component-scoped hooks for the HTML preview panel.
 *
 * @module HtmlPreviewPanel/hooks
 */

export { usePreviewBounds } from './usePreviewBounds'
export type { UsePreviewBoundsOptions, UsePreviewBoundsResult } from './usePreviewBounds'

export { usePreviewLifecycle } from './usePreviewLifecycle'
export type {
  UsePreviewLifecycleOptions,
  UsePreviewLifecycleResult
} from './usePreviewLifecycle'

export { usePreviewEvents } from './usePreviewEvents'
export { usePreviewFindShortcuts } from './usePreviewFindShortcuts'

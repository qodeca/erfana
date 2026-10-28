// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Presentational sub-components of the HTML preview panel.
 *
 * @module HtmlPreviewPanel/components
 */

export { PreviewFallback } from './PreviewFallback'
export type { PreviewFallbackProps } from './PreviewFallback'

export { PreviewFailureBadge } from './PreviewFailureBadge'
export type { PreviewFailureBadgeProps } from './PreviewFailureBadge'

export { PreviewBanner } from './PreviewBanner'
export type { PreviewBannerProps, PreviewBannerReturnAction } from './PreviewBanner'

export { PreviewNavControls, backTooltip, linkModeTooltip } from './PreviewNavControls'
export type { PreviewNavControlsProps } from './PreviewNavControls'

export { PreviewFindTool, PreviewToolbarTools } from './PreviewToolbarTools'
export type { PreviewFindToolProps, PreviewToolbarToolsProps } from './PreviewToolbarTools'

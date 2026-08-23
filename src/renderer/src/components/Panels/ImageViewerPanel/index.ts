// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Image Viewer Panel module.
 *
 * Public surface of the image viewer: the dockview panel component, its param
 * type, and the pure zoom/pan logic other modules reuse. Internals (hooks,
 * sub-components, status copy) stay unexported so the folder can be reshaped
 * without a repo-wide import sweep.
 *
 * @module ImageViewerPanel
 * @see Spec #015 - Image preview viewer specification
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

export { ImageViewerPanel } from './ImageViewerPanel'
export type { ImageViewerPanelParams } from './ImageViewerPanel'

export type { Transform, KeyEventInfo, ImageViewerKeyAction } from './imageViewer.logic'

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Component-scoped hooks for the image viewer.
 *
 * @module ImageViewerPanel/hooks
 */

export { useImageSource } from './useImageSource'
export type {
  ImageSource,
  UseImageSourceOptions,
  UseImageSourceResult
} from './useImageSource'

export { useImageViewerTransform } from './useImageViewerTransform'
export type {
  ImageDimensions,
  UseImageViewerTransformOptions,
  UseImageViewerTransformResult
} from './useImageViewerTransform'

export { useFullScreenOverlay } from './useFullScreenOverlay'
export type { UseFullScreenOverlayResult } from './useFullScreenOverlay'

export { useReloadAction } from './useReloadAction'
export type { UseReloadActionOptions, UseReloadActionResult } from './useReloadAction'

export { useImageExportHandlers } from './useImageExportHandlers'
export type {
  UseImageExportHandlersOptions,
  UseImageExportHandlersResult
} from './useImageExportHandlers'

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What a `MarkdownImageStore` is built from, and the production defaults (#71;
 * moved out of `markdownImageStore.ts` with #478 plan S18, which added the live
 * follow, so the store stays inside its line ratchet). Each default degrades
 * to "nothing" when its bridge is missing, as in a test renderer.
 *
 * @module components/Editor/markdownImageStoreDeps
 */
import type { MarkdownImageReadRequest, MarkdownImageReadResponse } from '../../../../shared/ipc/markdown-image-schema'
import { onFileStructureChanged } from '../../services/fileStructureSignal'
import { fileGateway } from '../../services/fileGateway'
import { directoryWatchGateway } from '../../services/directoryWatchGateway'
import { hasBridge, hasBridgeMethod } from '../../services/bridgePresence'
import { markdownImageGateway } from '../../services/markdownImageGateway'
import { getRendererPlatform } from '../../utils/platform'
import { ImageByteBudget, sharedImageByteBudget } from './markdownImageBudget'
import {
  MarkdownImageFreshness,
  type MarkdownImageFollower,
  type MarkdownImageFreshnessHost
} from './markdownImageFreshness'

/** Collaborators, injectable for tests. */
export interface MarkdownImageStoreDeps {
  read: (request: MarkdownImageReadRequest) => Promise<MarkdownImageReadResponse>
  getProjectPath: () => Promise<string | null>
  /** Resolves once `url` decodes as an image; rejects when it does not */
  decode: (url: string) => Promise<void>
  onDirectoryChanged: (callback: () => void) => () => void
  onFileStructureChanged: (callback: () => void) => () => void
  platform: () => NodeJS.Platform
  budget: ImageByteBudget
  /** Follows the shown images live (#478 S18); nothing without a file-watch bridge */
  follow: (host: MarkdownImageFreshnessHost) => MarkdownImageFollower
}

const NO_FOLLOW: MarkdownImageFollower = { sync: () => {}, checkAll: () => {}, dispose: () => {} }

/** Decode off the DOM where the engine can; jsdom cannot, and is trusted. */
async function decodeImage(url: string): Promise<void> {
  const image = new Image()
  image.src = url
  if (typeof image.decode === 'function') await image.decode()
}

export const defaultMarkdownImageStoreDeps: MarkdownImageStoreDeps = {
  // A test renderer often installs no bridge (or a mock that answers nothing); then nothing loads.
  read: (request) =>
    (hasBridge('markdownImage') ? markdownImageGateway.read(request) : undefined) ??
    Promise.resolve({ status: 'refused', reason: 'unreadable' }),
  getProjectPath: () => fileGateway.getProjectPath(),
  decode: decodeImage,
  // Likewise: without a directory-watch bridge (or an unsubscribe from its mock), nothing is heard.
  onDirectoryChanged: (callback) =>
    (hasBridgeMethod('directoryWatch', 'onDirectoryChanged')
      ? directoryWatchGateway.onDirectoryChanged(() => callback())
      : undefined) ?? (() => {}),
  onFileStructureChanged,
  platform: getRendererPlatform,
  budget: sharedImageByteBudget,
  follow: (host) => (hasBridgeMethod('fileWatch', 'subscribe') ? new MarkdownImageFreshness(host) : NO_FOLLOW)
}

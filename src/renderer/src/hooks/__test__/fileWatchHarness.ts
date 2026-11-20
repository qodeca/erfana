// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared harness for the {@link useFileChangeSubscription} (image adapter)
 * suites (#478, plan S15).
 *
 * The watch layer and the disk are the core's fakes, installed as the
 * window's freshness environment (`installFakeFreshness`); the image read is
 * a fake `window.api.file.readImage` that answers from the same fake disk the
 * way main does: `unchanged` when the caller's version is current, a
 * "too large (… MB)" rejection for a blocked file, ENOENT for a missing one.
 * A version token is the fake disk's content hash.
 *
 * @module hooks/__test__/fileWatchHarness
 */

import { renderHook, type RenderHookResult } from '@testing-library/react'
import { beforeEach, vi, type Mock } from 'vitest'

import type { ImageReadRequest, ImageReadResponse } from '../../../../shared/ipc/file-image-schema'
import { installFakeFreshness, type FakeFreshness } from '../../services/freshness/__test__/fakeFreshnessEnvironment'
import {
  useFileChangeSubscription,
  type ImageBytes,
  type UseFileChangeSubscriptionOptions,
  type UseFileChangeSubscriptionResult
} from '../useFileChangeSubscription'

/** The path every suite watches unless it says otherwise. */
export const WATCHED_PATH = '/proj/icon.png'

/** The size the fake main reports for a too-large image (MB). */
export const TOO_LARGE_MB = 60

export interface ImageWatchHarness extends FakeFreshness {
  /** The fake `file:readImage`. */
  readImage: Mock<(request: ImageReadRequest) => Promise<ImageReadResponse>>
}

/** Installs the fake environment plus the fake image read; call once at module scope. */
export function installImageWatchHarness(): ImageWatchHarness {
  const env = installFakeFreshness()
  const readImage = vi.fn<(request: ImageReadRequest) => Promise<ImageReadResponse>>()
  const harness = env as ImageWatchHarness
  harness.readImage = readImage

  beforeEach(() => {
    readImage.mockReset().mockImplementation(async ({ filePath, knownVersion }) => {
      const reply = await env.disk.readText(filePath)
      if (reply.status === 'missing') throw new Error(`ENOENT: no such file or directory, open '${filePath}'`)
      if (reply.status === 'too-large') throw new Error(`Image is too large (${TOO_LARGE_MB}.0 MB)`)
      if (reply.status !== 'ok') throw new Error('EBUSY: resource busy or locked')
      const stamp = env.disk.stamp(filePath)
      if (!stamp?.hash) throw new Error('setup: fake disk gave no hash')
      if (knownVersion === stamp.hash) return { status: 'unchanged', version: stamp.hash, stamp }
      return { status: 'ok', dataUrl: `data:image/png;base64,${btoa(reply.text)}`, version: stamp.hash, stamp }
    })
    // NOTE: extend `window`, never `vi.stubGlobal('window', …)` – replacing the
    // window object destroys React's DOM internals.
    ;(window as unknown as { api: unknown }).api = { file: { readImage } }
  })

  return harness
}

export interface ImageTab {
  hook: RenderHookResult<UseFileChangeSubscriptionResult, UseFileChangeSubscriptionOptions>
  /** Bytes the viewer was handed, in order. */
  onBytes: Mock<(bytes: ImageBytes) => void>
  /** The version token on screen. */
  shown(): string | undefined
  /** Show or hide the tab. */
  setVisible(visible: boolean): void
}

/** Open the image tab the way the viewer does: first image on screen, then follow from its stamp. */
export async function openImageTab(
  env: FakeFreshness,
  filePath = WATCHED_PATH,
  overrides: Partial<UseFileChangeSubscriptionOptions> = {}
): Promise<ImageTab> {
  const baseline = env.disk.stamp(filePath)
  let version = baseline?.hash
  let visible = overrides.visible ?? true
  const onBytes = vi.fn((bytes: ImageBytes) => {
    version = bytes.version
    hook.rerender(props())
  })
  const props = (): UseFileChangeSubscriptionOptions => ({
    ready: true,
    baseline,
    currentVersion: version,
    onBytes,
    ...overrides,
    visible
  })
  const hook = renderHook((p: UseFileChangeSubscriptionOptions) => useFileChangeSubscription(filePath, p), {
    initialProps: props()
  })
  await env.flush()
  return {
    hook,
    onBytes,
    shown: () => version,
    setVisible: (next) => {
      visible = next
      hook.rerender(props())
    }
  }
}

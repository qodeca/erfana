// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared fakes for the `PreviewSessionFactory*.test.ts` files (Issue #74, work
 * item 38). The suite is split by topic (issue #124; docs/windows/contributing.md
 * § "Test-file split policy"), and every part builds the factory from these.
 *
 * Every electron and collaborator surface is a typed fake, so no test needs a
 * real `Session` or `WebContentsView`. There is no `vi.mock()` here: these are
 * plain values and builders.
 */
import { vi } from 'vitest'
import type { PreviewFailureInput } from '../../../../shared/ipc/preview-types'

import type { PreviewAllowlistState, IPreviewAllowlistStore } from '../PreviewAllowlistStore'
import type { PreviewFrameRefusalType } from '../previewFrameRefusals'
import type { IPreviewRootRegistry, PreviewRootEntry } from '../PreviewRootRegistry'
import type {
  PreviewSessionLike,
  PreviewSessionPageScopes,
  PreviewViewHandle,
  PreviewWebContentsHandle
} from '../PreviewSessionFactory'

/** The token every fake registry issues. */
export const TOKEN = 'abc123abc123abc123abc123abc123ab'
/** The root entry every fake registry resolves. */
export const ENTRY: PreviewRootEntry = {
  realRoot: '/real/proj',
  projectPath: '/proj',
  csp: "default-src 'none'; sandbox allow-scripts"
}

/** A root registry that issues {@link TOKEN} and resolves it to {@link ENTRY}. */
export function makeRegistry(): IPreviewRootRegistry & {
  revoke: ReturnType<typeof vi.fn<(token: string) => void>>
} {
  return {
    issue: vi.fn<(projectPath: string, hosts: readonly string[]) => Promise<string>>(() =>
      Promise.resolve(TOKEN)
    ),
    resolve: vi.fn<(token: string) => PreviewRootEntry | undefined>(() => ENTRY),
    revoke: vi.fn<(token: string) => void>(),
    rebuildCsp: vi.fn<(token: string, hosts: readonly string[]) => void>(),
    clear: vi.fn<() => void>()
  }
}

/** An allowlist store holding `origins`, with no badges to drain. */
export function makeStore(origins: string[]): IPreviewAllowlistStore {
  return {
    load: vi.fn<() => Promise<PreviewAllowlistState>>(() =>
      Promise.resolve({ origins, writeBackEnabled: true })
    ),
    approveOrigin: vi.fn<(origin: string) => Promise<readonly string[]>>(() =>
      Promise.resolve(origins)
    ),
    getOrigins: vi.fn<() => ReadonlySet<string>>(() => new Set(origins)),
    isWriteBackEnabled: vi.fn<() => boolean>(() => true),
    drainBadges: vi.fn<() => PreviewFailureInput[]>(() => [])
  }
}

/** A view with a live `webContents` whose `destroy` is a spy. */
export function makeView(): PreviewViewHandle {
  const wc = {
    id: 'wc',
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn()
  } as unknown as PreviewWebContentsHandle
  return {
    webContents: wc,
    setBounds: vi.fn(),
    setBackgroundColor: vi.fn(),
    setVisible: vi.fn()
  } as unknown as PreviewViewHandle
}

/** An in-memory session: no storage path, not persistent. */
export const SESSION = { storagePath: null, isPersistent: () => false } as unknown as PreviewSessionLike

/**
 * Page scopes whose every page, and the view itself, record into
 * `recordFailure` (issue #124, WI-29), and whose page lists refused frames into
 * `recordFrameRefusal` (WI-12).
 */
export function scopesRecordingTo(
  recordFailure: (input: PreviewFailureInput) => void,
  recordFrameRefusal: (type: PreviewFrameRefusalType, address: string) => void = () => undefined
): () => PreviewSessionPageScopes {
  const page = { recordFailure, frameRefusals: { record: recordFrameRefusal } }
  return () => ({
    committed: () => page,
    forMainDocument: () => page,
    recordViewFailure: recordFailure
  })
}

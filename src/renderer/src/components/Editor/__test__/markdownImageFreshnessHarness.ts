// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The Markdown preview's image follow (`markdownImageFreshness.ts`) over the
 * freshness core's fakes (#478 plan S18): the fake disk answers
 * `markdown-image:read` (the bytes are the text, the stamp the disk's), the
 * fake source stands in for main's watch layer, and the "store" records what
 * it was handed. Call {@link installImageFollowHarness} at module scope; its
 * fields are rebuilt for every test.
 */
import { afterEach, beforeEach, vi } from 'vitest'
import type { Checkable } from '../../../../../shared/freshness/freshnessRegistry'
import { createFakeClock, type FakeClock } from '../../../../../shared/freshness/__test__/fakeClock'
import { FakeDisk, fakeHash } from '../../../../../shared/freshness/__test__/fakeDisk'
import { FakeSource } from '../../../../../shared/freshness/__test__/fakeSource'
import type { MarkdownImageReadResponse } from '../../../../../shared/ipc/markdown-image-schema'
import {
  MarkdownImageFreshness,
  type FollowedImage,
  type MarkdownImageBytes
} from '../markdownImageFreshness'

export interface ImageFollowHarness {
  readonly clock: FakeClock
  readonly disk: FakeDisk
  readonly source: FakeSource
  readonly follow: MarkdownImageFreshness
  /** Bytes handed to the store, per key, in order. */
  readonly refreshed: Map<string, MarkdownImageBytes[]>
  readonly rechecked: string[]
  readonly reads: ReturnType<typeof vi.fn<(filePath: string) => Promise<MarkdownImageReadResponse>>>
  /** Window focus or a power resume: every registered tracker checks. */
  check(): void
  readonly registered: number
  /** The image as the store shows it after a read of `path`, for {@link FollowedImage}. */
  image(key: string, path: string): FollowedImage
}

/** `markdown-image:read` over the fake disk. */
async function readFromDisk(disk: FakeDisk, filePath: string): Promise<MarkdownImageReadResponse> {
  const reply = await disk.readText(filePath)
  switch (reply.status) {
    case 'ok':
      return { status: 'ok', dataUrl: reply.text, version: fakeHash(reply.text), stamp: reply.stamp }
    case 'missing':
      return { status: 'refused', reason: 'not-found' }
    case 'too-large':
      return { status: 'refused', reason: 'too-large' }
    default:
      return { status: 'refused', reason: 'unreadable' }
  }
}

export function installImageFollowHarness(): ImageFollowHarness {
  const h = {} as ImageFollowHarness & { members: Set<Checkable> }

  beforeEach(() => {
    const clock = createFakeClock()
    const disk = new FakeDisk(clock)
    const source = new FakeSource(disk)
    const refreshed = new Map<string, MarkdownImageBytes[]>()
    const rechecked: string[] = []
    const members = new Set<Checkable>()
    const reads = vi.fn((filePath: string) => readFromDisk(disk, filePath))
    let nextId = 0
    const follow = new MarkdownImageFreshness(
      {
        read: reads,
        refreshFile: (key, bytes) => refreshed.set(key, [...(refreshed.get(key) ?? []), bytes]),
        recheckFile: (key) => rechecked.push(key)
      },
      {
        source,
        clock,
        newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
        register: (member) => {
          members.add(member)
          return () => members.delete(member)
        }
      }
    )
    Object.assign(h, {
      clock,
      disk,
      source,
      follow,
      refreshed,
      rechecked,
      reads,
      members,
      check: () => {
        for (const member of [...members]) member.check('focus')
      },
      image: (key: string, path: string): FollowedImage => {
        const stamp = disk.stamp(path)
        if (!stamp) throw new Error(`imageFollowHarness: no file ${path}`)
        return { key, filePath: path, stamp }
      }
    })
    Object.defineProperty(h, 'registered', { get: () => members.size, configurable: true })
  })

  afterEach(() => {
    h.follow.dispose()
  })

  return h
}

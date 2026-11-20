// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * `useFreshness` – one tracker per tab (#478 S12): built only once the first
 * read is in, from that read's stamp; released with the tab; rebuilt for a new
 * file; and reached by the window's focus and power-resume checks (G8).
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { UpdateRule } from '../../../shared/freshness/freshnessTypes'
import { textReadOutcome, type TextVersion } from '../../../shared/freshness/textOutcome'
import { installFakeFreshness } from '../services/freshness/__test__/fakeFreshnessEnvironment'
import { IDLE_FRESHNESS_STATE, useFreshness } from './useFreshness'

const A = '/proj/a.md'
const B = '/proj/b.md'
const SETTLED_MS = 3_000

const env = installFakeFreshness()

/** A rule that records what it applied. */
function recordingRule(applied: string[]): UpdateRule<TextVersion> {
  return {
    read: async () => textReadOutcome(await env.source.readText(A)),
    readNow: () => true,
    apply: (version) => {
      applied.push(version.text)
      return 'applied'
    }
  }
}

function renderTracker(initial: { filePath: string | null; ready: boolean }, applied: string[] = []) {
  const rule = recordingRule(applied)
  return renderHook(
    (props: { filePath: string | null; ready: boolean }) =>
      useFreshness<TextVersion>({
        filePath: props.filePath,
        profile: 'editor',
        rule,
        ready: props.ready,
        baseline: props.filePath ? env.disk.stamp(props.filePath) : undefined,
        visible: true
      }),
    { initialProps: initial }
  )
}

describe('useFreshness', () => {
  it('stays idle, with no subscription, until the first read is in', async () => {
    env.disk.write(A, 'a', { silent: true })
    const hook = renderTracker({ filePath: A, ready: false })
    await env.flush()

    expect(hook.result.current.tracker).toBeNull()
    expect(hook.result.current.state).toEqual(IDLE_FRESHNESS_STATE)
    expect(env.source.subscribeCalls).toHaveLength(0)

    hook.rerender({ filePath: A, ready: true })
    await env.flush()
    expect(env.source.subscribeCalls).toHaveLength(1)
    expect(hook.result.current.state.watch).toEqual({ kind: 'active', live: 'full' })
  })

  it('releases its subscription on unmount and stops listening', async () => {
    env.disk.write(A, 'a', { silent: true })
    const hook = renderTracker({ filePath: A, ready: true })
    await env.flush()

    hook.unmount()
    await env.flush()

    expect(env.source.subscriptions.size).toBe(0)
    expect(env.source.listenerCount).toBe(0)
  })

  it('builds a new tracker for a new file and releases the old one', async () => {
    env.disk.write(A, 'a', { silent: true })
    env.disk.write(B, 'b', { silent: true })
    const hook = renderTracker({ filePath: A, ready: true })
    await env.flush()
    const first = hook.result.current.tracker

    hook.rerender({ filePath: B, ready: true })
    await env.flush()

    expect(hook.result.current.tracker).not.toBe(first)
    expect([...env.source.subscriptions.values()].map((s) => s.filePath)).toEqual([B])
  })

  it('a power-resume check reads a change the watch never reported (G8)', async () => {
    env.disk.write(A, 'a', { silent: true })
    const applied: string[] = []
    renderTracker({ filePath: A, ready: true }, applied)
    await env.flush()
    env.disk.write(A, 'while asleep', { silent: true })

    act(() => env.check())
    await env.run(SETTLED_MS)

    expect(applied).toEqual(['while asleep'])
  })

  it('a window focus checks every tracker', async () => {
    env.disk.write(A, 'a', { silent: true })
    const applied: string[] = []
    renderTracker({ filePath: A, ready: true }, applied)
    await env.flush()
    env.disk.write(A, 'while away', { silent: true })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await env.run(SETTLED_MS)

    expect(applied).toEqual(['while away'])
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the reload-policy classify + coalesce (Issue #74, work item 32).
 *
 * classify: `.css` (single file) ⇒ swap; HTML/JS/other ⇒ reload; mixed/multi
 * burst ⇒ reload. coalesce: a burst of `record` calls collapses to one decision.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  classifyReload,
  createPreviewReloadPolicy,
  type ReloadDecision
} from './PreviewReloadPolicy'

describe('classifyReload', () => {
  it('swaps a single .css change', () => {
    expect(classifyReload(['styles/main.css'])).toEqual({
      action: 'swap',
      changedPath: 'styles/main.css'
    })
  })

  it('is case-insensitive on the extension', () => {
    expect(classifyReload(['STYLE.CSS'])).toEqual({ action: 'swap', changedPath: 'STYLE.CSS' })
  })

  it.each([
    ['html', ['index.html']],
    ['js', ['app.js']],
    ['image', ['logo.png']],
    ['no extension', ['Makefile']]
  ])('reloads on a single non-css change (%s)', (_label, paths) => {
    expect(classifyReload(paths)).toEqual({ action: 'reload' })
  })

  it('reloads on an empty burst', () => {
    expect(classifyReload([])).toEqual({ action: 'reload' })
  })

  it('reloads on a mixed burst (css + js)', () => {
    expect(classifyReload(['main.css', 'app.js'])).toEqual({ action: 'reload' })
  })

  it('reloads on a multi-css burst (cannot swap two sheets)', () => {
    expect(classifyReload(['a.css', 'b.css'])).toEqual({ action: 'reload' })
  })
})

describe('createPreviewReloadPolicy (coalesce)', () => {
  const makeTimerHarness = (): {
    setTimer: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>
    clearTimer: (h: ReturnType<typeof setTimeout>) => void
    run: () => void
    scheduled: () => boolean
  } => {
    let cb: (() => void) | null = null
    return {
      setTimer: (fn) => {
        cb = fn
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => {
        cb = null
      },
      run: () => {
        const fn = cb
        cb = null
        fn?.()
      },
      scheduled: () => cb !== null
    }
  }

  it('coalesces a single .css record into one swap decision', () => {
    const timer = makeTimerHarness()
    const onDecision = vi.fn<(d: ReloadDecision) => void>()
    const policy = createPreviewReloadPolicy({
      onDecision,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer
    })

    policy.record('main.css')
    expect(onDecision).not.toHaveBeenCalled()
    timer.run()

    expect(onDecision).toHaveBeenCalledExactlyOnceWith({ action: 'swap', changedPath: 'main.css' })
  })

  it('coalesces a mixed burst into one reload decision', () => {
    const timer = makeTimerHarness()
    const onDecision = vi.fn<(d: ReloadDecision) => void>()
    const policy = createPreviewReloadPolicy({
      onDecision,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer
    })

    policy.record('main.css')
    policy.record('app.js')
    policy.record('main.css') // duplicate, deduped
    timer.run()

    expect(onDecision).toHaveBeenCalledExactlyOnceWith({ action: 'reload' })
  })

  it('flush emits immediately and clears the pending timer', () => {
    const timer = makeTimerHarness()
    const onDecision = vi.fn<(d: ReloadDecision) => void>()
    const policy = createPreviewReloadPolicy({
      onDecision,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer
    })

    policy.record('theme.css')
    policy.flush()

    expect(onDecision).toHaveBeenCalledExactlyOnceWith({ action: 'swap', changedPath: 'theme.css' })
    expect(timer.scheduled()).toBe(false)
  })

  it('cancel drops the burst without emitting', () => {
    const timer = makeTimerHarness()
    const onDecision = vi.fn<(d: ReloadDecision) => void>()
    const policy = createPreviewReloadPolicy({
      onDecision,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer
    })

    policy.record('main.css')
    policy.cancel()
    timer.run() // no-op: cleared

    expect(onDecision).not.toHaveBeenCalled()
  })

  it('starts a fresh burst after a flush', () => {
    const timer = makeTimerHarness()
    const onDecision = vi.fn<(d: ReloadDecision) => void>()
    const policy = createPreviewReloadPolicy({
      onDecision,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer
    })

    policy.record('a.css')
    timer.run()
    policy.record('b.js')
    timer.run()

    expect(onDecision).toHaveBeenNthCalledWith(1, { action: 'swap', changedPath: 'a.css' })
    expect(onDecision).toHaveBeenNthCalledWith(2, { action: 'reload' })
  })

  it('flush with an empty buffer does nothing', () => {
    const timer = makeTimerHarness()
    const onDecision = vi.fn<(d: ReloadDecision) => void>()
    const policy = createPreviewReloadPolicy({
      onDecision,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer
    })

    policy.flush()
    expect(onDecision).not.toHaveBeenCalled()
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Reduced motion, app-wide (#96, docs/design-system/system/foundations/motion.html).
 *
 * The app holds one reduce block in its entry stylesheet. These tests run every
 * keyframe animation the shipped stylesheets define – read from the page, so a
 * stylesheet added later is covered too – on a probe element, and check that
 * under `prefers-reduced-motion: reduce` each one runs once and ends at once,
 * while without the preference the same animation still loops (so the check
 * can tell the two apart). The toast keeps its motion-safe opacity fade.
 *
 * The probe sets the animation inline; the reduce rule is `!important`, which
 * beats a normal inline declaration, exactly as it beats a component rule.
 */

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'

/** Per-animation result read in the page. */
interface Probe {
  name: string
  iterations: number
  durationMs: number
  finished: boolean
}

/** Longest a probe waits for its animation to finish. A 2 s loop never does. */
const FINISH_CAP_MS = 1_000

/**
 * Put one probe element per `@keyframes` rule in the page, animated with that
 * keyframe for 2 s, forever. Returns each animation's effective timing and
 * whether it finished (its own `finished` promise, capped at FINISH_CAP_MS).
 */
async function probeEveryKeyframe(page: Page): Promise<Probe[]> {
  return page.evaluate(async (cap) => {
    const names = new Set<string>()
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue // a cross-origin sheet: not ours
      }
      const visit = (list: CSSRuleList): void => {
        for (const rule of Array.from(list)) {
          if (rule instanceof CSSKeyframesRule) names.add(rule.name)
          else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
        }
      }
      visit(rules)
    }
    const host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    document.body.appendChild(host)
    const probes = [...names].map((name) => {
      const el = document.createElement('div')
      el.style.animation = `${name} 2s linear infinite`
      host.appendChild(el)
      return { name, el }
    })
    const out = await Promise.all(
      probes.map(async ({ name, el }) => {
        const animation = el.getAnimations()[0]
        const timing = animation?.effect?.getComputedTiming()
        const finished = animation
          ? await Promise.race([
              animation.finished.then(() => true),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), cap))
            ])
          : false
        return {
          name,
          iterations: Number(timing?.iterations ?? NaN),
          durationMs: Number(timing?.duration ?? NaN),
          finished
        }
      })
    )
    host.remove()
    return out
  }, FINISH_CAP_MS)
}

test.describe('Reduced motion', () => {
  test('under reduce, every keyframe animation runs once and ends at once', async ({ window: page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)

    const probes = await probeEveryKeyframe(page)
    // The shipped stylesheets declare well over a dozen; an empty list would prove nothing
    expect(probes.length).toBeGreaterThan(10)
    for (const p of probes) {
      expect(p, `${p.name} under reduce`).toEqual({ name: p.name, iterations: 1, durationMs: 1, finished: true })
    }
  })

  test('without the preference, the same animations still loop', async ({ window: page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const probes = await probeEveryKeyframe(page)
    expect(probes.length).toBeGreaterThan(10)
    for (const p of probes) {
      expect(p, `${p.name} with no preference`).toEqual({
        name: p.name,
        iterations: Infinity,
        durationMs: 2000,
        finished: false
      })
    }
  })

  test('under reduce, the toast cross-fades instead of sliding', async ({ window: page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const toast = await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'toast'
      document.body.appendChild(el)
      const animation = el.getAnimations()[0] as CSSAnimation | undefined
      const result = {
        name: animation?.animationName,
        durationMs: Number(animation?.effect?.getComputedTiming().duration)
      }
      el.remove()
      return result
    })
    expect(toast.name).toBe('toast-fade-in')
    // --transition-slower, not the 1 ms of the app-wide rule
    expect(toast.durationMs).toBeGreaterThan(100)
  })
})

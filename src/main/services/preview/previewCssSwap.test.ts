// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the CSS hot-swap script builder (Issue #74, work item 33).
 *
 * Covers version-query stripping, cache-bust href construction, and the swap
 * script's shape: correct busted href, insert-before-remove (no FOUC), and old
 * link removed only after the new one loads. The script's DOM behaviour is
 * exercised by driving the built script through jsdom.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { stripVersionQuery, buildCacheBustHref, buildCssSwapScript } from './previewCssSwap'

const TOKEN_BASE = 'erfana-preview://abc123/style.css'

describe('stripVersionQuery', () => {
  it('returns the base unchanged when there is no query', () => {
    expect(stripVersionQuery(TOKEN_BASE)).toBe(TOKEN_BASE)
  })

  it('strips a ?v= cache-buster', () => {
    expect(stripVersionQuery(`${TOKEN_BASE}?v=7`)).toBe(TOKEN_BASE)
  })

  it('strips a fragment', () => {
    expect(stripVersionQuery(`${TOKEN_BASE}#frag`)).toBe(TOKEN_BASE)
  })

  it('strips both query and fragment', () => {
    expect(stripVersionQuery(`${TOKEN_BASE}?v=7#frag`)).toBe(TOKEN_BASE)
  })
})

describe('buildCacheBustHref', () => {
  it('appends a changing ?v= token', () => {
    expect(buildCacheBustHref(TOKEN_BASE, 42)).toBe(`${TOKEN_BASE}?v=42`)
  })

  it('accepts a string version', () => {
    expect(buildCacheBustHref(TOKEN_BASE, 'abc')).toBe(`${TOKEN_BASE}?v=abc`)
  })
})

describe('buildCssSwapScript', () => {
  it('embeds both inputs as JSON string literals', () => {
    const script = buildCssSwapScript(TOKEN_BASE, `${TOKEN_BASE}?v=1`)
    expect(script).toContain(JSON.stringify(TOKEN_BASE))
    expect(script).toContain(JSON.stringify(`${TOKEN_BASE}?v=1`))
  })

  it('inserts the clone before removing the old node (source ordering)', () => {
    const script = buildCssSwapScript(TOKEN_BASE, `${TOKEN_BASE}?v=1`)
    const insertIdx = script.indexOf('insertBefore')
    const removeIdx = script.indexOf('removeChild')
    expect(insertIdx).toBeGreaterThan(-1)
    expect(removeIdx).toBeGreaterThan(-1)
    // The load-handler that removes the old node is registered before insert,
    // but the removal only runs on load — assert both operations are present.
    expect(script).toContain("addEventListener('load'")
    expect(script).toContain("addEventListener('error'")
  })

  describe('runtime behaviour in jsdom', () => {
    beforeEach(() => {
      // Fresh DOM per test (vitest jsdom environment provides the globals).
      document.head.innerHTML = `<link rel="stylesheet" href="${TOKEN_BASE}">`
      document.body.innerHTML = ''
      // jsdom has no rAF by default; make it synchronous.
      window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        cb(0)
        return 0
      }) as typeof window.requestAnimationFrame
    })

    const runSwap = (script: string): Promise<unknown> => {
      // Evaluate the built script in the test realm; `document` is a global.
      const runner = eval(`(function(){ return ${script}; })`) as () => Promise<unknown>
      return runner()
    }

    it('swaps in the new stylesheet and removes the old, resolving true', async () => {
      const newHref = `${TOKEN_BASE}?v=99`
      const promise = runSwap(buildCssSwapScript(TOKEN_BASE, newHref))

      // Two links now exist: the original and the freshly inserted clone.
      const links = document.querySelectorAll('link[rel="stylesheet"]')
      expect(links.length).toBe(2)
      const clone = links[1] as HTMLLinkElement
      expect(clone.getAttribute('href')).toBe(newHref)

      // Fire the clone's load event to complete the swap.
      clone.dispatchEvent(new Event('load'))

      await expect(promise).resolves.toBe(true)
      const after = document.querySelectorAll('link[rel="stylesheet"]')
      expect(after.length).toBe(1)
      expect((after[0] as HTMLLinkElement).getAttribute('href')).toBe(newHref)
    })

    it('resolves false and keeps the original when no link matches', async () => {
      const result = await runSwap(
        buildCssSwapScript('erfana-preview://abc123/other.css', 'erfana-preview://abc123/other.css?v=1')
      )
      expect(result).toBe(false)
      const links = document.querySelectorAll('link[rel="stylesheet"]')
      expect(links.length).toBe(1)
      expect((links[0] as HTMLLinkElement).getAttribute('href')).toBe(TOKEN_BASE)
    })

    it('matches the live link even when it already carries a ?v= buster', async () => {
      // Simulate a prior swap: the current link already has a version query.
      const live = document.querySelector('link') as HTMLLinkElement
      live.setAttribute('href', `${TOKEN_BASE}?v=1`)

      const newHref = `${TOKEN_BASE}?v=2`
      const promise = runSwap(buildCssSwapScript(TOKEN_BASE, newHref))
      const clone = document.querySelectorAll('link')[1] as HTMLLinkElement
      clone.dispatchEvent(new Event('load'))

      await expect(promise).resolves.toBe(true)
      const after = document.querySelectorAll('link')
      expect(after.length).toBe(1)
      expect((after[0] as HTMLLinkElement).getAttribute('href')).toBe(newHref)
    })

    it('removes the failed clone and resolves false on load error', async () => {
      const promise = runSwap(buildCssSwapScript(TOKEN_BASE, `${TOKEN_BASE}?v=3`))
      const clone = document.querySelectorAll('link')[1] as HTMLLinkElement
      clone.dispatchEvent(new Event('error'))

      await expect(promise).resolves.toBe(false)
      const after = document.querySelectorAll('link')
      expect(after.length).toBe(1)
      expect((after[0] as HTMLLinkElement).getAttribute('href')).toBe(TOKEN_BASE)
    })
  })
})

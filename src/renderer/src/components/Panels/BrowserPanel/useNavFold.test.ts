// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The fold measure on a hand-built row: jsdom has no layout, so every box's
 * width is set by hand and text is 8px a character. The row's fold CSS is
 * loaded, so a folded part leaves the flow as it does in the app, and the
 * row's `data-fold` follows the hook as `NavigationRow` sets it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { WebOriginParts } from '../../../../../shared/browser/originFormat'
import { navFoldAttribute } from './navFold.logic'
import { renderedFold, useNavFold } from './useNavFold'

const CHAR_PX = 8

/** `http://….evil.test:8080` once steps 1 and 2 are exhausted: 23 characters, 184px, plus 1px safety. */
const PARTS: WebOriginParts = {
  kind: 'web',
  scheme: 'http',
  subdomain: 'accounts.google.com.',
  registrableDomain: 'evil.test',
  port: '8080',
  punycode: false
}

function box<K extends keyof HTMLElementTagNameMap>(tag: K, width: number, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value)
  element.getBoundingClientRect = () => ({ width }) as DOMRect
  return element
}

/**
 * A row `rowWidth` wide: Back (7), Forward and Reload (4), the address
 * (8px margins and padding, the badge word as step 6), Open and DevTools (3),
 * then More; 4px gaps.
 */
function buildRow(rowWidth: number): HTMLDivElement {
  const row = box('div', rowWidth, { class: 'erf-brw-nav' })
  Object.defineProperty(row, 'clientWidth', { value: rowWidth })
  row.style.columnGap = '4px'
  row.style.setProperty('--space-4', '8px')
  row.style.setProperty('--space-2', '4px')
  const address = box('div', 0, { class: 'erf-brw-address' })
  address.style.cssText = 'margin-left: 8px; margin-right: 8px; padding-left: 8px; padding-right: 8px; column-gap: 4px'
  const badge = box('span', 0)
  badge.style.columnGap = '2px'
  badge.append(box('span', 14), box('span', 60, { 'data-fold-step': '6' }))
  const field = box('div', 0, { class: 'erf-brw-address__field' })
  field.append(box('input', 0, { class: 'erf-brw-address__input' }))
  // The badge's own box: icon, gap, word.
  badge.getBoundingClientRect = () => ({ width: 76 }) as DOMRect
  address.append(badge, field)
  row.append(
    box('button', 32, { 'data-fold-step': '7' }),
    box('button', 32, { 'data-fold-step': '4' }),
    box('button', 32, { 'data-fold-step': '4' }),
    address,
    box('button', 32, { 'data-fold-step': '3' }),
    box('button', 32, { 'data-fold-step': '3' }),
    box('button', 32)
  )
  document.body.append(row)
  return row
}

/** The rule of BrowserPanel.css that takes a folded part out of the flow (jsdom matches it). */
const FOLD_CSS = [3, 4, 6, 7].map(step => `.erf-brw-nav[data-fold~='${step}'] [data-fold-step='${step}'] { position: absolute; }`).join('\n')

/** The hook on `row`, with the row's `data-fold` kept in step during render. */
function foldOf(row: HTMLDivElement | null, parts: WebOriginParts | null) {
  return renderHook(() => {
    const count = useNavFold(row, parts)
    const attribute = navFoldAttribute(count)
    if (attribute === undefined) row?.removeAttribute('data-fold')
    else row?.setAttribute('data-fold', attribute)
    return count
  })
}

beforeEach(() => {
  // The measure runs on the next frame; here at once (jsdom has no ResizeObserver).
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const style = document.createElement('style')
  style.textContent = FOLD_CSS
  document.head.append(style)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: [...text].length * CHAR_PX })
  } as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  document.head.replaceChildren()
})

describe('useNavFold', () => {
  it('takes no step when the origin fits with every tool on the row', () => {
    // Field: 900 − 6 gaps(24) − 6 tools(192) − margins 16 − padding 16 − badge 76 − gap 4 = 572.
    const { result } = foldOf(buildRow(900), PARTS)
    expect(result.current).toBe(0)
  })

  it('takes steps in order until the scheme, domain and port fit, and settles there', () => {
    // At 400 the field has 72px with no step; the origin needs 185.
    // Step 3 gives 72 (two tools and gaps), step 4 another 72: 216 ≥ 185.
    const { result, rerender } = foldOf(buildRow(400), PARTS)
    expect(result.current).toBe(2)
    expect(document.querySelector('.erf-brw-nav')?.getAttribute('data-fold')).toBe('3 4')
    rerender()
    expect(result.current).toBe(2)
  })

  it('reads a field squeezed shut by its shortfall and folds every step, Back last', () => {
    // At 200 the field would be −128: even all five steps (72 + 72 + 8 + 62 + 36 = 250) leave 122.
    const { result } = foldOf(buildRow(200), PARTS)
    expect(result.current).toBe(5)
  })

  it('takes no step without a web origin, or before the row is laid out', () => {
    expect(foldOf(buildRow(200), null).result.current).toBe(0)
    expect(foldOf(null, PARTS).result.current).toBe(0)
    expect(foldOf(buildRow(0), PARTS).result.current).toBe(0)
  })

  it('takes no step when the text cannot be measured (no canvas)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(foldOf(buildRow(200), PARTS).result.current).toBe(0)
  })

  it('decides against the steps the DOM shows, not a count still waiting to render (no flip every frame)', () => {
    // The row shows steps 3 and 4 taken while the hook's own count is still 0: with them out of the
    // flow the field has 216px, of which 144 came from those steps – 72 with none, so 2 steps stay.
    // Read against the stale 0, the same layout says "fits" and the row would unfold and fold again.
    const row = buildRow(400)
    row.setAttribute('data-fold', '3 4')
    const { result } = renderHook(() => useNavFold(row, PARTS))
    expect(result.current).toBe(2)
  })
})

describe('renderedFold', () => {
  it('counts the steps in the row\'s data-fold', () => {
    const row = document.createElement('div')
    expect(renderedFold(row)).toBe(0)
    row.setAttribute('data-fold', '')
    expect(renderedFold(row)).toBe(0)
    row.setAttribute('data-fold', '3 4 5')
    expect(renderedFold(row)).toBe(3)
  })
})

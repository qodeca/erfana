// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A fake viewport for the virtualised project tree, opt-in per test suite.
 *
 * The tree mounts only the rows that fit its scroll container's height
 * (@tanstack/react-virtual). jsdom does no layout and reports 0 for every
 * element, so without this a tree test would see no rows at all. Calling
 * `installTreeViewport()` at the top of a suite gives `.project-tree-content`
 * (and nothing else) a height for each test and puts jsdom's getters back
 * after it.
 */
import { afterEach, beforeEach } from 'vitest'

/** Row height the tree positions rows by (`TREE_ROW_HEIGHT`, `--space-14`). */
const ROW_HEIGHT = 28

const PROPERTIES = [
  [Element.prototype, 'clientHeight'],
  [HTMLElement.prototype, 'offsetHeight']
] as const

/** Handle returned by {@link installTreeViewport}. */
export interface TreeViewport {
  /** Change the viewport height for the rest of the current test. */
  setHeight: (height: number) => void
}

/**
 * Give the project tree's scroll container a viewport in every test of the
 * calling suite. Both height properties are stubbed because the library reads
 * one or the other depending on its version.
 *
 * @param height - Viewport height in px; the default (2000px, about 70 rows)
 *   is more than any fixture needs, so every row is mounted
 * @returns A handle to change the height inside one test
 */
export function installTreeViewport(height = 2000): TreeViewport {
  let current = height
  const originals = PROPERTIES.map(([owner, property]) => ({
    property,
    getter: Object.getOwnPropertyDescriptor(owner, property)?.get,
    // What HTMLElement.prototype itself had (jsdom defines offsetHeight
    // there, clientHeight on Element.prototype), to put back afterwards.
    own: Object.getOwnPropertyDescriptor(HTMLElement.prototype, property)
  }))

  beforeEach(() => {
    current = height
    for (const { property, getter } of originals) {
      Object.defineProperty(HTMLElement.prototype, property, {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList.contains('project-tree-content')) return current
          return getter?.call(this) ?? 0
        }
      })
    }
  })

  afterEach(() => {
    for (const { property, own } of originals) {
      if (own) Object.defineProperty(HTMLElement.prototype, property, own)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property]
    }
  })

  return { setHeight: (next: number) => { current = next } }
}

/**
 * How many rows the tree's data has, read from the virtual list's sizer – the
 * one number that counts rows that are NOT mounted. Use it to assert that a
 * row is gone from the data, not merely scrolled out of range.
 *
 * @returns The visible-row count, or 0 when no list is rendered
 */
export function treeRowCount(): number {
  const sizer = document.querySelector<HTMLElement>('.project-tree-rows')
  return sizer ? Math.round(parseFloat(sizer.style.height) / ROW_HEIGHT) : 0
}

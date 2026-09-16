// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The link table (issue #124, part 3 §3.2): every row, on every platform.
 *
 * Row 1 is a SECURITY INVARIANT and is labelled as one (RX11): a report that
 * does not come from a proven click never keeps the page in its tab.
 *
 * @see previewLinkDisposition.ts
 */
import { describe, expect, it } from 'vitest'

import {
  decideLinkDisposition,
  isPreviewPagePath,
  requestedLinkDisposition,
  type LinkDispositionInput,
  type LinkModifiers,
  type LinkTargetFacts
} from './previewLinkDisposition'

const PLATFORMS = ['darwin', 'win32', 'linux'] as const
type Platform = (typeof PLATFORMS)[number]

/** An eligible HTML page, so rows 1 to 5 decide alone. */
const PAGE: LinkTargetFacts = { filePath: '/projects/site/pricing.html', eligible: true }

const NO_KEYS: LinkModifiers = { meta: false, ctrl: false, shift: false, alt: false }

/** Every kind of `target` a link can carry. */
const EVERY_TARGET = ['', '_self', '_top', '_parent', '_blank', 'named-frame'] as const

/** A plain left click as the preload reports it, with `overrides` applied. */
function click(overrides: Partial<LinkDispositionInput> = {}): LinkDispositionInput {
  return { provenance: 'gesture', button: 0, modifiers: NO_KEYS, target: '', ...overrides }
}

/** The platform's new-tab accelerator: Cmd on macOS, Ctrl elsewhere. */
function accelerator(platform: Platform): LinkModifiers {
  return platform === 'darwin' ? { ...NO_KEYS, meta: true } : { ...NO_KEYS, ctrl: true }
}

/** The other platforms' accelerator, which means nothing on this one. */
function foreignAccelerator(platform: Platform): LinkModifiers {
  return platform === 'darwin' ? { ...NO_KEYS, ctrl: true } : { ...NO_KEYS, meta: true }
}

describe.each(PLATFORMS)('decideLinkDisposition on %s', (platform) => {
  const deps = { platform }
  const decide = (link: Partial<LinkDispositionInput>, target: LinkTargetFacts = PAGE): string =>
    decideLinkDisposition(click(link), target, deps)

  describe('row 1 – SECURITY INVARIANT: only a proven click may keep the page in its tab', () => {
    // `will-navigate` fires for `location.href = …` as readily as for a click,
    // so its report proves nothing. If it could answer same-tab or by-mode, a
    // page could move its own tab to any page with nobody touching the mouse
    // (RX11). No other input may override this row.
    it.each(EVERY_TARGET)('navigation provenance opens a new tab (target "%s")', (target) => {
      expect(decide({ provenance: 'navigation', target })).toBe('new-tab')
    })

    it('holds for a will-navigate report, which carries no button and no keys', () => {
      expect(decideLinkDisposition({ provenance: 'navigation' }, PAGE, deps)).toBe('new-tab')
    })

    it('fails closed for a provenance it does not know', () => {
      const unknown = 'replay' as unknown as LinkDispositionInput['provenance']
      expect(decide({ provenance: unknown })).toBe('new-tab')
    })
  })

  describe('row 2 – a middle click or the accelerator opens a new tab', () => {
    it.each(EVERY_TARGET)('middle click (target "%s")', (target) => {
      expect(decide({ button: 1, target })).toBe('new-tab')
    })

    it.each(EVERY_TARGET)('the accelerator (target "%s")', (target) => {
      expect(decide({ modifiers: accelerator(platform), target })).toBe('new-tab')
    })

    it.each([2, 3, 4])('any other non-primary button (%i), which the preload never sends', (button) => {
      expect(decide({ button })).toBe('new-tab')
    })

    it("the other platforms' accelerator means nothing here", () => {
      expect(decide({ modifiers: foreignAccelerator(platform) })).toBe('by-mode')
      expect(decide({ modifiers: foreignAccelerator(platform), target: '_self' })).toBe('same-tab')
    })

    it('Shift and Alt mean nothing of their own', () => {
      const shiftAndAlt = { ...NO_KEYS, shift: true, alt: true }
      expect(decide({ modifiers: shiftAndAlt })).toBe('by-mode')
      expect(decide({ modifiers: shiftAndAlt, target: '_top' })).toBe('same-tab')
    })
  })

  describe('row 3 – _blank and named targets open a new tab', () => {
    it.each(['_blank', '_BLANK', 'named-frame', '_unknown'])('target "%s"', (target) => {
      expect(decide({ target })).toBe('new-tab')
    })
  })

  describe('row 4 – _self, _top and _parent keep the page in its tab', () => {
    it.each(['_self', '_top', '_parent', '_SELF', '_Parent'])('target "%s"', (target) => {
      expect(decide({ target })).toBe('same-tab')
    })
  })

  describe('row 5 – no target: the tab’s mode decides', () => {
    it('an empty target', () => {
      expect(decide({ target: '' })).toBe('by-mode')
    })

    it('a click reported with no target, button or keys', () => {
      expect(decideLinkDisposition({ provenance: 'gesture' }, PAGE, deps)).toBe('by-mode')
    })
  })

  describe('row 6 – a page that cannot run as a preview opens in its usual panel', () => {
    const STAYING = [
      ['', 'by-mode'],
      ['_self', 'same-tab']
    ] as const

    it.each(STAYING)('target "%s": an HTML page that opens as source', (target) => {
      expect(decide({ target }, { filePath: PAGE.filePath, eligible: false })).toBe('new-tab')
    })

    it.each([
      '/projects/site/notes.md',
      '/projects/site/report.pdf',
      '/projects/site/README',
      '/projects/site/page.html.bak'
    ])('a file that is not HTML, even when called eligible (%s)', (filePath) => {
      expect(decide({ target: '_self' }, { filePath, eligible: true })).toBe('new-tab')
      expect(decide({}, { filePath, eligible: true })).toBe('new-tab')
    })

    it.each(STAYING)('target "%s": an eligible .HTM page keeps its answer (%s)', (target, expected) => {
      expect(decide({ target }, { filePath: '/projects/site/INDEX.HTM', eligible: true })).toBe(
        expected
      )
    })
  })
})

describe('requestedLinkDisposition – rows 1 to 5, before the target is known', () => {
  const deps = { platform: 'darwin' as const }

  it.each([
    ['a plain click', click(), 'by-mode'],
    ['a _parent click', click({ target: '_parent' }), 'same-tab'],
    ['a _blank click', click({ target: '_blank' }), 'new-tab'],
    ['a middle click', click({ button: 1 }), 'new-tab'],
    ['a will-navigate report', click({ provenance: 'navigation' }), 'new-tab']
  ] as const)('%s asks for %s', (_label, link, expected) => {
    expect(requestedLinkDisposition(link, deps)).toBe(expected)
  })
})

describe('isPreviewPagePath', () => {
  it.each([
    ['/projects/site/index.html', true],
    ['/projects/site/index.htm', true],
    ['C:\\site\\Index.HTML', true],
    ['/projects/site/notes.md', false],
    ['/projects/site/Makefile', false],
    ['/projects/site/.html', false],
    ['/projects/site/page.html.bak', false],
    ['/projects/site.html/readme.txt', false]
  ])('%s → %s', (filePath, expected) => {
    expect(isPreviewPagePath(filePath)).toBe(expected)
  })
})

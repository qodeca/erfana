// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment tools in the preview toolbar
 * (docs/designs/comments/html-preview-comments.md §10.1, §10.10; R-010, R-021;
 * comments-v2 C-15, C-20, OD-04: two tools since the icons toggle moved to the drawer).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommentUnavailableReasonSchema } from '../../../../shared/ipc/preview-comment-schema'
import { TOOL_COPY, unavailableTooltip } from './commentCopy'
import { CommentToolbarTools, type CommentToolbarToolsProps } from './CommentToolbarTools'

function setup(patch: Partial<CommentToolbarToolsProps> = {}) {
  const props: CommentToolbarToolsProps = {
    mode: false,
    drawerOpen: false,
    drawerId: 'drawer-1',
    counts: null,
    ready: true,
    unavailable: null,
    onToggleMode: vi.fn(),
    onToggleDrawer: vi.fn(),
    ...patch
  }
  return { props, ...render(<CommentToolbarTools {...props} />) }
}

const modeButton = () => screen.getByTestId('preview-band-comment-mode')
const listButton = () => screen.getByTestId('preview-band-comments')

describe('CommentToolbarTools', () => {
  describe('R-010 toggles', () => {
    it('mode is a pressed toggle with its shortcut', async () => {
      const user = userEvent.setup()
      const { props, rerender } = setup()
      expect(modeButton()).toHaveAccessibleName(TOOL_COPY.mode)
      expect(modeButton()).toHaveAttribute('aria-pressed', 'false')
      expect(modeButton().getAttribute('aria-keyshortcuts')).toMatch(/\+Alt\+M$/)
      await user.click(modeButton())
      expect(props.onToggleMode).toHaveBeenCalledWith(false)
      rerender(<CommentToolbarTools {...props} mode />)
      expect(modeButton()).toHaveAttribute('aria-pressed', 'true')
      expect(modeButton().title).toContain('– on')
    })

    it('tells a keyboard activation apart from a click', () => {
      const { props } = setup()
      fireEvent.click(modeButton(), { detail: 0 })
      expect(props.onToggleMode).toHaveBeenCalledWith(true)
    })

    // Changed expectation under C-20 (was "Comments, 3 open" – the count's name now starts with its visible text).
    it('C-20 the count is a labelled disclosure: "3 comments", with no title that repeats it', async () => {
      const user = userEvent.setup()
      const { props, rerender } = setup({ counts: { open: 3, resolved: 1, attention: 0 } })
      expect(listButton()).toHaveAccessibleName('3 comments')
      expect(listButton().querySelector('.erf-comment-count__text')).toHaveTextContent('3 comments')
      expect(listButton()).not.toHaveAttribute('title')
      expect(listButton()).toHaveAttribute('aria-expanded', 'false')
      expect(listButton()).not.toHaveAttribute('aria-controls')
      await user.click(listButton())
      expect(props.onToggleDrawer).toHaveBeenCalled()
      rerender(<CommentToolbarTools {...props} drawerOpen />)
      expect(listButton()).toHaveAttribute('aria-expanded', 'true')
      expect(listButton()).toHaveAttribute('aria-controls', 'drawer-1')
    })

    // Changed expectation under C-15 (was 'shows the badge with "· !n"' and "Comments, 4 open, 2 need attention").
    it('C-15 damaged comments are the ▲ attention counter, a shape; the name adds only non-zero parts', () => {
      const { rerender, props } = setup({ counts: { open: 4, resolved: 0, attention: 2 } })
      const counter = listButton().querySelector('.erf-counter--attention')
      expect(counter).toHaveTextContent('2')
      expect(listButton()).toHaveAccessibleName('4 comments, 2 damaged')
      rerender(<CommentToolbarTools {...props} counts={{ open: 7, resolved: 0, attention: 1 }} changed={4} />)
      expect(listButton()).toHaveAccessibleName('7 comments, 4 changed, 1 damaged')
      rerender(<CommentToolbarTools {...props} counts={{ open: 1, resolved: 0, attention: 0 }} />)
      expect(listButton()).toHaveAccessibleName('1 comment')
      expect(listButton().querySelector('.erf-counter--attention')).toBeNull()
    })

    // Changed expectation under C-20 (was "Comments, none open" with an empty button).
    it('C-20 with no open comments the count reads "Comments", no number', () => {
      setup({ counts: { open: 0, resolved: 2, attention: 0 } })
      expect(listButton()).toHaveTextContent('Comments')
      expect(listButton()).toHaveAccessibleName('Comments')
      expect(listButton().querySelector('.erf-comment-count__number')).toBeNull()
    })

    it('C-20 the narrow tier has the icon and the number ready, hidden until the container is narrow', () => {
      setup({ counts: { open: 7, resolved: 0, attention: 0 } })
      expect(listButton().querySelector('.erf-comment-count__icon svg')).not.toBeNull()
      expect(listButton().querySelector('.erf-comment-count__number')).toHaveTextContent('7')
      const css = readFileSync(resolve(__dirname, 'CommentToolbarTools.css'), 'utf8')
      expect(css).toMatch(/@container \(width < 446px\) \{[\s\S]*erf-comment-count__text \{\s*display: none;/)
    })

    it('C-20 the icons toggle is gone from the row at every tier: two tools only', () => {
      setup({ counts: { open: 2, resolved: 0, attention: 0 } })
      expect(screen.queryByTestId('preview-band-comment-icons')).toBeNull()
      expect(screen.getAllByRole('button')).toHaveLength(2)
      expect(screen.queryByRole('button', { name: TOOL_COPY.pins })).toBeNull()
    })

    it('mode is disabled before the page has loaded', async () => {
      const user = userEvent.setup()
      const { props } = setup({ ready: false })
      expect(modeButton()).toHaveAttribute('aria-disabled', 'true')
      expect(modeButton().title).toBe(TOOL_COPY.modeNotReady)
      await user.click(modeButton())
      expect(props.onToggleMode).not.toHaveBeenCalled()
      // The list still opens: reading comments needs no live page.
      expect(listButton()).not.toHaveAttribute('aria-disabled')
    })

    it('a blocked mode that is on can still be switched off', async () => {
      const user = userEvent.setup()
      const { props } = setup({ mode: true, ready: false })
      await user.click(modeButton())
      expect(props.onToggleMode).toHaveBeenCalled()
    })
  })

  describe('R-021 unavailable state', () => {
    it.each(CommentUnavailableReasonSchema.options)('explains %s in the mode tooltip', reason => {
      setup({ unavailable: reason })
      expect(modeButton()).toHaveAttribute('aria-disabled', 'true')
      expect(modeButton().title).toBe(unavailableTooltip(reason))
    })

    // C-20: the icons tool these rows also checked is the drawer's checkbox now.
    it.each(['disabled', 'too-large', 'encoding', 'prepare-failed'] as const)(
      'blocks the list too when the file is unreadable (%s)',
      async reason => {
        const user = userEvent.setup()
        const { props } = setup({ unavailable: reason })
        expect(listButton()).toHaveAttribute('aria-disabled', 'true')
        expect(listButton().title).toBe(unavailableTooltip(reason))
        await user.click(listButton())
        expect(props.onToggleDrawer).not.toHaveBeenCalled()
      }
    )

    it.each(['page-too-large', 'overlay-removed', 'document-replaced'] as const)(
      'keeps the list usable when only the overlay is out (%s)',
      reason => {
        setup({ unavailable: reason })
        expect(listButton()).not.toHaveAttribute('aria-disabled')
      }
    )

    it('a blocked list that is open can still be closed', async () => {
      const user = userEvent.setup()
      const { props } = setup({ unavailable: 'encoding', drawerOpen: true })
      await user.click(listButton())
      expect(props.onToggleDrawer).toHaveBeenCalled()
    })
  })

  describe('narrow toolbar tiers (PreviewNavControls.css)', () => {
    const css = readFileSync(resolve(__dirname, '../Panels/HtmlPreviewPanel/components/PreviewNavControls.css'), 'utf8')
    const blocks = [...css.matchAll(/@container \(width < (\d+)px\) \{([\s\S]*?)\n\}/g)].map(m => ({
      width: Number(m[1]),
      body: m[2]
    }))

    // Changed expectation under C-20 (was "Show comment icons gives way first – in the narrow tier, before Find"):
    // the icons tool left the row at every tier, so only Find's tier remains to check.
    it('C-20 Find keeps its tier at the editor area minimum; no comment tool needs one', () => {
      setup()
      const find = blocks.find(b => b.body.includes("aria-label='Find'"))
      expect(find, 'Find has no tier').toBeDefined()
      // Find stays at the editor area's minimum width (400px).
      expect(find?.width).toBeLessThanOrEqual(400)
    })

    it('Comment mode and the list stay in every tier', () => {
      setup()
      for (const name of [modeButton(), listButton()].map(b => b.getAttribute('aria-label'))) {
        for (const block of blocks) expect(block.body).not.toContain(`aria-label='${name}'`)
      }
      expect(css).not.toMatch(/erf-band__tool--count\s*\{[^}]*display:\s*none/)
    })
  })
})

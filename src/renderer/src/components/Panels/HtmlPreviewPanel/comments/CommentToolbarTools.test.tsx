// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The three comment tools in the preview toolbar
 * (docs/designs/comments/html-preview-comments.md §10.1, §10.10; R-010, R-021).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommentUnavailableReasonSchema } from '../../../../../../shared/ipc/preview-comment-schema'
import { TOOL_COPY, unavailableTooltip } from './commentCopy'
import { CommentToolbarTools, type CommentToolbarToolsProps } from './CommentToolbarTools'

function setup(patch: Partial<CommentToolbarToolsProps> = {}) {
  const props: CommentToolbarToolsProps = {
    mode: false,
    showIcons: true,
    drawerOpen: false,
    drawerId: 'drawer-1',
    counts: null,
    ready: true,
    unavailable: null,
    onToggleMode: vi.fn(),
    onToggleDrawer: vi.fn(),
    onToggleIcons: vi.fn(),
    ...patch
  }
  return { props, ...render(<CommentToolbarTools {...props} />) }
}

const modeButton = () => screen.getByTestId('preview-band-comment-mode')
const listButton = () => screen.getByTestId('preview-band-comments')
const iconsButton = () => screen.getByTestId('preview-band-comment-icons')

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

    it('the list button expands the drawer and names its counts', async () => {
      const user = userEvent.setup()
      const { props, rerender } = setup({ counts: { open: 3, resolved: 1, attention: 0 } })
      expect(listButton()).toHaveAccessibleName('Comments, 3 open')
      expect(listButton()).toHaveAttribute('aria-expanded', 'false')
      expect(listButton()).not.toHaveAttribute('aria-controls')
      await user.click(listButton())
      expect(props.onToggleDrawer).toHaveBeenCalled()
      rerender(<CommentToolbarTools {...props} drawerOpen />)
      expect(listButton()).toHaveAttribute('aria-expanded', 'true')
      expect(listButton()).toHaveAttribute('aria-controls', 'drawer-1')
    })

    it('shows the badge with "· !n" for comments that need attention', () => {
      setup({ counts: { open: 4, resolved: 0, attention: 2 } })
      expect(listButton()).toHaveTextContent('4· !2')
      expect(listButton()).toHaveAccessibleName('Comments, 4 open, 2 need attention')
    })

    it('shows no number when there are no comments', () => {
      setup({ counts: { open: 0, resolved: 2, attention: 0 } })
      expect(listButton()).toHaveTextContent('')
      expect(listButton()).toHaveAccessibleName('Comments, none open')
    })

    it('icons are a pressed toggle, on by default', async () => {
      const user = userEvent.setup()
      const { props, rerender } = setup()
      expect(iconsButton()).toHaveAttribute('aria-pressed', 'true')
      expect(iconsButton().title).toBe(TOOL_COPY.pinsOn)
      await user.click(iconsButton())
      expect(props.onToggleIcons).toHaveBeenCalled()
      rerender(<CommentToolbarTools {...props} showIcons={false} />)
      expect(iconsButton()).toHaveAttribute('aria-pressed', 'false')
      expect(iconsButton().title).toBe(TOOL_COPY.pinsOff)
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

    it.each(['disabled', 'too-large', 'encoding', 'prepare-failed'] as const)(
      'blocks the list and icons too when the file is unreadable (%s)',
      async reason => {
        const user = userEvent.setup()
        const { props } = setup({ unavailable: reason })
        expect(listButton()).toHaveAttribute('aria-disabled', 'true')
        expect(listButton().title).toBe(unavailableTooltip(reason))
        expect(iconsButton()).toHaveAttribute('aria-disabled', 'true')
        await user.click(listButton())
        await user.click(iconsButton())
        expect(props.onToggleDrawer).not.toHaveBeenCalled()
        expect(props.onToggleIcons).not.toHaveBeenCalled()
      }
    )

    it.each(['page-too-large', 'overlay-removed', 'document-replaced'] as const)(
      'keeps the list and icons usable when only the overlay is out (%s)',
      reason => {
        setup({ unavailable: reason })
        expect(listButton()).not.toHaveAttribute('aria-disabled')
        expect(iconsButton()).not.toHaveAttribute('aria-disabled')
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
    const css = readFileSync(resolve(__dirname, '../components/PreviewNavControls.css'), 'utf8')
    const blocks = [...css.matchAll(/@container \(width < (\d+)px\) \{([\s\S]*?)\n\}/g)].map(m => ({
      width: Number(m[1]),
      body: m[2]
    }))

    it('Show comment icons gives way first – in the narrow tier, before Find', () => {
      setup()
      const icons = iconsButton().getAttribute('aria-label')
      const narrow = blocks.find(b => b.body.includes(`aria-label='${icons}'`))
      const find = blocks.find(b => b.body.includes("aria-label='Find'"))
      expect(narrow, 'Show comment icons is never hidden').toBeDefined()
      expect(find, 'Find has no tier').toBeDefined()
      // A wider threshold leaves the row first.
      expect(narrow?.width).toBeGreaterThan(find?.width ?? Infinity)
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

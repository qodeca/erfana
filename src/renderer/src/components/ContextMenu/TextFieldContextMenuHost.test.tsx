// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The app-level text-field menu (#463): one Cut / Copy / Paste / Delete menu
 * for every input and textarea without a menu of its own (Settings, search,
 * comment boxes), that steps aside for fields that open their own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextFieldContextMenuHost } from './TextFieldContextMenuHost'

const { mockWriteText, mockReadText } = vi.hoisted(() => ({ mockWriteText: vi.fn(), mockReadText: vi.fn() }))
vi.mock('../../services/textClipboard', () => ({
  textClipboard: { writeText: mockWriteText, readText: mockReadText }
}))
vi.mock('../../utils/platform', () => ({ isMacOS: () => false, isWindows: () => true }))

/** A React-controlled field, like the Settings ones: its value lives in state. */
function SettingsField({ readOnly = false, type = 'text' }: { readOnly?: boolean; type?: string }) {
  const [value, setValue] = useState('hello world')
  return (
    <>
      <input aria-label="Model" type={type} value={value} readOnly={readOnly} onChange={(e) => setValue(e.target.value)} />
      <output aria-label="State">{value}</output>
    </>
  )
}

/** A pointer right-click on any element (press, then the contextmenu event). */
function pointerRightClick(target: Element) {
  fireEvent.pointerDown(target, { button: 2 })
  fireEvent.contextMenu(target)
}

function renderWithHost(ui: React.ReactElement) {
  return render(
    <>
      {ui}
      <TextFieldContextMenuHost />
    </>
  )
}

function rightClick(field: HTMLInputElement | HTMLTextAreaElement, start: number, end: number) {
  act(() => {
    field.focus()
    field.setSelectionRange(start, end)
  })
  // A real right-click presses first, which tells it apart from the Windows Menu-key echo
  fireEvent.pointerDown(field, { button: 2 })
  fireEvent.contextMenu(field, { clientX: 40, clientY: 50 })
}

let portalRoot: HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteText.mockResolvedValue(true)
  mockReadText.mockResolvedValue('')
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})

afterEach(() => portalRoot.remove())

const field = () => screen.getByRole('textbox', { name: 'Model' }) as HTMLInputElement
const state = () => screen.getByRole('status', { name: 'State' })

describe('TextFieldContextMenuHost', () => {
  it('opens the text-field menu on a right-click in a Settings input, with hints', () => {
    renderWithHost(<SettingsField />)
    rightClick(field(), 0, 5)

    const menu = screen.getByRole('menu')
    expect(menu).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveAttribute('aria-keyshortcuts', 'Control+C')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).not.toHaveAttribute('aria-disabled')
  })

  it('Delete deletes the selection and React state follows', async () => {
    renderWithHost(<SettingsField />)
    rightClick(field(), 5, 11)

    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    await waitFor(() => expect(state()).toHaveTextContent(/^hello$/))
    expect(mockWriteText).not.toHaveBeenCalled()
  })

  it('disables Delete, Cut and Copy without a selection', () => {
    renderWithHost(<SettingsField />)
    rightClick(field(), 3, 3)

    for (const name of ['Cut', 'Copy', 'Delete']) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
    }
  })

  it('Copy writes the selection through textClipboard', async () => {
    renderWithHost(<SettingsField />)
    rightClick(field(), 0, 5)

    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))

    expect(mockWriteText).toHaveBeenCalledWith('hello')
  })

  it('Cut deletes only after the clipboard write succeeded', async () => {
    mockWriteText.mockResolvedValue(false)
    renderWithHost(<SettingsField />)
    rightClick(field(), 0, 6)

    await userEvent.click(screen.getByRole('menuitem', { name: 'Cut' }))

    await waitFor(() => expect(mockWriteText).toHaveBeenCalledWith('hello '))
    expect(state()).toHaveTextContent('hello world')
  })

  it('Paste replaces the selection with the clipboard text', async () => {
    mockReadText.mockResolvedValue('there')
    renderWithHost(<SettingsField />)
    rightClick(field(), 6, 11)

    await userEvent.click(screen.getByRole('menuitem', { name: 'Paste' }))

    await waitFor(() => expect(state()).toHaveTextContent('hello there'))
  })

  it('opens under the field with Shift+F10', () => {
    renderWithHost(<SettingsField />)
    act(() => field().focus())

    fireEvent.keyDown(field(), { key: 'F10', shiftKey: true })

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('steps aside for a field that opens its own menu', () => {
    renderWithHost(<textarea aria-label="Prompt" onContextMenu={(e) => e.preventDefault()} />)

    pointerRightClick(screen.getByRole('textbox', { name: 'Prompt' }))

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ignores non-text targets and Monaco or xterm textareas', () => {
    renderWithHost(
      <>
        <input aria-label="Toggle" type="checkbox" />
        <div className="monaco-editor">
          <textarea aria-label="Monaco input" />
        </div>
        <div className="xterm">
          <textarea aria-label="Terminal input" />
        </div>
      </>
    )

    pointerRightClick(screen.getByRole('checkbox', { name: 'Toggle' }))
    pointerRightClick(screen.getByRole('textbox', { name: 'Monaco input' }))
    pointerRightClick(screen.getByRole('textbox', { name: 'Terminal input' }))

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a read-only field offers Copy only', () => {
    renderWithHost(<SettingsField readOnly />)
    rightClick(field(), 0, 5)

    expect(screen.getByRole('menuitem', { name: 'Copy' })).not.toHaveAttribute('aria-disabled')
    for (const name of ['Cut', 'Paste', 'Delete']) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
    }
  })
})

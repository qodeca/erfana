// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every BaseDialog consumer keeps keyboard focus inside itself (#91).
 *
 * `BaseDialog` renders `aria-modal="true"`, which tells a screen reader that
 * everything behind the dialog is inert. That claim is only true when Tab
 * cannot reach the page behind it, so this suite drives the real dialogs —
 * not a BaseDialog harness — through the three things a keyboard user does:
 *
 * 1. Tab on the last control wraps to the first.
 * 2. Shift+Tab on the first control wraps to the last.
 * 3. Closing the dialog puts focus back on whatever opened it.
 *
 * The third is checked for both ways a dialog closes in this app: the
 * `isOpen` flag going false (app-root dialogs such as the screen pickers) and
 * the component unmounting (every DialogManager dialog – Confirm, Prompt,
 * Rename, … – which always renders `isOpen={true}` and is simply removed from
 * the list). Before #91 the unmount path restored nothing at all.
 *
 * Camera, Transcription and DocumentImport dialogs opted into the trap before
 * #91 and keep their own focused suites (`CameraDialog.keyboard.test.tsx`,
 * `TranscriptionDialog.test.tsx`, `DocumentImportDialog.test.tsx`); they need
 * hardware and IPC mocks that would drown the point of this table.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { TEST_IDS } from '../../constants/testids'
import { AlertDialog } from './AlertDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { ConflictDialog } from './ConflictDialog'
import { DropModeDialog } from './DropModeDialog'
import { FilePickerDialog } from './FilePickerDialog'
import { NewFileDialog } from './NewFileDialog'
import { NewFolderDialog } from './NewFolderDialog'
import { PromptDialog } from './PromptDialog'
import { RenameDialog } from './RenameDialog'
import { ScreenPermissionDialog } from './ScreenPermissionDialog'
import { ScreenSelectDialog } from './ScreenSelectDialog'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import { WindowPickerDialog } from './WindowPickerDialog'

/** Same selector BaseDialog uses for its trap boundaries. */
const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), ' +
  'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Past BaseDialog's 10 ms auto-focus delay, with headroom. */
const FOCUS_TICK_MS = 20

const Z = 10001
const noop = (): void => {}

/**
 * One row of the table.
 *
 * `render(open)` returns the dialog in its open or closed state. `closesBy`
 * says which of the two close paths the dialog really uses in the app, so
 * the focus-return assertion exercises the path that ships.
 */
interface DialogCase {
  name: string
  closesBy: 'unmount' | 'isOpen'
  render: (open: boolean) => ReactNode
}

const base = { id: 'focus-trap', title: 'Title', message: 'Message' }

const CASES: DialogCase[] = [
  {
    name: 'AlertDialog',
    closesBy: 'unmount',
    render: (open) => (open ? <AlertDialog config={base} zIndex={Z} onConfirm={noop} /> : null)
  },
  {
    name: 'ConfirmDialog',
    closesBy: 'unmount',
    render: (open) =>
      open ? <ConfirmDialog config={base} zIndex={Z} onConfirm={noop} onCancel={noop} /> : null
  },
  {
    name: 'ConfirmDialog (danger)',
    closesBy: 'unmount',
    render: (open) =>
      open ? (
        <ConfirmDialog config={{ ...base, danger: true }} zIndex={Z} onConfirm={noop} onCancel={noop} />
      ) : null
  },
  {
    name: 'PromptDialog',
    closesBy: 'unmount',
    render: (open) =>
      open ? <PromptDialog config={base} zIndex={Z} onSubmit={noop} onCancel={noop} /> : null
  },
  {
    name: 'RenameDialog',
    closesBy: 'unmount',
    render: (open) =>
      open ? (
        <RenameDialog
          config={{
            ...base,
            currentName: 'notes.md',
            itemPath: '/project/notes.md',
            itemType: 'file',
            parentPath: '/project'
          }}
          zIndex={Z}
          onSubmit={noop}
          onCancel={noop}
        />
      ) : null
  },
  {
    name: 'NewFileDialog',
    closesBy: 'unmount',
    render: (open) =>
      open ? (
        <NewFileDialog config={{ ...base, parentPath: '/project' }} zIndex={Z} onSubmit={noop} onCancel={noop} />
      ) : null
  },
  {
    name: 'NewFolderDialog',
    closesBy: 'unmount',
    render: (open) =>
      open ? (
        <NewFolderDialog config={{ ...base, parentPath: '/project' }} zIndex={Z} onSubmit={noop} onCancel={noop} />
      ) : null
  },
  {
    name: 'DropModeDialog',
    closesBy: 'unmount',
    render: (open) =>
      open ? (
        <DropModeDialog config={{ id: 'focus-trap', fileCount: 2 }} zIndex={Z} onSelect={noop} onCancel={noop} />
      ) : null
  },
  {
    name: 'ConflictDialog',
    closesBy: 'unmount',
    render: (open) =>
      open ? (
        <ConflictDialog
          config={{ id: 'focus-trap', fileName: 'a.md', targetPath: '/project/a.md' }}
          zIndex={Z}
          onSelect={noop}
          onCancel={noop}
        />
      ) : null
  },
  {
    name: 'UnsavedChangesDialog',
    closesBy: 'unmount',
    render: (open) =>
      open ? (
        <UnsavedChangesDialog
          config={{ id: 'focus-trap', fileName: 'page.html', variant: 'save' }}
          zIndex={Z}
          onSelect={noop}
          onCancel={noop}
        />
      ) : null
  },
  {
    name: 'ScreenPermissionDialog',
    closesBy: 'isOpen',
    render: (open) => <ScreenPermissionDialog isOpen={open} onClose={noop} status="denied" zIndex={Z} />
  },
  {
    name: 'ScreenSelectDialog',
    closesBy: 'isOpen',
    render: (open) => (
      <ScreenSelectDialog
        isOpen={open}
        displays={[
          { id: 1, label: 'Built-in', isPrimary: true, bounds: { x: 0, y: 0, width: 1512, height: 982 } },
          { id: 2, label: 'External', isPrimary: false, bounds: { x: 1512, y: 0, width: 2560, height: 1440 } }
        ]}
        zIndex={Z}
        onSelect={noop}
        onCancel={noop}
      />
    )
  },
  {
    name: 'WindowPickerDialog',
    closesBy: 'isOpen',
    render: (open) => (
      <WindowPickerDialog
        isOpen={open}
        sources={[
          { id: 'w1', name: 'Editor', thumbnailDataUrl: '', width: 800, height: 600 },
          { id: 'w2', name: 'Browser', thumbnailDataUrl: '', width: 800, height: 600 }
        ]}
        zIndex={Z}
        onSelect={noop}
        onCancel={noop}
      />
    )
  },
  {
    name: 'FilePickerDialog',
    closesBy: 'isOpen',
    render: (open) => (
      <FilePickerDialog
        isOpen={open}
        onClose={noop}
        onSelect={noop}
        candidates={[
          { path: '/project/a/readme.md', score: 2, matchType: 'exact-filename' },
          { path: '/project/b/readme.md', score: 1, matchType: 'exact-filename' }
        ]}
        query="readme.md"
        projectRoot="/project"
        zIndex={Z}
      />
    )
  }
]

/**
 * The page behind the dialog: a real control before and after it, so a Tab
 * that is NOT intercepted has somewhere to go.
 */
function Page({ open, dialog }: { open: boolean; dialog: DialogCase }): JSX.Element {
  return (
    <>
      <button data-testid="opener">Opener</button>
      {dialog.render(open)}
      <button data-testid="behind">Behind the dialog</button>
    </>
  )
}

function flushFocus(): void {
  act(() => {
    vi.advanceTimersByTime(FOCUS_TICK_MS)
  })
}

/** The open dialog's container and its Tab boundaries. */
function dialogParts(): { container: HTMLElement; first: HTMLElement; last: HTMLElement } {
  const containers = document.querySelectorAll<HTMLElement>(`[data-testid="${TEST_IDS.DIALOG_CONTAINER}"]`)
  expect(containers).toHaveLength(1)
  const container = containers[0]
  const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  expect(focusable.length).toBeGreaterThan(0)
  return { container, first: focusable[0], last: focusable[focusable.length - 1] }
}

/** Press a key the way the browser does: on the focused element, bubbling to `document`. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  const target = document.activeElement ?? document.body
  return fireEvent.keyDown(target, { key, ...init })
}

describe('every BaseDialog consumer traps focus (#91)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  /** Open the dialog from a focused opener, as a click or shortcut would. */
  function openFromOpener(dialog: DialogCase): ReturnType<typeof render> {
    const result = render(<Page open={false} dialog={dialog} />)
    const opener = result.getByTestId('opener')
    opener.focus()
    result.rerender(<Page open dialog={dialog} />)
    flushFocus()
    return result
  }

  describe.each(CASES)('$name', (dialog) => {
    it('declares itself modal', () => {
      openFromOpener(dialog)
      expect(dialogParts().container).toHaveAttribute('aria-modal', 'true')
    })

    it('wraps Tab from the last control to the first', () => {
      openFromOpener(dialog)
      const { first, last } = dialogParts()

      last.focus()
      const notPrevented = press('Tab')

      expect(notPrevented).toBe(false)
      expect(document.activeElement).toBe(first)
    })

    it('wraps Shift+Tab from the first control to the last', () => {
      openFromOpener(dialog)
      const { first, last } = dialogParts()

      first.focus()
      const notPrevented = press('Tab', { shiftKey: true })

      expect(notPrevented).toBe(false)
      expect(document.activeElement).toBe(last)
    })

    it('pulls escaped focus back in on Tab', () => {
      const { getByTestId } = openFromOpener(dialog)
      const { container } = dialogParts()

      getByTestId('behind').focus()
      press('Tab')

      expect(container.contains(document.activeElement)).toBe(true)
    })

    it(`returns focus to the opener on close (${dialog.closesBy})`, () => {
      const result = openFromOpener(dialog)
      const opener = result.getByTestId('opener')
      // Focus is inside the dialog, as it is for a real user at close time.
      expect(dialogParts().container.contains(document.activeElement)).toBe(true)

      result.rerender(<Page open={false} dialog={dialog} />)

      expect(document.querySelector(`[data-testid="${TEST_IDS.DIALOG_CONTAINER}"]`)).toBeNull()
      expect(document.activeElement).toBe(opener)
    })
  })
})

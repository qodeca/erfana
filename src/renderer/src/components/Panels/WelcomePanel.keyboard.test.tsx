// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Keyboard access to the Welcome panel's recent-projects list ([24], lens
 * review of v0.21.0).
 *
 * Before: every row was a `<div onClick>` – no role, no tab stop, no key
 * handler – so a keyboard user could not open a recent project at all, and
 * every Remove button announced the same name.
 *
 * The contract tested here is the decided Rows & lists card
 * (design/system/components/row/index.html): the list is ONE Tab stop, ↑/↓
 * move between rows, Home/End jump to the ends, Enter opens. Space opens too,
 * because the row's control is a native button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomePanel, nextRecentIndex } from './WelcomePanel'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'

const PROJECTS = [
  { path: '/path/alpha', name: 'alpha', lastOpened: Date.now() - 60_000 },
  { path: '/path/beta', name: 'beta', lastOpened: Date.now() - 3_600_000 },
  { path: '/path/gamma', name: 'gamma', lastOpened: Date.now() - 86_400_000 }
]

const mockGetRecentProjects = vi.fn()
const mockRemoveRecentProject = vi.fn()
const mockHandleOpenProjectByPath = vi.fn()
const mockState = { isProjectChanging: false }

vi.mock('../../stores/useProjectStore', () => ({
  useProjectStore: (selector: (state: { isProjectChanging: boolean }) => boolean) => selector(mockState)
}))

vi.mock('../../context/ProjectManagementContext', () => ({
  useOpenProjectByPath: () => ({ handleOpenProjectByPath: mockHandleOpenProjectByPath }),
  useProjectManagementContext: () => ({
    projectPath: null,
    handleOpenProject: vi.fn(),
    isSwitchingProject: false
  })
}))

vi.mock('../../hooks/useImport', () => ({
  useImport: () => ({ isImporting: false, importFile: vi.fn() })
}))

vi.mock('../../components/Toast/toastService', () => ({
  showGlobalToast: vi.fn()
}))

const mockApi = {
  settings: {
    getRecentProjects: mockGetRecentProjects,
    removeRecentProject: mockRemoveRecentProject
  },
  file: { onProjectChanged: vi.fn(() => vi.fn()) }
}
const originalApi = (window as unknown as { api?: typeof mockApi }).api

const dockviewProps = {
  api: {} as never,
  containerApi: {} as never,
  params: {},
  group: {} as never,
  title: 'Welcome'
}

/** The keyboard "open" control of the row for `path`. */
function openButton(path: string): HTMLElement {
  return screen.getByTestId(getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT_BTN_OPEN, path))
}

/** The Remove control of the row for `path`. */
function removeButton(path: string): HTMLElement {
  return screen.getByTestId(getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT_BTN_REMOVE, path))
}

async function renderLoaded(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<WelcomePanel {...dockviewProps} />)
  await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
  return user
}

/** Tab from the Open project button into the list. */
async function tabIntoList(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  screen.getByTestId(TEST_IDS.WELCOME_BTN_OPEN).focus()
  await user.tab()
}

describe('WelcomePanel recent projects – keyboard ([24])', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.isProjectChanging = false
    ;(window as unknown as { api: typeof mockApi }).api = mockApi
    mockGetRecentProjects.mockResolvedValue({ success: true, projects: PROJECTS })
    mockHandleOpenProjectByPath.mockResolvedValue(true)
    mockRemoveRecentProject.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    ;(window as unknown as { api?: typeof mockApi }).api = originalApi
  })

  describe('Tab', () => {
    it('reaches the list from the Open project button', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)

      expect(document.activeElement).toBe(openButton('/path/alpha'))
    })

    it('holds one Tab stop for the list: the active row and its Remove, then out', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)

      await user.tab()
      expect(document.activeElement).toBe(removeButton('/path/alpha'))

      await user.tab()
      // Past the list: no other row's control is in the Tab order.
      const list = screen.getByTestId(TEST_IDS.WELCOME_RECENT_PROJECTS)
      expect(list.contains(document.activeElement)).toBe(false)
    })

    it('keeps every other row out of the Tab order', async () => {
      await renderLoaded()

      for (const { path } of PROJECTS.slice(1)) {
        expect(openButton(path)).toHaveAttribute('tabindex', '-1')
        expect(removeButton(path)).toHaveAttribute('tabindex', '-1')
      }
      expect(openButton('/path/alpha')).toHaveAttribute('tabindex', '0')
    })

    it('returns to the row the user left, not the first one', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(openButton('/path/beta'))

      await user.tab() // beta's Remove
      await user.tab() // out of the list
      await user.tab({ shift: true })

      expect(document.activeElement).toBe(removeButton('/path/beta'))
    })
  })

  describe('arrow keys (Rows & lists card)', () => {
    it('moves down and up between rows', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)

      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(openButton('/path/beta'))
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(openButton('/path/gamma'))
      await user.keyboard('{ArrowUp}')
      expect(document.activeElement).toBe(openButton('/path/beta'))
    })

    it('clamps at both ends instead of wrapping', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)

      await user.keyboard('{ArrowUp}')
      expect(document.activeElement).toBe(openButton('/path/alpha'))

      await user.keyboard('{End}{ArrowDown}')
      expect(document.activeElement).toBe(openButton('/path/gamma'))
    })

    it('jumps with Home and End', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)

      await user.keyboard('{End}')
      expect(document.activeElement).toBe(openButton('/path/gamma'))
      await user.keyboard('{Home}')
      expect(document.activeElement).toBe(openButton('/path/alpha'))
    })

    it('works from a row\'s Remove button too', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)
      await user.tab()
      expect(document.activeElement).toBe(removeButton('/path/alpha'))

      await user.keyboard('{ArrowDown}')

      expect(document.activeElement).toBe(openButton('/path/beta'))
    })

    it('moves the Tab stop with focus', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)
      await user.keyboard('{ArrowDown}')

      expect(openButton('/path/beta')).toHaveAttribute('tabindex', '0')
      expect(removeButton('/path/beta')).toHaveAttribute('tabindex', '0')
      expect(openButton('/path/alpha')).toHaveAttribute('tabindex', '-1')
    })
  })

  describe('activation', () => {
    it('opens the focused project with Enter', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)
      await user.keyboard('{ArrowDown}{Enter}')

      expect(mockHandleOpenProjectByPath).toHaveBeenCalledTimes(1)
      expect(mockHandleOpenProjectByPath).toHaveBeenCalledWith('/path/beta')
    })

    it('opens the focused project with Space', async () => {
      const user = await renderLoaded()
      await tabIntoList(user)
      await user.keyboard(' ')

      expect(mockHandleOpenProjectByPath).toHaveBeenCalledTimes(1)
      expect(mockHandleOpenProjectByPath).toHaveBeenCalledWith('/path/alpha')
    })

    it('does nothing while a project change is in progress, and keeps focus', async () => {
      mockState.isProjectChanging = true
      const user = await renderLoaded()
      await tabIntoList(user)
      const button = openButton('/path/alpha')
      expect(button).toHaveAttribute('aria-disabled', 'true')

      await user.keyboard('{Enter}')

      expect(mockHandleOpenProjectByPath).not.toHaveBeenCalled()
      // `aria-disabled`, not `disabled`: focus is not dropped to <body>.
      expect(document.activeElement).toBe(button)
    })

    it('keeps focus on the row while it is opening', async () => {
      mockHandleOpenProjectByPath.mockImplementation(() => new Promise(() => {}))
      const user = await renderLoaded()
      await tabIntoList(user)

      await user.keyboard('{Enter}')

      await waitFor(() => expect(openButton('/path/alpha')).toHaveAttribute('aria-disabled', 'true'))
      expect(document.activeElement).toBe(openButton('/path/alpha'))
    })
  })

  describe('names', () => {
    it('names the open control after the project and describes it with the path', async () => {
      await renderLoaded()

      const button = screen.getByRole('button', { name: 'alpha' })
      expect(button).toBe(openButton('/path/alpha'))
      expect(button).toHaveAccessibleDescription(expect.stringContaining('/path/alpha'))
    })

    it('gives every Remove button a distinct name', async () => {
      await renderLoaded()

      for (const { name, path } of PROJECTS) {
        expect(screen.getByRole('button', { name: `Remove ${name} from recent projects` })).toBe(
          removeButton(path)
        )
      }
    })

    it('exposes the rows as a labelled list', async () => {
      await renderLoaded()

      const list = screen.getByRole('list', { name: 'Recent projects' })
      expect(list).toBe(screen.getByTestId(TEST_IDS.WELCOME_RECENT_PROJECTS))
      expect(screen.getAllByRole('listitem')).toHaveLength(PROJECTS.length)
    })
  })

  describe('focus after removing a row', () => {
    it('moves to the row that took the removed one\'s place', async () => {
      const user = await renderLoaded()
      mockGetRecentProjects.mockResolvedValue({
        success: true,
        projects: PROJECTS.filter((p) => p.path !== '/path/alpha')
      })
      await tabIntoList(user)
      await user.tab()
      expect(document.activeElement).toBe(removeButton('/path/alpha'))

      await user.keyboard('{Enter}')

      await waitFor(() => expect(screen.queryByText('alpha')).not.toBeInTheDocument())
      await waitFor(() => expect(document.activeElement).toBe(openButton('/path/beta')))
    })

    it('moves to the new last row when the last row is removed', async () => {
      const user = await renderLoaded()
      mockGetRecentProjects.mockResolvedValue({
        success: true,
        projects: PROJECTS.filter((p) => p.path !== '/path/gamma')
      })
      await tabIntoList(user)
      await user.keyboard('{End}')
      await user.tab()
      expect(document.activeElement).toBe(removeButton('/path/gamma'))

      await user.keyboard('{Enter}')

      await waitFor(() => expect(screen.queryByText('gamma')).not.toBeInTheDocument())
      await waitFor(() => expect(document.activeElement).toBe(openButton('/path/beta')))
    })

    it('moves to the Open project button when the list empties', async () => {
      mockGetRecentProjects.mockResolvedValueOnce({ success: true, projects: [PROJECTS[0]] })
      const user = await renderLoaded()
      mockGetRecentProjects.mockResolvedValue({ success: true, projects: [] })
      await tabIntoList(user)
      await user.tab()

      await user.keyboard('{Enter}')

      await waitFor(() => expect(screen.queryByText('alpha')).not.toBeInTheDocument())
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByTestId(TEST_IDS.WELCOME_BTN_OPEN))
      )
    })

    it('does not pull focus into the list when it was elsewhere', async () => {
      await renderLoaded()
      mockGetRecentProjects.mockResolvedValue({
        success: true,
        projects: PROJECTS.filter((p) => p.path !== '/path/alpha')
      })
      const elsewhere = document.createElement('button')
      document.body.appendChild(elsewhere)

      try {
        // A pointer click that does not move focus (the default in jsdom).
        elsewhere.focus()
        removeButton('/path/alpha').click()

        await waitFor(() => expect(screen.queryByText('alpha')).not.toBeInTheDocument())
        expect(document.activeElement).toBe(elsewhere)
      } finally {
        elsewhere.remove()
      }
    })
  })
})

describe('nextRecentIndex', () => {
  it.each([
    ['ArrowDown', 0, 3, 1],
    ['ArrowDown', 2, 3, 2],
    ['ArrowUp', 1, 3, 0],
    ['ArrowUp', 0, 3, 0],
    ['Home', 2, 3, 0],
    ['End', 0, 3, 2],
    ['ArrowDown', 0, 1, 0],
    ['End', 0, 1, 0]
  ])('%s from %i of %i -> %i', (key, current, count, expected) => {
    expect(nextRecentIndex(key, current, count)).toBe(expected)
  })

  it.each(['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'Tab', 'a'])('ignores %j', (key) => {
    expect(nextRecentIndex(key, 0, 3)).toBeNull()
  })
})

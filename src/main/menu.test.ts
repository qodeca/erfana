// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { PREVIEW } from '../shared/constants'

// Mock spawnNewInstance before importing menu
vi.mock('./utils/spawnNewInstance', () => ({
  spawnNewInstance: vi.fn()
}))

/**
 * Application Menu Tests
 *
 * Tests for the Electron application menu with Edit roles for native clipboard support.
 * Verifies platform-specific menu structure and required clipboard roles.
 */

describe('Application Menu Creation', () => {
  let originalPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.resetModules()
    // Store original platform descriptor
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  })

  afterEach(() => {
    vi.clearAllMocks()
    // Restore original platform
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  /**
   * Helper to mock platform and import fresh menu module
   */
  async function importMenuWithPlatform(platform: string) {
    // Mock process.platform
    Object.defineProperty(process, 'platform', {
      value: platform,
      writable: true,
      configurable: true
    })

    // Mock electron
    vi.doMock('electron', () => ({
      Menu: {
        buildFromTemplate: vi.fn((template) => ({ _template: template }))
      },
      app: {
        name: 'ERFANA'
      }
    }))

    const { createApplicationMenu } = await import('./menu')
    return createApplicationMenu()
  }

  /**
   * Helper to extract template from menu result
   */
  function getTemplate(menu: any): any[] {
    return menu._template
  }

  /**
   * Helper to find menu by label
   */
  function findMenu(template: any[], label: string): any | undefined {
    return template.find((item) => item.label === label)
  }

  /**
   * Helper to check if submenu contains a role
   */
  function hasRole(submenu: any[], role: string): boolean {
    return submenu.some((item) => item.role === role)
  }

  // ============================================================================
  // Platform-specific behavior
  // ============================================================================

  describe('Platform-specific behavior', () => {
    describe('macOS (darwin)', () => {
      it('should include app menu on macOS', async () => {
        const menu = await importMenuWithPlatform('darwin')
        const template = getTemplate(menu)

        // First menu should be app menu with app name
        expect(template[0].label).toBe('ERFANA')
      })

      it('should include standard macOS app menu items', async () => {
        const menu = await importMenuWithPlatform('darwin')
        const template = getTemplate(menu)
        const appMenu = template[0]

        expect(hasRole(appMenu.submenu, 'about')).toBe(true)
        expect(hasRole(appMenu.submenu, 'hide')).toBe(true)
        expect(hasRole(appMenu.submenu, 'hideOthers')).toBe(true)
        expect(hasRole(appMenu.submenu, 'unhide')).toBe(true)
        expect(hasRole(appMenu.submenu, 'quit')).toBe(true)
      })

      it('should include separators in app menu', async () => {
        const menu = await importMenuWithPlatform('darwin')
        const template = getTemplate(menu)
        const appMenu = template[0]

        const separators = appMenu.submenu.filter((item: any) => item.type === 'separator')
        expect(separators.length).toBeGreaterThanOrEqual(2)
      })

      it('should have Window menu with front role on macOS', async () => {
        const menu = await importMenuWithPlatform('darwin')
        const template = getTemplate(menu)
        const windowMenu = findMenu(template, 'Window')

        expect(windowMenu).toBeDefined()
        expect(hasRole(windowMenu.submenu, 'front')).toBe(true)
        expect(hasRole(windowMenu.submenu, 'close')).toBe(false)
      })
    })

    describe('Windows (win32)', () => {
      it('should NOT include app menu on Windows', async () => {
        const menu = await importMenuWithPlatform('win32')
        const template = getTemplate(menu)

        // First menu should be File, not app menu
        expect(template[0].label).toBe('File')
      })

      it('should have Window menu with close role on Windows', async () => {
        const menu = await importMenuWithPlatform('win32')
        const template = getTemplate(menu)
        const windowMenu = findMenu(template, 'Window')

        expect(windowMenu).toBeDefined()
        expect(hasRole(windowMenu.submenu, 'close')).toBe(true)
        expect(hasRole(windowMenu.submenu, 'front')).toBe(false)
      })
    })

    describe('Linux', () => {
      it('should NOT include app menu on Linux', async () => {
        const menu = await importMenuWithPlatform('linux')
        const template = getTemplate(menu)

        // First menu should be File, not app menu
        expect(template[0].label).toBe('File')
      })

      it('should have Window menu with close role on Linux', async () => {
        const menu = await importMenuWithPlatform('linux')
        const template = getTemplate(menu)
        const windowMenu = findMenu(template, 'Window')

        expect(windowMenu).toBeDefined()
        expect(hasRole(windowMenu.submenu, 'close')).toBe(true)
        expect(hasRole(windowMenu.submenu, 'front')).toBe(false)
      })
    })
  })

  // ============================================================================
  // Universal menus (all platforms)
  // ============================================================================

  describe('Universal menus', () => {
    it('should include Edit menu', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const editMenu = findMenu(template, 'Edit')

      expect(editMenu).toBeDefined()
    })

    it('should include View menu', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const viewMenu = findMenu(template, 'View')

      expect(viewMenu).toBeDefined()
    })

    it('should include Window menu', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const windowMenu = findMenu(template, 'Window')

      expect(windowMenu).toBeDefined()
    })

    it('should have 5 menus on macOS (app, file, edit, view, window)', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)

      expect(template.length).toBe(5)
    })

    it('should have 4 menus on Windows/Linux (file, edit, view, window)', async () => {
      const menu = await importMenuWithPlatform('win32')
      const template = getTemplate(menu)

      expect(template.length).toBe(4)
    })
  })

  // ============================================================================
  // Edit menu roles (CRITICAL for clipboard)
  // ============================================================================

  describe('Edit menu - clipboard roles', () => {
    it('should include undo role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const editMenu = findMenu(template, 'Edit')

      expect(hasRole(editMenu.submenu, 'undo')).toBe(true)
    })

    it('should include redo role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const editMenu = findMenu(template, 'Edit')

      expect(hasRole(editMenu.submenu, 'redo')).toBe(true)
    })

    it('should include cut role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const editMenu = findMenu(template, 'Edit')

      expect(hasRole(editMenu.submenu, 'cut')).toBe(true)
    })

    it('should include copy role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const editMenu = findMenu(template, 'Edit')

      expect(hasRole(editMenu.submenu, 'copy')).toBe(true)
    })

    it('should include paste role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const editMenu = findMenu(template, 'Edit')

      expect(hasRole(editMenu.submenu, 'paste')).toBe(true)
    })

    it('should include selectAll role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const editMenu = findMenu(template, 'Edit')

      expect(hasRole(editMenu.submenu, 'selectAll')).toBe(true)
    })

    it('should have all essential clipboard roles', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const editMenu = findMenu(template, 'Edit')

      const essentialRoles = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']
      for (const role of essentialRoles) {
        expect(hasRole(editMenu.submenu, role)).toBe(true)
      }
    })

    it('should have separator between undo/redo and clipboard operations', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const editMenu = findMenu(template, 'Edit')

      // Check that there's a separator (undo, redo, separator, cut, copy, paste, selectAll)
      const separators = editMenu.submenu.filter((item: any) => item.type === 'separator')
      expect(separators.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // View menu roles
  // ============================================================================

  describe('View menu', () => {
    it('should include reload role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const viewMenu = findMenu(template, 'View')

      expect(hasRole(viewMenu.submenu, 'reload')).toBe(true)
    })

    it('should include forceReload role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const viewMenu = findMenu(template, 'View')

      expect(hasRole(viewMenu.submenu, 'forceReload')).toBe(true)
    })

    it('should include toggleDevTools role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const viewMenu = findMenu(template, 'View')

      expect(hasRole(viewMenu.submenu, 'toggleDevTools')).toBe(true)
    })

    it('should include zoom controls, as handlers rather than roles', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const viewMenu = findMenu(template, 'View')
      const labels = viewMenu.submenu.map((item) => item.label)

      expect(labels).toEqual(expect.arrayContaining(['Actual Size', 'Zoom In', 'Zoom Out']))
      for (const item of viewMenu.submenu) {
        if (['Actual Size', 'Zoom In', 'Zoom Out'].includes(item.label ?? '')) {
          expect(typeof item.click).toBe('function')
          expect(item.accelerator).toBeTruthy()
        }
      }

      // The built-in roles are deliberately gone. A menu accelerator is global to
      // the app, so with a previewed page focused Cmd/Ctrl-+ would fire the role
      // AND be forwarded into the page — zooming the host window and the page at
      // once, in opposite directions as far as the reader is concerned.
      expect(hasRole(viewMenu.submenu, 'resetZoom')).toBe(false)
      expect(hasRole(viewMenu.submenu, 'zoomIn')).toBe(false)
      expect(hasRole(viewMenu.submenu, 'zoomOut')).toBe(false)
    })

    it('should include togglefullscreen role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const viewMenu = findMenu(template, 'View')

      expect(hasRole(viewMenu.submenu, 'togglefullscreen')).toBe(true)
    })
  })

  // ============================================================================
  // Window menu roles
  // ============================================================================

  describe('Window menu', () => {
    it('should include minimize role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const windowMenu = findMenu(template, 'Window')

      expect(hasRole(windowMenu.submenu, 'minimize')).toBe(true)
    })

    it('should include zoom role', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const windowMenu = findMenu(template, 'Window')

      expect(hasRole(windowMenu.submenu, 'zoom')).toBe(true)
    })
  })

  // ============================================================================
  // Return value
  // ============================================================================

  describe('Return value', () => {
    it('should return a Menu instance from buildFromTemplate', async () => {
      const menu = await importMenuWithPlatform('darwin')

      // Our mock returns an object with _template
      expect(menu).toBeDefined()
      expect(menu._template).toBeDefined()
      expect(Array.isArray(menu._template)).toBe(true)
    })
  })
})

/**
 * The View menu owns preview zoom (`d95aade4`): the accelerators are NOT
 * forwarded into the page, so the menu item's own click handler is the whole
 * route. The 2026-09-03 Windows verification could exercise Zoom Out and
 * Actual Size by hand but never Zoom In — no harness on that host could press
 * `CommandOrControl+Plus`, and `Alt` does not open the menu bar either
 * (`autoHideMenuBar: true`). These pin the step each item sends and the
 * fall-through, so the one item nobody could press is covered where it counts.
 */
describe('View menu zoom — what the item actually does', () => {
  async function loadMenu(focused: { getZoomLevel: () => number; setZoomLevel: (n: number) => void } | null) {
    vi.resetModules()
    Object.defineProperty(process, 'platform', { value: 'win32', writable: true, configurable: true })
    vi.doMock('electron', () => ({
      Menu: { buildFromTemplate: vi.fn((template) => ({ _template: template })) },
      app: { name: 'ERFANA' },
      BrowserWindow: {
        getFocusedWindow: () => (focused === null ? undefined : { webContents: focused })
      }
    }))
    const mod = await import('./menu')
    const menu = mod.createApplicationMenu() as unknown as { _template: Array<Record<string, unknown>> }
    const view = menu._template.find((m) => m.label === 'View') as { submenu: Array<Record<string, unknown>> }
    const item = (label: string): { click: () => void } =>
      view.submenu.find((i) => i.label === label) as unknown as { click: () => void }
    return { mod, item }
  }

  afterEach(() => {
    vi.resetModules()
  })

  it('Zoom In asks the focused preview for one step up, and stops there when it takes it', async () => {
    const setZoomLevel = vi.fn()
    const { mod, item } = await loadMenu({ getZoomLevel: () => 0, setZoomLevel })
    const preview = vi.fn(async () => true)
    mod.setPreviewZoomHandler(preview)

    item('Zoom In').click()
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith(1))

    // The page zoomed, so the host window must NOT zoom as well — that is the
    // "chrome stays the same size" half of the check.
    expect(setZoomLevel).not.toHaveBeenCalled()
    mod.setPreviewZoomHandler(null)
  })

  it('Zoom Out sends one step down and Actual Size sends zero', async () => {
    const { mod, item } = await loadMenu({ getZoomLevel: () => 0, setZoomLevel: vi.fn() })
    const preview = vi.fn(async () => true)
    mod.setPreviewZoomHandler(preview)

    item('Zoom Out').click()
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith(-1))
    item('Actual Size').click()
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith(0))
    mod.setPreviewZoomHandler(null)
  })

  it('falls through to the focused window when no preview takes the step', async () => {
    const setZoomLevel = vi.fn()
    const { mod, item } = await loadMenu({ getZoomLevel: () => 2, setZoomLevel })
    const preview = vi.fn(async () => false)
    mod.setPreviewZoomHandler(preview)

    item('Zoom In').click()
    await vi.waitFor(() => expect(setZoomLevel).toHaveBeenCalledWith(3))
    mod.setPreviewZoomHandler(null)
  })

  it('clamps the window fall-through to the zoom bounds, and Actual Size resets to 0', async () => {
    const setZoomLevel = vi.fn()
    const { mod, item } = await loadMenu({ getZoomLevel: () => 99, setZoomLevel })
    mod.setPreviewZoomHandler(null)

    item('Zoom In').click()
    await vi.waitFor(() => expect(setZoomLevel).toHaveBeenCalledWith(PREVIEW.MAX_ZOOM_LEVEL))
    item('Actual Size').click()
    await vi.waitFor(() => expect(setZoomLevel).toHaveBeenCalledWith(0))
  })
})

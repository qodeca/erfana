// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

    it('should include zoom controls', async () => {
      const menu = await importMenuWithPlatform('darwin')
      const template = getTemplate(menu)
      const viewMenu = findMenu(template, 'View')

      expect(hasRole(viewMenu.submenu, 'resetZoom')).toBe(true)
      expect(hasRole(viewMenu.submenu, 'zoomIn')).toBe(true)
      expect(hasRole(viewMenu.submenu, 'zoomOut')).toBe(true)
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

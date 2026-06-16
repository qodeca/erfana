// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test helper utilities for renderer tests.
 *
 * Provides portal-aware query helpers that search both component DOM
 * and React portal root (#portal-root) for dialogs, context menus, and toasts.
 *
 * @see constants/testids.ts - Test ID constants
 * @see Spec #011 - Automated UI testing compatibility
 *
 * @example Basic usage
 * ```typescript
 * import { queryByTestId, waitForPortalElement } from '@/utils/testHelpers';
 *
 * // Find element by testid across component and portal
 * const dialog = queryByTestId('dialog-overlay');
 *
 * // Wait for portal-rendered element
 * const menu = await waitForPortalElement('context-menu');
 * ```
 */

import { TEST_IDS, TestId, getDynamicTestId } from '../constants/testids'

/**
 * Portal root element ID used by React portals for dialogs, menus, and toasts.
 */
export const PORTAL_ROOT_ID = 'portal-root'

/**
 * Selector for data-testid attribute.
 */
const testIdSelector = (testId: string): string => `[data-testid="${testId}"]`

/**
 * Gets the portal root element if it exists in the document.
 *
 * @returns The portal root element or null if not found
 */
export function getPortalRoot(): HTMLElement | null {
  return document.getElementById(PORTAL_ROOT_ID)
}

/**
 * Queries for an element by data-testid across both component DOM and portal root.
 *
 * This helper searches:
 * 1. The regular document body
 * 2. The portal root (#portal-root) if it exists
 *
 * Use this for finding dialogs, context menus, toasts, and other portal-rendered elements.
 *
 * @param testId - The data-testid value to search for
 * @param container - Optional container to search within (defaults to document)
 * @returns The matching element or null if not found
 *
 * @example
 * ```typescript
 * // Find a dialog rendered in a portal
 * const dialog = queryByTestId('dialog-overlay');
 *
 * // Find with type assertion
 * const button = queryByTestId<HTMLButtonElement>('dialog-btn-confirm');
 * ```
 */
export function queryByTestId<T extends HTMLElement = HTMLElement>(
  testId: string,
  container: Document | HTMLElement = document
): T | null {
  const selector = testIdSelector(testId)

  // Try regular document query first
  const element = container.querySelector<T>(selector)
  if (element) return element

  // Try portal root if not found and we're searching the full document
  if (container === document) {
    const portalRoot = getPortalRoot()
    if (portalRoot) {
      return portalRoot.querySelector<T>(selector)
    }
  }

  return null
}

/**
 * Queries for all elements matching a data-testid across component DOM and portal root.
 *
 * @param testId - The data-testid value to search for
 * @param container - Optional container to search within (defaults to document)
 * @returns Array of matching elements (may be empty)
 *
 * @example
 * ```typescript
 * // Find all toast notifications
 * const toasts = queryAllByTestId('toast');
 * expect(toasts.length).toBe(2);
 * ```
 */
export function queryAllByTestId<T extends HTMLElement = HTMLElement>(
  testId: string,
  container: Document | HTMLElement = document
): T[] {
  const selector = testIdSelector(testId)
  const elements: T[] = []

  // Query regular document
  elements.push(...Array.from(container.querySelectorAll<T>(selector)))

  // Query portal root if searching full document
  if (container === document) {
    const portalRoot = getPortalRoot()
    if (portalRoot) {
      elements.push(...Array.from(portalRoot.querySelectorAll<T>(selector)))
    }
  }

  return elements
}

/**
 * Queries for an element using a TEST_IDS constant with type safety.
 *
 * @param testIdKey - A key from TEST_IDS constant object
 * @param container - Optional container to search within
 * @returns The matching element or null if not found
 *
 * @example
 * ```typescript
 * import { TEST_IDS } from '@/constants/testids';
 *
 * // Type-safe query using TEST_IDS constant
 * const activityBar = queryByTestIdConstant(TEST_IDS.ACTIVITY_BAR);
 * ```
 */
export function queryByTestIdConstant<T extends HTMLElement = HTMLElement>(
  testIdKey: TestId,
  container: Document | HTMLElement = document
): T | null {
  return queryByTestId<T>(testIdKey, container)
}

/**
 * Queries for a dynamic testid element (with path hash suffix).
 *
 * @param prefix - Base test ID prefix (e.g., TEST_IDS.PROJECT_TREE_NODE)
 * @param path - File path used to generate the hash suffix
 * @param container - Optional container to search within
 * @returns The matching element or null if not found
 *
 * @example
 * ```typescript
 * import { TEST_IDS } from '@/constants/testids';
 *
 * // Find a specific file node in the project tree
 * const node = queryByDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts');
 * ```
 */
export function queryByDynamicTestId<T extends HTMLElement = HTMLElement>(
  prefix: TestId,
  path: string,
  container: Document | HTMLElement = document
): T | null {
  const dynamicTestId = getDynamicTestId(prefix, path)
  return queryByTestId<T>(dynamicTestId, container)
}

/**
 * Options for waiting on portal elements.
 */
export interface WaitForPortalOptions {
  /** Maximum time to wait in milliseconds (default: 5000) */
  timeout?: number
  /** Interval between checks in milliseconds (default: 50) */
  interval?: number
  /** Container to search within (default: document) */
  container?: Document | HTMLElement
}

/**
 * Waits for a portal-rendered element to appear in the DOM.
 *
 * Useful for testing dialogs, context menus, and toasts that render
 * asynchronously via React portals.
 *
 * @param testId - The data-testid value to wait for
 * @param options - Configuration options for waiting
 * @returns Promise resolving to the element when found
 * @throws Error if element is not found within timeout
 *
 * @example
 * ```typescript
 * // Wait for confirm dialog to appear
 * const dialog = await waitForPortalElement('dialog-confirm');
 * expect(dialog).toBeInTheDocument();
 *
 * // With custom timeout
 * const menu = await waitForPortalElement('context-menu', { timeout: 2000 });
 * ```
 */
export async function waitForPortalElement<T extends HTMLElement = HTMLElement>(
  testId: string,
  options: WaitForPortalOptions = {}
): Promise<T> {
  const { timeout = 5000, interval = 50, container = document } = options

  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const check = (): void => {
      const element = queryByTestId<T>(testId, container)

      if (element) {
        resolve(element)
        return
      }

      if (Date.now() - startTime >= timeout) {
        reject(new Error(`Element with testid "${testId}" not found after ${timeout}ms`))
        return
      }

      setTimeout(check, interval)
    }

    check()
  })
}

/**
 * Waits for a portal-rendered element to be removed from the DOM.
 *
 * @param testId - The data-testid value to wait for removal
 * @param options - Configuration options for waiting
 * @returns Promise that resolves when element is removed
 * @throws Error if element still exists after timeout
 *
 * @example
 * ```typescript
 * // Wait for dialog to close
 * await waitForPortalElementRemoved('dialog-overlay');
 * ```
 */
export async function waitForPortalElementRemoved(
  testId: string,
  options: WaitForPortalOptions = {}
): Promise<void> {
  const { timeout = 5000, interval = 50, container = document } = options

  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const check = (): void => {
      const element = queryByTestId(testId, container)

      if (!element) {
        resolve()
        return
      }

      if (Date.now() - startTime >= timeout) {
        reject(new Error(`Element with testid "${testId}" still present after ${timeout}ms`))
        return
      }

      setTimeout(check, interval)
    }

    check()
  })
}

/**
 * Gets all data-testid values currently in the DOM (including portal root).
 *
 * Useful for debugging which testids are available during a test.
 *
 * @returns Array of all testid values found in the document
 *
 * @example
 * ```typescript
 * // Debug: log all available testids
 * console.log('Available testids:', getAllTestIds());
 * ```
 */
export function getAllTestIds(): string[] {
  const testIds: string[] = []

  // Collect from main document
  document.querySelectorAll('[data-testid]').forEach((el) => {
    const id = el.getAttribute('data-testid')
    if (id) testIds.push(id)
  })

  // Collect from portal root
  const portalRoot = getPortalRoot()
  if (portalRoot) {
    portalRoot.querySelectorAll('[data-testid]').forEach((el) => {
      const id = el.getAttribute('data-testid')
      if (id && !testIds.includes(id)) testIds.push(id)
    })
  }

  return testIds
}

/**
 * Checks if an element with the given testid exists in the DOM.
 *
 * @param testId - The data-testid value to check for
 * @returns True if element exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasTestId('dialog-overlay')) {
 *   // Dialog is open
 * }
 * ```
 */
export function hasTestId(testId: string): boolean {
  return queryByTestId(testId) !== null
}

/**
 * Creates a test utility object bound to a specific container.
 *
 * Useful when testing a specific component subtree.
 *
 * @param container - The container element to bind queries to
 * @returns Object with bound query methods
 *
 * @example
 * ```typescript
 * const { getByTestId } = createTestUtils(document.getElementById('my-component')!);
 * const button = getByTestId('my-button');
 * ```
 */
export function createTestUtils(container: HTMLElement) {
  return {
    queryByTestId: <T extends HTMLElement = HTMLElement>(testId: string) =>
      queryByTestId<T>(testId, container),

    queryAllByTestId: <T extends HTMLElement = HTMLElement>(testId: string) =>
      queryAllByTestId<T>(testId, container),

    getByTestId: <T extends HTMLElement = HTMLElement>(testId: string): T => {
      const element = queryByTestId<T>(testId, container)
      if (!element) {
        throw new Error(`Element with testid "${testId}" not found`)
      }
      return element
    },

    hasTestId: (testId: string) => queryByTestId(testId, container) !== null
  }
}

// Re-export TEST_IDS for convenience
export { TEST_IDS, type TestId, getDynamicTestId }

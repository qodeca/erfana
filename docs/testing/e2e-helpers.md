# E2E Test Helpers

Reusable test utilities and patterns for Playwright E2E tests.

> **Note**: As of #117, the preferred approach is to use POM classes via composed fixtures (see [E2E Testing Guide – POM architecture](./e2e-testing.md#page-object-model-pom-architecture)). The helpers below remain available as a backward-compatible adapter – they delegate to POM instances internally via WeakMap-based caching.

**Related documentation**:
- [E2E Testing Guide](./e2e-testing.md) – Main E2E documentation (includes POM architecture)
- [E2E Selectors](./e2e-selectors.md) – Complete testid catalog
- [Test helpers source](../../e2e/utils/helpers.ts) – Implementation (backward-compatible adapter)
- [POM classes](../../e2e/pages/) – Page Object Model implementations
- [Shared locators](../../e2e/utils/locators.ts) – `byTestId`, `byDynamicTestId`, `waitForTestId`, `waitForTestIdHidden`

---

## Importing testids

```typescript
import { TEST_IDS, getDynamicTestId, getPathHash } from '../src/renderer/src/constants/testids'

// Use in tests
await window.locator(`[data-testid="${TEST_IDS.ACTIVITY_BAR}"]`).click()

// For dynamic testids
const nodeTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts')
await window.locator(`[data-testid="${nodeTestId}"]`).click()
```

---

## Core helper functions

### Element queries

```typescript
import { Page, expect } from '@playwright/test'
import { TEST_IDS, getPathHash } from '../src/renderer/src/constants/testids'

/**
 * Get element by static testid
 */
export const byTestId = (window: Page, id: string) =>
  window.locator(`[data-testid="${id}"]`)

/**
 * Get element by dynamic testid (with path hash)
 */
export const byDynamicTestId = (window: Page, prefix: string, path: string) => {
  const hash = getPathHash(path)
  return window.locator(`[data-testid="${prefix}-${hash}"]`)
}

/**
 * Wait for element with testid to be visible
 */
export const waitForTestId = async (window: Page, id: string, timeout = 5000) => {
  await expect(byTestId(window, id)).toBeVisible({ timeout })
}
```

### Debugging helpers

```typescript
/**
 * Get all testids currently on page
 */
export const getAllTestIds = async (window: Page): Promise<string[]> => {
  return window.evaluate(() => {
    const elements = document.querySelectorAll('[data-testid]')
    return Array.from(elements)
      .map(el => el.getAttribute('data-testid'))
      .filter((id): id is string => id !== null)
  })
}

/**
 * Verify no duplicate static testids on page
 */
export const verifyUniqueTestIds = async (window: Page) => {
  const ids = await getAllTestIds(window)
  // Filter out dynamic testids (end with 8-char hex hash)
  const staticIds = ids.filter(id => !id.match(/-[a-f0-9]{8}$/))
  const unique = new Set(staticIds)
  expect(staticIds.length).toBe(unique.size)
}
```

### App lifecycle helpers

```typescript
/**
 * Wait for app to be fully ready (activity bar visible)
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await waitForTestId(page, TEST_IDS.ACTIVITY_BAR, { timeout: 10000 })
}
```

Two ways to open a project, both in `e2e/utils/helpers.ts`:

- `openProject(page, projectPath)` – reloads the page, then calls `window.api.file.openProjectByPath({ projectPath })` directly and waits for the first file node and the terminal button. No dialog is involved.
- `openProjectViaUI(electronApp, page, projectPath)` – stubs the native picker with `stubDialog(electronApp, 'showOpenDialog', …)`, then clicks `TEST_IDS.PROJECT_TREE_BTN_OPEN`, so the real open-project flow runs without a system file picker.

### Editor helpers

The `monaco` helper object provides reliable Monaco editor interactions:

```typescript
import { monaco } from './utils/helpers'

// Wait for Monaco to be fully initialized (uses Playwright auto-retry)
await monaco.waitForReady(page)

// Focus editor (handles overlapping layers, retries until Monaco reports focus)
await monaco.focus(page)

// Set content (clears existing, inserts new as one input event)
await monaco.setContent(page, '# Hello World')

// Get content from the Monaco model (e2e test hook)
const content = await monaco.getContent(page)

// Get Monaco's internal textarea locator (for advanced use)
const textarea = monaco.getTextArea(page)

// Wait for the cursor in a focused editor (focus verification)
await monaco.waitForCursor(page)

// Search operations
await monaco.openSearch(page)
await monaco.search(page, 'query')
await monaco.nextMatch(page)
await monaco.prevMatch(page)
await monaco.closeSearch(page)

// Command palette
await monaco.executeCommand(page, 'Format Document')
```

**Key methods**:

| Method | Description |
|--------|-------------|
| `waitForReady(page)` | Waits for the `editor-monaco` testid to be visible and Monaco's internal textarea to be attached |
| `focus(page)` | Clicks with `force: true` until the editor carries Monaco's `focused` class (the blinking cursor is not a stable signal) |
| `getTextArea(page)` | Returns Monaco's internal textarea locator |
| `waitForCursor(page)` | Waits for the cursor to be attached in a focused editor (`.monaco-editor.focused .cursor`) – attached, not visible, because it blinks |
| `setContent(content)` | Selects all, then inserts the new content with `keyboard.insertText` — never `keyboard.type`, which Monaco drops characters from during re-layout (#129) |
| `getContent(page)` | Reads the whole document from the Monaco model through the e2e test hook (`window.__erfanaTest.editorValue`) – no focus, selection or clipboard involved. Throws while no editor has mounted, so poll it when the content is still changing. For what is on screen use `MonacoPage.visibleText()`; it is on the POM class only, not on this adapter |

### Terminal helpers

There is no `waitForTerminal()` / `sendTerminalInput()` pair. `e2e/utils/helpers.ts` exports a `terminal` object whose methods take the `page` and delegate to `TerminalPage` (`e2e/pages/terminal.page.ts`), so the two styles are interchangeable:

```typescript
import { terminal } from '../utils/helpers'

await terminal.open(page)                 // opens the panel, then waitForPrompt()
await terminal.sendCommand(page, 'echo test')
await terminal.waitForOutput(page, 'test')
```

`terminal.*` methods (each takes `page` first): `getTerminal`, `open`, `close`, `focus`, `sendCommand(command, pressEnter = true)`, `waitForOutput(text, { timeout })`, `interrupt`, `clear`, `scrollToBottom`, `restart`, `toggleScrollLock`, `waitForReady`, `waitForPrompt({ timeout })`. `waitForPrompt()` is the readiness wait: it polls for the xterm textarea, then reads the screen until a prompt is drawn and stable (up to `PROMPT_TIMEOUT_MS`, 30 s; no fixed sleep) – see [e2e-troubleshooting.md § Terminal commands not executing](./e2e-troubleshooting.md#terminal-commands-not-executing).

### Settings helpers

```typescript
/**
 * Open settings overlay
 */
export const openSettings = async (window: Page) => {
  await byTestId(window, TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).click()
  await waitForTestId(window, TEST_IDS.SETTINGS_OVERLAY)
}

/**
 * Close settings overlay
 */
export const closeSettings = async (window: Page) => {
  await window.keyboard.press('Escape')
  await expect(byTestId(window, TEST_IDS.SETTINGS_OVERLAY)).not.toBeVisible()
}
```

---

## Portal-aware queries

Dialogs, context menus, and toasts render in React portals (outside main component tree). Query them globally:

```typescript
// These render in portals - query from document root
const dialog = window.locator('[data-testid="dialog-overlay"]')
const contextMenu = window.locator('[data-testid="context-menu"]')
const toast = window.locator('[data-testid="toast-container"]')
```

**Toasts need `e2e/utils/toast.ts`, not a bare `toast` testid.**
`ToastNotification` suffixes each toast's testid with its type
(`toast-success`, `toast-error`, `toast-info`, `toast-warning`), so
`[data-testid="toast"]` matches nothing at all. The container id above is real;
the individual toasts are not addressable without the suffix. Use the helpers:

```typescript
import { anyToast, toastOfType, toastWithText } from '../utils/toast'

await expect(toastWithText(window, 'already exists')).toBeVisible()
await expect(toastOfType(window, 'error')).toHaveCount(1)
```

`e2e/utils/image-export-helpers.ts` carries an older, narrower `ANY_TOAST`
covering success and error only; new specs should use `utils/toast.ts`.

**Why portals matter**:

Portal elements render at the document root level, not within their parent component's DOM subtree. This means:

1. `locator('[data-testid="dialog-overlay"]')` works (queries entire document)
2. `parentElement.locator('[data-testid="dialog-overlay"]')` may fail (dialog is not a child)

---

## Testing dialogs

```typescript
test('confirm dialog', async ({ window }) => {
  // Trigger action that shows confirm dialog
  // (e.g., closing unsaved file)

  // Dialog appears in portal
  const dialog = window.locator('[data-testid="dialog-confirm"]')
  await expect(dialog).toBeVisible()

  // Check message
  const message = window.locator('[data-testid="dialog-confirm-message"]')
  await expect(message).toContainText('unsaved changes')

  // Click cancel
  await window.locator('[data-testid="dialog-btn-cancel"]').click()
  await expect(dialog).not.toBeVisible()
})
```

---

## Testing context menus

```typescript
test('editor context menu', async ({ window }) => {
  const editor = window.locator('[data-testid="editor-monaco"]')

  // Select some text
  await editor.click()
  await window.keyboard.type('Hello World')

  // Platform-aware modifier key
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await window.keyboard.press(`${modKey}+A`)  // Select all

  // Right-click to show context menu
  await editor.click({ button: 'right' })

  // Context menu appears
  const menu = window.locator('[data-testid="context-menu-editor"]')
  await expect(menu).toBeVisible()

  // Click explain action
  await window.locator('[data-testid="context-menu-item-explain"]').click()

  // Menu should dismiss
  await expect(menu).not.toBeVisible()
})
```

---

## Dialog handling pattern

The `closeApp()` helper handles quit confirmation dialogs:

```typescript
export async function closeApp(
  electronApp: ElectronApplication,
  page?: Page
): Promise<void> {
  if (!page) {
    await electronApp.close()
    return
  }

  // Trigger quit via window.close() - this goes through the app's quit handler
  try {
    await page.evaluate(() => window.close())
  } catch {
    // Page might already be closing
  }

  // Handle quit confirmation dialog(s) with retry loop
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const confirmBtn = byTestId(page, TEST_IDS.DIALOG_BTN_CONFIRM)
      await expect(confirmBtn).toBeVisible({ timeout: 1500 })
      // Hold the clicked element: a next dialog reuses the same test id
      const clicked = await confirmBtn.elementHandle()
      await confirmBtn.click()

      // Wait for this dialog to go before looking for the next one
      await clicked?.waitForElementState('hidden', { timeout: 1500 }).catch(() => undefined)
      continue
    } catch {
      // No dialog visible - done
      break
    }
  }

  // Fallback close
  try {
    await electronApp.close()
  } catch {
    // Already closed
  }
}
```

**Key elements**:
1. **Trigger via `window.close()`** - exercises the real quit flow
2. **Retry loop** - handles multiple dialogs; it waits for the clicked dialog to hide (`waitForElementState('hidden')`) rather than sleeping
3. **Try-catch everywhere** - page invalidation is expected, not an error
4. **Fallback close** - ensures cleanup even if dialog handling fails

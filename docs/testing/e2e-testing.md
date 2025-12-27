# E2E Testing with Playwright

## Overview

Erfana supports automated E2E testing using Playwright with Electron. This guide covers setup, testing patterns for third-party components, and the complete selector catalog.

**Related documentation**:
- [BRS-011: Automated UI testing compatibility](../../specs/business-reqs/brs011-ui-test-compatibility/)
- [Test ID constants](../../src/renderer/src/constants/testids.ts)
- [Testing overview](./README.md)

---

## Prerequisites

- Node.js 18+
- Playwright installed: `npm install --save-dev @playwright/test`

---

## Quick start

### Running tests

```bash
# Run E2E tests (requires dev server running)
npm run dev &  # Start dev server in background
npm run test:e2e

# Run with visible window
npm run test:e2e:headed
```

### Test build vs production build

Erfana uses Electron fuses for security hardening. For E2E testing with debugging:

```bash
# Production build (inspector disabled - secure)
npm run build:mac

# Test build (inspector enabled - for Playwright debugging)
ERFANA_TEST_BUILD=true npm run build:mac
```

> **Security note**: Test builds have reduced security (inspector enabled). Only use for testing, never distribute.

**Why two build types?**

| Build Type | `--inspect` Flag | Use Case |
|------------|------------------|----------|
| Production | Disabled (fuse) | Distribution to users |
| Test | Enabled | Playwright debugging, E2E tests |

The `EnableNodeCliInspectArguments` fuse disables the `--inspect` flag in production builds for security. Test builds skip this fuse to allow Playwright to attach to the renderer process.

---

## Playwright configuration

Create `playwright.config.ts` in the project root:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts',
    },
  ],
})
```

### Configuration options explained

| Option | Value | Rationale |
|--------|-------|-----------|
| `testDir` | `./e2e` | Separate E2E tests from unit tests |
| `timeout` | `60000` | Electron apps need longer startup time |
| `retries` | `1` | Retry flaky tests once |
| `trace` | `on-first-retry` | Capture trace on failures for debugging |

---

## Test structure

### Basic test template

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

test.describe('Erfana E2E', () => {
  test('should launch app and show activity bar', async () => {
    // Launch Electron app
    const app = await electron.launch({
      args: [path.join(__dirname, '..')],
    })

    // Get the first window
    const window = await app.firstWindow()

    // Wait for app to be ready
    await window.waitForLoadState('domcontentloaded')

    // Test: Activity bar should be visible
    const activityBar = window.locator('[data-testid="activity-bar"]')
    await expect(activityBar).toBeVisible()

    // Cleanup
    await app.close()
  })
})
```

### Test with project loaded

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

test('should open project and display files', async () => {
  const app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      // Pass project path as argument
      '/path/to/test/project',
    ],
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Wait for project tree to populate
  const projectTree = window.locator('[data-testid="project-tree"]')
  await expect(projectTree).toBeVisible()

  // Verify files are shown (not empty state)
  const emptyState = window.locator('[data-testid="project-tree-empty"]')
  await expect(emptyState).not.toBeVisible()

  await app.close()
})
```

### Test fixture pattern

For reusable app setup, create a fixture:

```typescript
// e2e/fixtures.ts
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

type TestFixtures = {
  app: ElectronApplication
  window: Page
}

export const test = base.extend<TestFixtures>({
  app: async ({}, use) => {
    const app = await electron.launch({
      args: [path.join(__dirname, '..')],
    })
    await use(app)
    await app.close()
  },

  window: async ({ app }, use) => {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  },
})

export { expect } from '@playwright/test'
```

Usage:

```typescript
// e2e/activity-bar.e2e.ts
import { test, expect } from './fixtures'

test('activity bar buttons work', async ({ window }) => {
  // Click files button
  await window.locator('[data-testid="activity-bar-btn-files"]').click()

  // Verify project tree is visible
  const projectTree = window.locator('[data-testid="project-tree"]')
  await expect(projectTree).toBeVisible()
})
```

---

## Testing third-party components

### Monaco Editor

Monaco's internal DOM is not accessible for direct testid injection. Use wrapper-based testing:

```typescript
// DO: Query the wrapper
const editor = window.locator('[data-testid="editor-monaco"]')
await expect(editor).toBeVisible()

// DO: Use Monaco's keyboard commands
await editor.click()
await window.keyboard.type('# Hello World')

// DO: Use Monaco's command palette
await window.keyboard.press('F1')
await window.keyboard.type('Format Document')
await window.keyboard.press('Enter')

// DON'T: Try to access Monaco's internal elements
// window.locator('.monaco-editor .view-line') // Fragile!
```

**Monaco testing patterns**:

| Action | Method |
|--------|--------|
| Set content | `keyboard.type()` after clicking editor |
| Select all | `Cmd/Ctrl+A` |
| Copy | `Cmd/Ctrl+C` |
| Paste | `Cmd/Ctrl+V` |
| Undo | `Cmd/Ctrl+Z` |
| Find | `Cmd/Ctrl+F` (uses Erfana's SearchBar) |
| Format | `F1` then "Format Document" |
| Go to line | `Cmd/Ctrl+G` |

**Example: Setting editor content**

```typescript
test('set editor content', async ({ window }) => {
  const editor = window.locator('[data-testid="editor-monaco"]')
  await editor.click()

  // Clear existing content (platform-aware)
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await window.keyboard.press(`${modKey}+A`)

  // Type new content
  await window.keyboard.type('# New Document\n\nHello, world!')

  // Verify via preview (if in split mode)
  const preview = window.locator('[data-testid="editor-preview"]')
  await expect(preview).toContainText('New Document')
})
```

**Example: Using search**

```typescript
test('search in editor', async ({ window }) => {
  const editor = window.locator('[data-testid="editor-monaco"]')
  await editor.click()

  // Open Erfana's search bar (overrides Monaco's native find)
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await window.keyboard.press(`${modKey}+F`)

  // Search bar should appear
  const searchBar = window.locator('[data-testid="search-bar"]')
  await expect(searchBar).toBeVisible()

  // Type search query
  const searchInput = window.locator('[data-testid="search-bar-input"]')
  await searchInput.fill('hello')

  // Check match count
  const matchCount = window.locator('[data-testid="search-bar-count"]')
  await expect(matchCount).toContainText(/\d+ of \d+/)
})
```

### xterm.js Terminal

Terminal internals are not accessible. Use the wrapper and keyboard input:

```typescript
// Query terminal wrapper
const terminal = window.locator('[data-testid="terminal-instance"]')
await expect(terminal).toBeVisible()

// Send input via keyboard
await terminal.click()
await window.keyboard.type('echo "Hello"')
await window.keyboard.press('Enter')

// Wait for output (check visible text)
await expect(terminal).toContainText('Hello')

// Use terminal control buttons
await window.locator('[data-testid="terminal-btn-scroll"]').click()
await window.locator('[data-testid="terminal-btn-restart"]').click()
```

**Terminal testing patterns**:

| Action | Method |
|--------|--------|
| Send command | Click terminal + `keyboard.type()` + `Enter` |
| Wait for output | `expect(terminal).toContainText()` |
| Scroll to bottom | Click `terminal-btn-scroll` |
| Restart | Click `terminal-btn-restart` |
| Copy | `Cmd/Ctrl+C` (when text selected) |
| Paste | `Cmd/Ctrl+V` |
| Clear | Type `clear` + Enter |
| Interrupt | `Ctrl+C` (send SIGINT) |

**Example: Run command and verify output**

```typescript
test('run terminal command', async ({ window }) => {
  // Open terminal panel
  await window.locator('[data-testid="activity-bar-btn-terminal"]').click()

  const terminal = window.locator('[data-testid="terminal-instance"]')
  await expect(terminal).toBeVisible()

  // Wait for terminal to initialize (prompt appears)
  await window.waitForTimeout(1000)

  // Send command
  await terminal.click()
  await window.keyboard.type('pwd')
  await window.keyboard.press('Enter')

  // Wait for output
  await expect(terminal).toContainText('/')
})
```

**Example: Test terminal restart**

```typescript
test('restart terminal', async ({ window }) => {
  await window.locator('[data-testid="activity-bar-btn-terminal"]').click()

  const terminal = window.locator('[data-testid="terminal-instance"]')
  const restartBtn = window.locator('[data-testid="terminal-btn-restart"]')

  // Click restart
  await restartBtn.click()

  // Terminal should reinitialize
  await expect(terminal).toBeVisible()
})
```

### Mermaid diagrams

Mermaid renders SVG inside a wrapper. Test via wrapper and toolbar:

```typescript
// Query Mermaid toolbar (appears when hovering diagram)
const toolbar = window.locator('[data-testid="mermaid-toolbar"]')
await expect(toolbar).toBeVisible()

// Change diagram direction
await window.locator('[data-testid="mermaid-direction-btn-LR"]').click()

// Expand to fullscreen
await window.locator('[data-testid="mermaid-btn-expand"]').click()

// In fullscreen viewer
const viewer = window.locator('[data-testid="diagram-viewer"]')
await expect(viewer).toBeVisible()

// Zoom controls
await window.locator('[data-testid="chat-btn-zoom-in"]').click()
await window.locator('[data-testid="chat-btn-zoom-out"]').click()
await window.locator('[data-testid="chat-btn-fit"]').click()
await window.locator('[data-testid="chat-btn-reset"]').click()

// Close viewer
await window.locator('[data-testid="diagram-viewer-btn-close"]').click()
```

**Mermaid testing patterns**:

| Action | Method |
|--------|--------|
| Hover to show toolbar | `locator.hover()` on diagram container |
| Change direction | Click `mermaid-direction-btn-{TB/BT/LR/RL}` |
| Open fullscreen | Click `mermaid-btn-expand` |
| Zoom in/out | Click `chat-btn-zoom-in` / `chat-btn-zoom-out` |
| Fit to screen | Click `chat-btn-fit` |
| Reset zoom | Click `chat-btn-reset` |
| Close viewer | Click `diagram-viewer-btn-close` |

**Example: Test diagram viewer**

```typescript
test('mermaid diagram viewer', async ({ window }) => {
  // Assuming a file with Mermaid diagram is open
  const preview = window.locator('[data-testid="editor-preview"]')
  await expect(preview).toBeVisible()

  // Hover over diagram to show toolbar
  const diagramContainer = preview.locator('.mermaid').first()
  await diagramContainer.hover()

  // Toolbar should appear
  const toolbar = window.locator('[data-testid="mermaid-toolbar"]')
  await expect(toolbar).toBeVisible()

  // Click expand
  await window.locator('[data-testid="mermaid-btn-expand"]').click()

  // Viewer should open
  const viewer = window.locator('[data-testid="diagram-viewer"]')
  await expect(viewer).toBeVisible()

  // Close viewer with Escape
  await window.keyboard.press('Escape')
  await expect(viewer).not.toBeVisible()
})
```

---

## Complete selector catalog

### Activity bar (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `activity-bar` | Container | static |
| `activity-bar-btn-files` | Files panel button | static |
| `activity-bar-btn-terminal` | Terminal panel button | static |
| `activity-bar-btn-settings` | Settings button | static |
| `activity-bar-btn-theme` | Theme toggle | static |

### Project tree (8 testids)

| Testid | Element | Type |
|--------|---------|------|
| `project-tree` | Container | static |
| `project-tree-empty` | Empty state | static |
| `project-tree-btn-open` | Open folder button | static |
| `project-tree-btn-close` | Close project button | static |
| `project-tree-btn-new-file` | New file button | static |
| `project-tree-btn-new-folder` | New folder button | static |
| `project-tree-node-{hash}` | Tree node | dynamic |
| `project-tree-toggle-{hash}` | Folder toggle | dynamic |

**Dynamic testid example**:
```typescript
import { getDynamicTestId, TEST_IDS } from '@/constants/testids'

// For file 'src/main/index.ts'
const testId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts')
// Result: 'project-tree-node-a1b2c3d4' (hash varies by path)
```

### Git status bar (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `git-status-bar` | Container | static |
| `git-branch-name` | Branch name | static |
| `git-status-counts` | Status counts | static |
| `git-sync-indicator` | Sync indicator | static |

### Terminal panel (6 testids)

| Testid | Element | Type |
|--------|---------|------|
| `terminal-panel` | Container | static |
| `terminal-instance` | xterm.js wrapper | static |
| `terminal-btn-scroll` | Scroll to bottom | static |
| `terminal-btn-restart` | Restart terminal | static |
| `terminal-btn-lock` | Scroll lock toggle | static |
| `terminal-status` | Status indicator | static |

### Editor (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `editor-content` | Content layout container | static |
| `editor-pane` | Editor pane wrapper | static |
| `preview-pane` | Preview pane wrapper | static |
| `editor-monaco` | Monaco editor wrapper | static |
| `editor-preview` | Markdown preview wrapper | static |

### Markdown toolbar (20 testids)

| Testid | Element | Type |
|--------|---------|------|
| `markdown-toolbar` | Container | static |
| `toolbar-btn-bold` | Bold button | static |
| `toolbar-btn-italic` | Italic button | static |
| `toolbar-btn-strikethrough` | Strikethrough button | static |
| `toolbar-btn-code` | Code button | static |
| `toolbar-btn-link` | Link button | static |
| `toolbar-btn-image` | Image button | static |
| `toolbar-btn-heading` | Heading button | static |
| `toolbar-btn-list` | Bullet list button | static |
| `toolbar-btn-list-ordered` | Numbered list button | static |
| `toolbar-btn-search` | Search button | static |
| `view-mode-btn-editor` | Editor only mode | static |
| `view-mode-btn-split` | Vertical split mode | static |
| `view-mode-btn-split-horizontal` | Horizontal split mode | static |
| `view-mode-btn-preview` | Preview only mode | static |
| `toolbar-btn-export-pdf` | Export PDF button | static |
| `toolbar-btn-export-docx` | Export DOCX button | static |
| `modified-indicator` | Unsaved changes indicator | static |
| `autosave-indicator` | Autosave indicator | static |
| `reload-indicator` | External changes indicator | static |

### Dialogs - Base (3 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-overlay` | Backdrop overlay | static |
| `dialog-container` | Dialog box | static |
| `dialog-title` | Dialog title | static |

### Dialogs - Confirm (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-confirm` | Confirm dialog | static |
| `dialog-confirm-message` | Confirm message | static |
| `dialog-btn-confirm` | Confirm button | static |
| `dialog-btn-cancel` | Cancel button | static |

### Dialogs - Alert (3 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-alert` | Alert dialog | static |
| `dialog-alert-message` | Alert message | static |
| `dialog-btn-ok` | OK button | static |

### Dialogs - Prompt (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `dialog-prompt` | Prompt dialog | static |
| `dialog-prompt-message` | Prompt message | static |
| `dialog-prompt-input` | Prompt input | static |
| `dialog-prompt-dropdown` | Prompt dropdown | static |

### File picker (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `file-picker` | File picker dialog | static |
| `file-picker-list` | File list | static |
| `file-picker-item-{hash}` | File item | dynamic |
| `file-picker-btn-select` | Select button | static |
| `file-picker-btn-cancel` | Cancel button | static |

### Context menus (12 testids)

| Testid | Element | Type |
|--------|---------|------|
| `context-menu` | Base menu container | static |
| `context-menu-separator` | Menu separator | static |
| `context-menu-terminal` | Terminal menu | static |
| `context-menu-editor` | Editor menu | static |
| `context-menu-preview` | Preview menu | static |
| `context-menu-item-copy` | Copy item | static |
| `context-menu-item-paste` | Paste item | static |
| `context-menu-item-cut` | Cut item | static |
| `context-menu-item-elaborate` | Elaborate prompt | static |
| `context-menu-item-modify` | Modify prompt | static |
| `context-menu-item-ask` | Ask prompt | static |
| `context-menu-item-visualize` | Visualize prompt | static |

### Diagram viewer (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `diagram-viewer` | Fullscreen overlay | static |
| `diagram-viewer-btn-close` | Close button | static |
| `diagram-viewer-content` | Content wrapper | static |
| `diagram-viewer-svg` | SVG container | static |
| `diagram-viewer-btn-chat` | Chat trigger | static |

### Chat bubble (15 testids)

| Testid | Element | Type |
|--------|---------|------|
| `chat-bubble` | Container | static |
| `chat-bubble-btn-open` | FAB open button | static |
| `chat-panel` | Chat panel | static |
| `chat-textarea` | Input textarea | static |
| `chat-btn-send` | Send button | static |
| `chat-btn-zoom-in` | Zoom in | static |
| `chat-btn-zoom-out` | Zoom out | static |
| `chat-btn-fit` | Fit to view | static |
| `chat-btn-reset` | Reset zoom | static |
| `chat-direction-btn-{dir}` | Direction (TB/BT/LR/RL) | dynamic |
| `chat-btn-scroll-bottom` | Scroll to bottom | static |
| `chat-btn-restart` | Restart terminal | static |
| `chat-btn-scroll-lock` | Scroll lock | static |
| `chat-zoom-indicator` | Zoom level display | static |
| `chat-character-count` | Character counter | static |

### Mermaid toolbar (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `mermaid-toolbar` | Container | static |
| `mermaid-directions-group` | Direction buttons group | static |
| `mermaid-direction-btn-{dir}` | Direction (TB/BT/LR/RL) | dynamic |
| `mermaid-btn-expand` | Expand to fullscreen | static |

### Tabs (5 testids)

| Testid | Element | Type |
|--------|---------|------|
| `tab-bar` | Tab bar container | static |
| `tab-item-{hash}` | Tab item | dynamic |
| `tab-label-{hash}` | Tab label | dynamic |
| `tab-close-{hash}` | Tab close button | dynamic |
| `tab-dirty-{hash}` | Unsaved indicator | dynamic |

### Search bar (8 testids)

| Testid | Element | Type |
|--------|---------|------|
| `search-bar` | Container | static |
| `search-bar-input` | Search input | static |
| `search-bar-toggle-case` | Case sensitive toggle | static |
| `search-bar-toggle-word` | Whole word toggle | static |
| `search-bar-btn-prev` | Previous match | static |
| `search-bar-btn-next` | Next match | static |
| `search-bar-btn-close` | Close search | static |
| `search-bar-count` | Match count display | static |

### Toast notifications (4 testids)

| Testid | Element | Type |
|--------|---------|------|
| `toast-container` | Toast container | static |
| `toast-{type}` | Toast by type (success/error/warning/info) | dynamic |
| `toast-message` | Toast message | static |
| `toast-btn-dismiss` | Dismiss button | static |

### Settings overlay (10 testids)

| Testid | Element | Type |
|--------|---------|------|
| `settings-overlay` | Overlay container | static |
| `settings-container` | Inner container | static |
| `settings-btn-close` | Close button | static |
| `settings-section-editor` | Editor settings section | static |
| `settings-section-git` | Git settings section | static |
| `settings-section-logging` | Logging section | static |
| `settings-toggle-line-breaks` | Line breaks toggle | static |
| `settings-toggle-polling` | Git polling toggle | static |
| `settings-select-polling-interval` | Polling interval select | static |
| `settings-select-log-level` | Log level select | static |

### Document stats bar (6 testids)

| Testid | Element | Type |
|--------|---------|------|
| `document-stats-bar` | Container | static |
| `stats-words` | Word count | static |
| `stats-characters` | Character count | static |
| `stats-lines` | Line count | static |
| `stats-reading-time` | Reading time | static |
| `stats-selection` | Selection stats | static |

---

## Test helper utilities

### Importing testids in tests

```typescript
import { TEST_IDS, getDynamicTestId, getPathHash } from '../src/renderer/src/constants/testids'

// Use in tests
await window.locator(`[data-testid="${TEST_IDS.ACTIVITY_BAR}"]`).click()

// For dynamic testids
const nodeTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts')
await window.locator(`[data-testid="${nodeTestId}"]`).click()
```

### Helper functions

Create `e2e/helpers.ts`:

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

/**
 * Wait for app to be fully ready (activity bar visible)
 */
export const waitForAppReady = async (window: Page) => {
  await window.waitForLoadState('domcontentloaded')
  await waitForTestId(window, TEST_IDS.ACTIVITY_BAR)
}

/**
 * Open project via IPC (requires project path)
 */
export const openProject = async (window: Page, projectPath: string) => {
  // Click files button to show project tree
  await byTestId(window, TEST_IDS.ACTIVITY_BAR_BTN_FILES).click()

  // Use the open project button
  await byTestId(window, TEST_IDS.PROJECT_TREE_BTN_OPEN).click()

  // Note: This triggers system file picker - for automation,
  // pass project path as CLI argument instead
}

/**
 * Set Monaco editor content via keyboard
 */
export const setEditorContent = async (window: Page, content: string) => {
  const editor = byTestId(window, TEST_IDS.EDITOR_MONACO)
  await editor.click()

  // Platform-aware modifier key
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await window.keyboard.press(`${modKey}+A`)  // Select all
  await window.keyboard.type(content)
}

/**
 * Get visible text from Monaco editor
 */
export const getEditorContent = async (window: Page): Promise<string> => {
  const editor = byTestId(window, TEST_IDS.EDITOR_MONACO)
  await editor.click()

  // Platform-aware modifier key
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await window.keyboard.press(`${modKey}+A`)  // Select all
  await window.keyboard.press(`${modKey}+C`)  // Copy

  // Read from clipboard
  return window.evaluate(() => navigator.clipboard.readText())
}

/**
 * Wait for terminal to be ready
 */
export const waitForTerminal = async (window: Page) => {
  await waitForTestId(window, TEST_IDS.TERMINAL_INSTANCE)
  // Give terminal time to initialize PTY
  await window.waitForTimeout(1000)
}

/**
 * Send input to terminal
 */
export const sendTerminalInput = async (window: Page, input: string) => {
  const terminal = byTestId(window, TEST_IDS.TERMINAL_INSTANCE)
  await terminal.click()
  await window.keyboard.type(input)
  await window.keyboard.press('Enter')
}

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

### Portal-aware queries

Dialogs, context menus, and toasts render in React portals (outside main component tree). Query them globally:

```typescript
// These render in portals - query from document root
const dialog = window.locator('[data-testid="dialog-overlay"]')
const contextMenu = window.locator('[data-testid="context-menu"]')
const toast = window.locator('[data-testid="toast-container"]')
```

**Why portals matter**:

Portal elements render at the document root level, not within their parent component's DOM subtree. This means:

1. `locator('[data-testid="dialog-overlay"]')` works (queries entire document)
2. `parentElement.locator('[data-testid="dialog-overlay"]')` may fail (dialog is not a child)

### Testing dialogs

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

### Testing context menus

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

  // Click elaborate action
  await window.locator('[data-testid="context-menu-item-elaborate"]').click()

  // Menu should dismiss
  await expect(menu).not.toBeVisible()
})
```

---

## Debugging and development

### Playwright Inspector

Debug tests step-by-step with the Playwright Inspector:

```bash
# Run tests with inspector
PWDEBUG=1 npm run test:e2e

# Or set environment variable
export PWDEBUG=1
npm run test:e2e
```

**Inspector features**:
- Step through test execution line by line
- Pause test and inspect DOM state
- Pick locator by clicking elements
- Explore page console logs
- View screenshots at each step

**Keyboard shortcuts** (in Inspector):
- `F10` - Step over
- `F11` - Step into
- `Shift+F11` - Step out
- `F5` - Resume
- `F8` - Pause

### Viewing traces

Traces are automatically captured on test failures (configured in `playwright.config.ts`):

```typescript
export default defineConfig({
  use: {
    trace: 'on-first-retry',  // Capture trace on retry
  },
})
```

**View traces after test run**:

```bash
# Run tests (traces saved on failure)
npm run test:e2e

# Open trace viewer
npx playwright show-trace trace.zip

# Or specify path
npx playwright show-trace test-results/.../trace.zip
```

**Trace viewer features**:
- Timeline of all actions
- DOM snapshot at each step
- Network requests
- Console logs
- Screenshots and videos
- Source code highlighting

**Trace options**:
- `'on'` - Always capture traces (slow, large files)
- `'on-first-retry'` - Capture on retry (recommended)
- `'off'` - Never capture traces
- `'retain-on-failure'` - Keep only failed test traces

### Headed mode for visual debugging

Run tests with visible browser window:

```bash
npm run test:e2e:headed

# Or with Playwright CLI
npx playwright test --headed
```

**Use headed mode when**:
- Debugging visual issues
- Verifying animations and transitions
- Understanding test failures
- Developing new tests

### CI/CD integration

#### GitHub Actions example

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]

jobs:
  test-e2e:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Build Electron app
        run: npm run build

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload trace on failure
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-traces-${{ matrix.os }}
          path: test-results/**/trace.zip
          retention-days: 7

      - name: Upload screenshots on failure
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-screenshots-${{ matrix.os }}
          path: test-results/**/*.png
          retention-days: 7
```

**CI best practices**:
- Run on multiple OS (macOS, Windows, Linux) for cross-platform validation
- Upload traces and screenshots as artifacts on failure
- Use `npm ci` instead of `npm install` for consistent dependencies
- Cache `node_modules` to speed up builds
- Set reasonable timeouts (E2E tests may be slower in CI)

#### Parallel test execution in CI

```yaml
# Run tests in parallel across multiple workers
- name: Run E2E tests
  run: npm run test:e2e -- --workers=4
```

**Worker recommendations**:
- Local: `--workers=2` (don't overload development machine)
- CI: `--workers=4` to `--workers=8` (depends on runner specs)
- GitHub Actions runners: 2-core machines, use `--workers=2`

#### Test sharding for large test suites

```yaml
# Split tests across multiple CI jobs
jobs:
  test-e2e:
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - name: Run E2E tests (shard ${{ matrix.shard }})
        run: npm run test:e2e -- --shard=${{ matrix.shard }}/4
```

---

## Troubleshooting

### Tests timeout on launch

Ensure dev server is running:

```bash
npm run dev &
sleep 5
npm run test:e2e
```

Or increase timeout in `playwright.config.ts`:

```typescript
export default defineConfig({
  timeout: 120000,  // 2 minutes
})
```

### Cannot attach debugger

Use test build for debugging:

```bash
ERFANA_TEST_BUILD=true npm run build:mac
```

This enables the `--inspect` flag which is disabled in production builds.

### Element not found

1. **Check if element is in a portal** (dialog, menu, toast) - use global query
2. **Use `waitForLoadState('domcontentloaded')`** before querying
3. **Verify testid exists** using `getAllTestIds()` helper
4. **Check element visibility** - element may exist but be hidden

```typescript
// Debug: List all testids on page
const allIds = await getAllTestIds(window)
console.log('Available testids:', allIds)

// Debug: Check if element exists but hidden
const element = window.locator('[data-testid="my-element"]')
const count = await element.count()
console.log('Element count:', count)
const visible = await element.isVisible()
console.log('Element visible:', visible)
```

### Monaco editor not responding to keyboard

Monaco needs focus before keyboard input:

```typescript
// Always click to focus first
await window.locator('[data-testid="editor-monaco"]').click()
await window.waitForTimeout(100)  // Brief delay for focus
await window.keyboard.type('Hello')
```

### Terminal commands not executing

Terminal PTY needs time to initialize:

```typescript
// Wait for terminal ready
await waitForTestId(window, TEST_IDS.TERMINAL_INSTANCE)
await window.waitForTimeout(1000)  // PTY initialization

// Now send command
await sendTerminalInput(window, 'echo test')
```

### Dynamic testids not matching

Verify the path used for hash matches exactly:

```typescript
// The path must match EXACTLY what the component uses
const correctTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts')
const wrongTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, './src/main/index.ts')
// These produce different hashes!
```

### Flaky tests

Common causes and fixes:

| Symptom | Cause | Fix |
|---------|-------|-----|
| Intermittent timeout | Async operation | Add explicit wait |
| Element not visible | Animation | Wait for animation end |
| Wrong element clicked | Multiple matches | Use more specific selector |
| State not reset | Test pollution | Use fresh app instance per test |

```typescript
// Fix: Explicit wait for element state
await expect(element).toBeVisible()
await expect(element).toBeEnabled()
await element.click()

// Fix: Wait for animation
await window.waitForTimeout(300)  // Match animation duration

// Fix: More specific selector
const firstTab = window.locator('[data-testid^="tab-item-"]').first()
```

---

## Platform-specific notes

### Cross-platform testing

When writing tests that work across all platforms, use platform-aware keyboard shortcuts:

```typescript
// ✅ Good: Platform-aware modifier key
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
await window.keyboard.press(`${modKey}+A`)  // Select all
await window.keyboard.press(`${modKey}+C`)  // Copy
await window.keyboard.press(`${modKey}+V`)  // Paste

// ❌ Bad: Hardcoded to macOS
await window.keyboard.press('Meta+A')  // Fails on Windows/Linux
```

**Common shortcuts**:
- `Cmd` (macOS) / `Ctrl` (Windows/Linux): Use `Meta` or `Control`
- `Option` (macOS) / `Alt` (Windows/Linux): Use `Alt` on all platforms
- `Enter`, `Escape`, `Tab`, `F1`-`F12`: Same on all platforms

### macOS

- Use `Meta` key for keyboard shortcuts (Cmd)
- DMG builds are signed and notarized in production
- Test builds skip notarization for faster iteration

### Windows

- Use `Control` key for keyboard shortcuts
- UAC prompts may appear for certain operations
- File paths use backslashes (but testid hashes normalize paths)

### Linux

- Use `Control` key for keyboard shortcuts
- May need X11/Wayland configuration for headed tests
- Sandbox may require `--no-sandbox` flag in some environments

---

## References

- [Playwright Electron documentation](https://playwright.dev/docs/api/class-electron)
- [Playwright locators](https://playwright.dev/docs/locators)
- [BRS-011 specification](../../specs/business-reqs/brs011-ui-test-compatibility/)
- [Test ID constants](../../src/renderer/src/constants/testids.ts)
- [Erfana security documentation](../security.md)

---
brs_id: 11
document_type: technical_adr
sequence: 1
---

# ADR-BRS011-001: UI test architecture

**Date:** 2025-12 | **Status:** Proposed

## Context

Erfana has 5306 unit tests providing excellent code coverage, but lacks infrastructure for automated end-to-end UI testing. This creates several challenges:

1. **Regression risk**: UI changes cannot be automatically verified against user workflows
2. **Manual testing burden**: QA relies on manual verification of visual and interactive behavior
3. **Claude Code integration gap**: Automated testing agents cannot reliably interact with UI elements due to missing stable selectors
4. **Refactoring friction**: Developers hesitate to refactor UI code without E2E safety net

### Current state

- **Existing testids**: 21 testids in MarkdownToolbar, 1 in SettingsOverlay, 1 in BaseDialog (dialog-overlay)
- **Naming pattern**: Existing testids use `toolbar-btn-{action}` and `view-mode-btn-{mode}` patterns
- **Components**: 88 React components in `src/renderer/src/components/`
- **Portals**: Context menus, dialogs, settings overlay, and toasts render to `#portal-root`
- **Third-party components**: Monaco Editor, xterm.js, Mermaid diagrams require wrapper-based testids

### Requirements from BRS-011

- FR-001 to FR-012: Add testids to all interactive elements (26 functional requirements)
- FR-025: TypeScript constants file for compile-time safety
- FR-026: Portal-aware query helpers for testing
- NFR-001 to NFR-006: Zero visual/performance impact, maintainability, uniqueness

## Decision drivers

1. **Consistency**: Align with existing `toolbar-btn-{action}` pattern (canonical, do not change)
2. **Discoverability**: Component-prefixed names enable intuitive guessing
3. **Collision safety**: Hash-based dynamic testids for file paths prevent conflicts
4. **Type safety**: TypeScript constants provide compile-time typo detection
5. **Portal awareness**: Context menus, dialogs render outside component hierarchy
6. **Third-party isolation**: Monaco, xterm, Mermaid require wrapper-based approaches

## Considered options

### Option 1: Flat naming with component prefix

Pattern: `{component}-{element}-{identifier?}`

| Pros | Cons |
|------|------|
| Simple hierarchy | May conflict across nested components |
| Easy to guess | Less context for complex UIs |
| Matches existing patterns | |

Example: `activity-bar-btn-files`, `project-tree-node-a1b2c3d4`

### Option 2: Dot-separated hierarchical naming

Pattern: `{area}.{component}.{element}.{identifier?}`

| Pros | Cons |
|------|------|
| Clear hierarchy | Verbose |
| Semantic grouping | Doesn't match existing patterns |
| Popular in large codebases | Breaking change from current testids |

Example: `sidebar.activity-bar.btn.files`

### Option 3: Hybrid approach (chosen)

Pattern: `{component}-{element-type}-{identifier?}` with `-btn-` for buttons

| Pros | Cons |
|------|------|
| Matches existing canonical testids | Slightly more rules |
| Compact but descriptive | |
| Easy migration | |
| Type-safe via constants | |

Example: `activity-bar-btn-files`, `search-bar-input`, `tab-item-a1b2c3d4`

## Decision outcome

**Chosen option: Option 3 - Hybrid approach**

This option aligns with existing canonical testids while providing clarity and type safety.

### Naming convention rules

1. **Format**: `{component}-{element-type}-{identifier?}`
2. **Case**: kebab-case (lowercase with hyphens)
3. **Buttons**: Use `-btn-` suffix (matches existing `toolbar-btn-bold`)
4. **Inputs**: Use `-input` suffix (e.g., `search-bar-input`)
5. **Containers**: Use component name only (e.g., `activity-bar`, `project-tree`)
6. **Dynamic elements**: Append 8-character SHA256 hash of path (e.g., `tab-item-a1b2c3d4`)
7. **Context menu items**: Use `-item-{action}` pattern (e.g., `context-menu-item-elaborate`)
8. **Toggles**: Use `-toggle-{name}` pattern (e.g., `search-bar-toggle-case`)

### Hash function implementation

```typescript
// Browser-compatible SHA256 hash (Web Crypto API)
export async function getPathHash(path: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(path)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex.slice(0, 8)
}

// Synchronous alternative using simple hash (for React render)
export function getPathHashSync(path: string): string {
  // djb2 hash - fast, good distribution for file paths
  let hash = 5381
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) + hash) + path.charCodeAt(i)
    hash = hash >>> 0 // Convert to unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0')
}
```

**Rationale**: SHA256 prevents collisions between similar paths like `foo/bar.md` and `foo-bar.md`. Synchronous djb2 variant allows use in React render without async/await.

## Architecture design

### TypeScript constants structure

Location: `src/renderer/src/constants/testids.ts`

```typescript
/**
 * Centralized test ID constants for UI elements.
 *
 * Benefits:
 * - Compile-time typo detection
 * - IDE autocomplete
 * - Single source of truth
 * - Refactoring safety
 */
export const TEST_IDS = {
  // Activity bar
  ACTIVITY_BAR: 'activity-bar',
  ACTIVITY_BAR_BTN_FILES: 'activity-bar-btn-files',
  ACTIVITY_BAR_BTN_TERMINAL: 'activity-bar-btn-terminal',
  ACTIVITY_BAR_BTN_SETTINGS: 'activity-bar-btn-settings',
  ACTIVITY_BAR_BTN_THEME: 'activity-bar-btn-theme',

  // Project tree
  PROJECT_TREE: 'project-tree',
  PROJECT_TREE_NODE: 'project-tree-node', // Append -{hash}
  PROJECT_TREE_TOGGLE: 'project-tree-toggle', // Append -{hash}
  PROJECT_TREE_EMPTY: 'project-tree-empty',

  // Editor panel
  EDITOR_PANEL: 'editor-panel',
  EDITOR_MONACO: 'editor-monaco',
  EDITOR_PREVIEW: 'editor-preview',
  EDITOR_SPLIT: 'editor-split',

  // Terminal
  TERMINAL_PANEL: 'terminal-panel',
  TERMINAL_INSTANCE: 'terminal-instance',
  TERMINAL_CONTEXT_MENU: 'terminal-context-menu',
  TERMINAL_MENU_COPY: 'terminal-menu-copy',
  TERMINAL_MENU_PASTE: 'terminal-menu-paste',
  TERMINAL_MENU_CLEAR: 'terminal-menu-clear',

  // Search bar
  SEARCH_BAR: 'search-bar',
  SEARCH_BAR_INPUT: 'search-bar-input',
  SEARCH_BAR_TOGGLE_CASE: 'search-bar-toggle-case',
  SEARCH_BAR_TOGGLE_WORD: 'search-bar-toggle-word',
  SEARCH_BAR_BTN_NEXT: 'search-bar-btn-next',
  SEARCH_BAR_BTN_PREV: 'search-bar-btn-prev',
  SEARCH_BAR_BTN_CLOSE: 'search-bar-btn-close',
  SEARCH_BAR_COUNT: 'search-bar-count',

  // Tab bar
  TAB_BAR: 'tab-bar',
  TAB_ITEM: 'tab-item', // Append -{hash}
  TAB_CLOSE: 'tab-close', // Append -{hash}
  TAB_LABEL: 'tab-label', // Append -{hash}
  TAB_DIRTY: 'tab-dirty', // Append -{hash}
  TAB_ACTIVE: 'tab-active',

  // Dialogs
  DIALOG_OVERLAY: 'dialog-overlay', // Existing
  DIALOG_CONFIRM: 'dialog-confirm',
  DIALOG_ALERT: 'dialog-alert',
  DIALOG_PROMPT: 'dialog-prompt',
  DIALOG_TITLE: 'dialog-title',
  DIALOG_MESSAGE: 'dialog-message',
  DIALOG_BTN_CONFIRM: 'dialog-btn-confirm',
  DIALOG_BTN_CANCEL: 'dialog-btn-cancel',
  DIALOG_INPUT: 'dialog-input',

  // Context menus
  CONTEXT_MENU_EDITOR: 'context-menu-editor',
  CONTEXT_MENU_PREVIEW: 'context-menu-preview',
  CONTEXT_MENU_ITEM: 'context-menu-item', // Append -{action}
  CONTEXT_MENU_SEPARATOR: 'context-menu-separator',

  // Settings overlay
  SETTINGS_OVERLAY: 'settings-overlay', // Existing
  SETTINGS_CLOSE: 'settings-close',
  SETTINGS_SECTION: 'settings-section', // Append -{name}
  SETTINGS_TOGGLE: 'settings-toggle', // Append -{setting}
  SETTINGS_INPUT: 'settings-input', // Append -{setting}

  // Mermaid toolbar
  MERMAID_TOOLBAR: 'mermaid-toolbar',
  MERMAID_BTN_ZOOM_IN: 'mermaid-btn-zoom-in',
  MERMAID_BTN_ZOOM_OUT: 'mermaid-btn-zoom-out',
  MERMAID_BTN_ZOOM_RESET: 'mermaid-btn-zoom-reset',
  MERMAID_BTN_PAN: 'mermaid-btn-pan',
  MERMAID_BTN_FULLSCREEN: 'mermaid-btn-fullscreen',
  MERMAID_DROPDOWN_DIRECTION: 'mermaid-dropdown-direction',

  // Diagram viewer
  DIAGRAM_VIEWER: 'diagram-viewer',
  DIAGRAM_VIEWER_BTN_CLOSE: 'diagram-viewer-btn-close',
  DIAGRAM_VIEWER_CONTENT: 'diagram-viewer-content',
  DIAGRAM_VIEWER_TERMINAL: 'diagram-viewer-terminal',
  DIAGRAM_VIEWER_BTN_CHAT: 'diagram-viewer-btn-chat',

  // Chat bubble
  CHAT_BUBBLE: 'chat-bubble',
  CHAT_BUBBLE_INPUT: 'chat-bubble-input',
  CHAT_BUBBLE_BTN_SEND: 'chat-bubble-btn-send',
  CHAT_BUBBLE_BTN_CLOSE: 'chat-bubble-btn-close',
  CHAT_BUBBLE_MESSAGES: 'chat-bubble-messages',

  // Toast notifications
  TOAST: 'toast', // Append -{type}
  TOAST_MESSAGE: 'toast-message',
  TOAST_BTN_DISMISS: 'toast-btn-dismiss',
  TOAST_BTN_ACTION: 'toast-btn-action',

  // Git status bar
  GIT_STATUS_BAR: 'git-status-bar',
  GIT_BRANCH_NAME: 'git-branch-name',
  GIT_STATUS_COUNTS: 'git-status-counts',
  GIT_SYNC_INDICATOR: 'git-sync-indicator',

  // Toolbar (existing - canonical, do not change)
  MARKDOWN_TOOLBAR: 'markdown-toolbar',
  // Note: toolbar-btn-* testids already exist and are canonical
} as const

export type TestId = typeof TEST_IDS[keyof typeof TEST_IDS]

/**
 * Helper to create dynamic testid with hash suffix
 */
export function withHash(baseId: string, path: string): string {
  return `${baseId}-${getPathHashSync(path)}`
}
```

### Portal-aware query helpers

Location: `src/renderer/src/utils/testHelpers.ts`

```typescript
/**
 * Query helpers that search across both component DOM and portal root.
 *
 * Context menus, dialogs, settings overlay, and toasts render to #portal-root,
 * making them invisible to component-scoped queries.
 */

/**
 * Query for element by testid across entire document (including portals)
 */
export function getByTestIdGlobal(testId: string): Element | null {
  return document.querySelector(`[data-testid="${testId}"]`)
}

/**
 * Query for all elements by testid across entire document
 */
export function getAllByTestIdGlobal(testId: string): Element[] {
  return Array.from(document.querySelectorAll(`[data-testid="${testId}"]`))
}

/**
 * Query for elements with testid prefix (for dynamic testids)
 */
export function getByTestIdPrefix(prefix: string): Element[] {
  return Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`))
}

/**
 * Check if element is rendered in portal root
 */
export function isInPortal(element: Element): boolean {
  return element.closest('#portal-root') !== null
}

/**
 * Wait for portal-rendered element to appear
 */
export async function waitForPortalElement(
  testId: string,
  timeout = 5000
): Promise<Element> {
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const check = () => {
      const element = getByTestIdGlobal(testId)
      if (element) {
        resolve(element)
        return
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error(`Element with testid "${testId}" not found within ${timeout}ms`))
        return
      }

      requestAnimationFrame(check)
    }

    check()
  })
}
```

### Playwright E2E test helpers

Location: `e2e/utils/testHelpers.ts`

```typescript
import { _electron as electron, Page, ElectronApplication } from 'playwright'

/**
 * Launch Erfana for E2E testing
 */
export async function launchApp(): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  })
  return app
}

/**
 * Wait for Erfana to be ready (splash screen gone, main UI visible)
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for activity bar to be visible (indicates app is ready)
  await page.waitForSelector('[data-testid="activity-bar"]', { timeout: 30000 })
}

/**
 * Open a project folder
 */
export async function openProject(page: Page, projectPath: string): Promise<void> {
  // Use Electron API to trigger native folder dialog bypass
  await page.evaluate((path) => {
    window.api.project.openProject(path)
  }, projectPath)

  // Wait for project tree to populate
  await page.waitForSelector('[data-testid="project-tree"]')
}

/**
 * Get Monaco editor content
 */
export async function getEditorContent(page: Page): Promise<string> {
  // Monaco editor exposes content via its model
  return page.evaluate(() => {
    const editor = (window as any).monaco?.editor?.getModels()[0]
    return editor?.getValue() ?? ''
  })
}

/**
 * Set Monaco editor content
 */
export async function setEditorContent(page: Page, content: string): Promise<void> {
  await page.evaluate((text) => {
    const editor = (window as any).monaco?.editor?.getModels()[0]
    editor?.setValue(text)
  }, content)
}

/**
 * Wait for terminal to be ready
 */
export async function waitForTerminal(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="terminal-instance"]')
  // Additional wait for xterm.js initialization
  await page.waitForTimeout(500)
}

/**
 * Send input to terminal
 */
export async function sendTerminalInput(page: Page, text: string): Promise<void> {
  const terminal = page.locator('[data-testid="terminal-instance"]')
  await terminal.click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/**
 * Query across portal-rendered elements (dialogs, menus, overlays)
 * Playwright's locator already queries entire document, but this helper
 * provides semantic clarity
 */
export function getPortalElement(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]`)
}
```

## Component-by-component testid mapping

### Phase 1: Core infrastructure (HIGH priority)

| Component | Testids to add | Complexity |
|-----------|----------------|------------|
| ActivityBar | 5 (container + 4 buttons) | Low |
| SearchBar | 8 (container, input, toggles, buttons, count) | Low |
| BaseDialog | 6 (overlay, container, title, message, buttons) | Low |

### Phase 2: Navigation components (HIGH priority)

| Component | Testids to add | Complexity |
|-----------|----------------|------------|
| ProjectTree | 5 static + N dynamic (nodes, toggles) | Medium |
| ProjectTreeNode | Dynamic hash-based testids | Medium |
| EditorTab | Dynamic hash-based testids | Medium |

### Phase 3: Editor components (HIGH priority)

| Component | Testids to add | Complexity |
|-----------|----------------|------------|
| MarkdownEditorPanel | 4 (container, monaco, preview, split) | Low |
| MonacoMarkdownEditor | 1 wrapper only (third-party) | Low |
| MarkdownPreview | 2 (container, content) | Low |

### Phase 4: Terminal and menus (HIGH priority)

| Component | Testids to add | Complexity |
|-----------|----------------|------------|
| TerminalPanel | 6 (container, instance, context menu items) | Low |
| ContextMenu | N items (portal-rendered) | Medium |
| EditorContextMenu | 6 items | Low |
| PreviewContextMenu | 6 items | Low |

### Phase 5: Dialogs (MEDIUM priority)

| Component | Testids to add | Complexity |
|-----------|----------------|------------|
| ConfirmDialog | 6 | Low |
| AlertDialog | 5 | Low |
| PromptDialog | 7 | Low |
| FilePickerDialog | 6 | Low |

### Phase 6: Settings and overlays (MEDIUM priority)

| Component | Testids to add | Complexity |
|-----------|----------------|------------|
| SettingsOverlay | 10+ (container, close, sections, toggles) | Medium |
| ToastNotification | 4 | Low |

### Phase 7: Mermaid components (MEDIUM priority)

| Component | Testids to add | Complexity |
|-----------|----------------|------------|
| MermaidToolbar | 8 | Low |
| DiagramViewer | 5 | Low |
| ChatBubble | 6 | Low |

### Phase 8: Git components (MEDIUM priority)

| Component | Testids to add | Complexity |
|-----------|----------------|------------|
| GitStatusBar | 4 | Low |
| GitStatusBadge | 1 | Low |

## Third-party component testing patterns

### Monaco Editor

Monaco does not support custom `data-testid` attributes on internal elements. Testing approach:

```typescript
// Use wrapper testid for container
<div data-testid="editor-monaco">
  <MonacoEditor {...props} />
</div>

// In Playwright tests, access Monaco via exposed API
await page.evaluate(() => {
  const model = window.monaco.editor.getModels()[0]
  model.setValue('# New content')
})
```

### xterm.js

xterm.js renders to a canvas element. Testing approach:

```typescript
// Use wrapper testid for container
<div data-testid="terminal-instance">
  <XTerm {...props} />
</div>

// In Playwright tests, simulate keyboard input
const terminal = page.locator('[data-testid="terminal-instance"]')
await terminal.click()
await page.keyboard.type('ls -la')
await page.keyboard.press('Enter')
```

### Mermaid diagrams

Mermaid renders SVG. Testing approach:

```typescript
// Use container testid
<div data-testid="mermaid-diagram" className="mermaid">
  {code}
</div>

// In Playwright tests, verify SVG presence
const diagram = page.locator('[data-testid="mermaid-diagram"] svg')
await expect(diagram).toBeVisible()
```

## Consequences

### Positive

- 100% interactive element coverage enables comprehensive E2E testing
- TypeScript constants prevent typos and enable refactoring
- Hash-based dynamic testids ensure uniqueness for file paths
- Portal-aware helpers simplify testing of dialogs and menus
- Claude Code can write tests using documented selector catalog
- Existing canonical testids preserved (no breaking changes)

### Negative

- ~100 new testid attributes to add across components
- Constants file must be kept in sync with component changes
- Hash-based testids require path knowledge in tests
- Third-party components (Monaco, xterm) have limited testability

### Neutral

- DOM size slightly increases (data-testid attributes are minimal)
- Test infrastructure code added but isolated in dedicated files
- Documentation maintenance for selector catalog

## Implementation phases

### Phase 1: Infrastructure foundation (Week 1)
1. Create `testids.ts` constants file
2. Create `testHelpers.ts` utility file
3. Add hash function implementation
4. Update CLAUDE.md with testing documentation reference

### Phase 2: Core components (Week 1-2)
1. ActivityBar, ActivityBarItem
2. SearchBar
3. BaseDialog (all dialog variants inherit)
4. SettingsOverlay

### Phase 3: Navigation components (Week 2)
1. ProjectTree, ProjectTreeNode (with hash-based testids)
2. EditorTab, TabBar (with hash-based testids)

### Phase 4: Editor components (Week 2-3)
1. MarkdownEditorPanel
2. MonacoMarkdownEditor (wrapper only)
3. MarkdownPreview, MarkdownToolbar (verify existing)

### Phase 5: Context menus and terminal (Week 3)
1. ContextMenu (base component)
2. EditorContextMenu, PreviewContextMenu
3. TerminalPanel, TerminalContextMenu

### Phase 6: Dialogs and overlays (Week 3-4)
1. ConfirmDialog, AlertDialog, PromptDialog
2. FilePickerDialog
3. ToastNotification

### Phase 7: Mermaid components (Week 4)
1. MermaidToolbar
2. DiagramViewer
3. ChatBubble

### Phase 8: Documentation and verification (Week 4)
1. Create `docs/testing/e2e-testing.md`
2. Create selector catalog
3. Write sample Playwright test
4. Verify all testids are unique

## Critical path items

1. **testids.ts constants file** - All component work depends on this
2. **Hash function** - Required for dynamic testids before ProjectTree/Tabs
3. **Portal helpers** - Required before testing dialogs/menus
4. **BaseDialog testids** - All dialog variants inherit from this

## Dependencies

```
testids.ts (constants)
    |
    +-- testHelpers.ts (portal helpers)
    |       |
    |       +-- All component testids
    |
    +-- getPathHashSync (hash function)
            |
            +-- ProjectTreeNode
            +-- EditorTab
```

## Migration considerations

- Existing testids (`toolbar-btn-*`, `view-mode-btn-*`, `settings-overlay`, `dialog-overlay`) are canonical and must not change
- New testids must follow the established `-btn-` pattern for buttons
- All existing unit tests must continue passing (testids are additive)

## Enforcement

- **Code review**: Verify testid follows naming convention
- **TypeScript**: Constants file provides compile-time validation
- **Lint rule**: Consider ESLint rule to require TEST_IDS usage
- **CI**: Add test to verify no duplicate testids in DOM

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Testid conflicts | Low | Medium | Hash function, uniqueness tests |
| Maintenance burden | Medium | Low | TypeScript constants, IDE autocomplete |
| Third-party updates break patterns | Low | Medium | Wrapper-based approach, version pinning |
| Hash function performance | Low | Low | Synchronous djb2 hash, memoization |
| Portal elements missed in tests | Medium | Medium | Portal-aware helpers, documentation |

## References

- [BRS-011 Overview](/specs/business-reqs/brs011-ui-test-compatibility/01-overview.md)
- [BRS-011 Requirements](/specs/business-reqs/brs011-ui-test-compatibility/02-requirements.md)
- [Playwright Electron Documentation](https://playwright.dev/docs/api/class-electron)
- [Testing Library - ByTestId](https://testing-library.com/docs/queries/bytestid/)
- [Kent C. Dodds - Making UI Tests Resilient to Change](https://kentcdodds.com/blog/making-your-ui-tests-resilient-to-change)
- [Modern Test ID Conventions 2025](https://dev.to/rahucode/modern-test-id-conventions-for-reacttypescriptnextjs-apps-industry-best-practices-for-2025-5b3h)

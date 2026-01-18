# Requirements

## Functional requirements

### FR-001: Testid attribute infrastructure

**Priority**: High
**Description**: Add `data-testid` attributes to all interactive elements in the application.

**Details**:
- Every button, input, link, checkbox, radio, select, and menu item must have a unique `data-testid`
- Tree nodes must include dynamic testids with file path or identifier
- Tab elements must include testids with tab index or identifier
- Context menu items must have testids matching action names

**Traces to**: AC-001, AC-002

---

### FR-002: Naming convention enforcement

**Priority**: High
**Description**: All `data-testid` values must follow a consistent naming convention.

**Pattern**: `{component}-{element}-{identifier?}`

**Rules**:
- Use kebab-case (lowercase with hyphens)
- Component prefix matches component name (e.g., `activity-bar-`, `project-tree-`)
- Element type uses short form for buttons: `-btn-` (matches existing codebase convention)
- Optional identifier for dynamic elements using hash for paths (collision-safe)
- Existing testids (e.g., `toolbar-btn-bold`) are canonical - do not change

**Examples**:
| Element | Testid |
|---------|--------|
| Activity bar files button | `activity-bar-btn-files` |
| Project tree node | `project-tree-node-{hash}` |
| Editor tab close button | `tab-close-{hash}` |
| Search input | `search-bar-input` |
| Context menu elaborate | `context-menu-item-elaborate` |
| Toolbar bold button | `toolbar-btn-bold` (existing) |

**Hash function**: Use first 8 characters of SHA256 hash of file path for dynamic testids.

**Traces to**: AC-003

---

### FR-003: Activity bar testids

**Priority**: High
**Description**: Add testids to ActivityBar and ActivityBarItem components.

**Required testids**:
| Element | Testid |
|---------|--------|
| Activity bar container | `activity-bar` |
| Files button | `activity-bar-btn-files` |
| Terminal button | `activity-bar-btn-terminal` |
| Settings button | `activity-bar-btn-settings` |
| Theme toggle | `activity-bar-btn-theme` |

**Traces to**: AC-001

---

### FR-004: Project tree testids

**Priority**: High
**Description**: Add testids to ProjectTree and ProjectTreeNode components.

**Required testids**:
| Element | Testid |
|---------|--------|
| Tree container | `project-tree` |
| Tree node (file/folder) | `project-tree-node-{hash}` |
| Tree node expand toggle | `project-tree-toggle-{hash}` |
| Tree node icon | `project-tree-icon-{hash}` |
| Tree node label | `project-tree-label-{hash}` |
| Empty state | `project-tree-empty` |
| Drag handle | `project-tree-drag-{hash}` |

**Hash generation**: Use first 8 characters of SHA256 hash of relative file path.
```typescript
const getPathHash = (path: string) =>
  crypto.createHash('sha256').update(path).digest('hex').slice(0, 8)
// Example: "src/main/index.ts" → "a1b2c3d4"
```

**Rationale**: Hash prevents collision between paths like `foo/bar.md` and `foo-bar.md`.

**Traces to**: AC-001

---

### FR-005: Terminal panel testids

**Priority**: High
**Description**: Add testids to TerminalPanel and terminal controls.

**Required testids**:
| Element | Testid |
|---------|--------|
| Terminal container | `terminal-panel` |
| Terminal instance | `terminal-instance` |
| Terminal context menu | `terminal-context-menu` |
| Copy action | `terminal-menu-copy` |
| Paste action | `terminal-menu-paste` |
| Clear action | `terminal-menu-clear` |

**Traces to**: AC-001

---

### FR-006: Editor panel testids

**Priority**: High
**Description**: Add testids to MonacoMarkdownEditor and MarkdownPreview components.

**Required testids**:
| Element | Testid |
|---------|--------|
| Editor container | `editor-panel` |
| Monaco wrapper | `editor-monaco` |
| Preview container | `editor-preview` |
| Split view container | `editor-split` |
| View mode buttons | `editor-button-{mode}` (edit, preview, split) |
| Toolbar | `editor-toolbar` |

**Traces to**: AC-001

---

### FR-007: Dialog component testids

**Priority**: High
**Description**: Add testids to dialog components (ConfirmDialog, AlertDialog, PromptDialog).

**Required testids**:
| Element | Testid |
|---------|--------|
| Dialog overlay | `dialog-overlay` |
| Dialog container | `dialog-{type}` (confirm, alert, prompt) |
| Dialog title | `dialog-title` |
| Dialog message | `dialog-message` |
| Confirm button | `dialog-button-confirm` |
| Cancel button | `dialog-button-cancel` |
| Input field (prompt) | `dialog-input` |

**Traces to**: AC-001

---

### FR-008: Context menu testids

**Priority**: High
**Description**: Add testids to EditorContextMenu and PreviewContextMenu components.

**Required testids**:
| Element | Testid |
|---------|--------|
| Menu container | `context-menu-{type}` (editor, preview) |
| Menu item | `context-menu-item-{action}` |
| Submenu | `context-menu-submenu-{name}` |
| Separator | `context-menu-separator` |

**Actions**: elaborate, modify, ask, visualize, copy

**Traces to**: AC-001

---

### FR-009: Settings overlay testids

**Priority**: Medium
**Description**: Add testids to SettingsOverlay component sections.

**Required testids**:
| Element | Testid |
|---------|--------|
| Overlay container | `settings-overlay` (exists) |
| Close button | `settings-close` |
| Section container | `settings-section-{name}` |
| Toggle switch | `settings-toggle-{setting}` |
| Input field | `settings-input-{setting}` |
| Select dropdown | `settings-select-{setting}` |

**Traces to**: AC-001

---

### FR-010: Tab bar testids

**Priority**: High
**Description**: Add testids to editor tab components.

**Required testids**:
| Element | Testid |
|---------|--------|
| Tab bar container | `tab-bar` |
| Tab item | `tab-item-{hash}` |
| Tab close button | `tab-close-{hash}` |
| Tab label | `tab-label-{hash}` |
| Tab dirty indicator | `tab-dirty-{hash}` |
| Active tab | `tab-active` |

**Hash generation**: Use same hash function as FR-004 (SHA256 of file path, first 8 chars).

**Rationale**: Index-based testids break when tabs reorder. Hash provides stable reference.

**Traces to**: AC-001

---

### FR-011: Search bar testids

**Priority**: High
**Description**: Add testids to SearchBar component.

**Required testids**:
| Element | Testid |
|---------|--------|
| Search container | `search-bar` |
| Search input | `search-bar-input` |
| Case toggle | `search-bar-toggle-case` |
| Word toggle | `search-bar-toggle-word` |
| Next button | `search-bar-button-next` |
| Prev button | `search-bar-button-prev` |
| Close button | `search-bar-button-close` |
| Match count | `search-bar-count` |

**Traces to**: AC-001

---

### FR-012: Toolbar testids

**Priority**: Medium
**Description**: Add testids to MarkdownToolbar buttons and dropdowns.

**Required testids**:
| Element | Testid |
|---------|--------|
| Toolbar container | `markdown-toolbar` |
| Bold button | `toolbar-button-bold` |
| Italic button | `toolbar-button-italic` |
| Heading dropdown | `toolbar-dropdown-heading` |
| Link button | `toolbar-button-link` |
| Code button | `toolbar-button-code` |
| (etc. for all toolbar actions) |

**Note**: MarkdownToolbar already has 21 testids - verify completeness.

**Traces to**: AC-001

---

### FR-013: Playwright configuration documentation

**Priority**: High
**Description**: Document Playwright setup for Electron testing.

**Documentation must include**:
1. Installation commands (`npm install -D @playwright/test playwright`)
2. Electron-specific configuration (`playwright.config.ts`)
3. Launching Electron app in tests
4. Connecting to Electron's Chromium DevTools Protocol
5. Example test file structure
6. Common patterns (wait for app ready, handle IPC)

**Traces to**: AC-004

---

### FR-014: Monaco Editor testing patterns

**Priority**: High
**Description**: Document testing patterns for Monaco Editor integration.

**Patterns to document**:
1. Accessing Monaco instance via wrapper testid
2. Setting editor content programmatically
3. Simulating user typing
4. Selecting text ranges
5. Triggering editor commands (format, find, etc.)
6. Reading editor content for assertions
7. Handling async model updates

**Traces to**: AC-005

---

### FR-015: xterm.js testing patterns

**Priority**: High
**Description**: Document testing patterns for terminal (xterm.js) integration.

**Patterns to document**:
1. Waiting for terminal ready state
2. Sending input to terminal
3. Reading terminal buffer content
4. Waiting for command output
5. Handling ANSI escape sequences
6. Testing context menu actions

**Traces to**: AC-005

---

### FR-016: Mermaid diagram testing patterns

**Priority**: Medium
**Description**: Document testing patterns for Mermaid diagram interactions.

**Patterns to document**:
1. Waiting for diagram render completion
2. Testing zoom controls
3. Testing pan interactions
4. Opening full-screen viewer
5. Verifying diagram content (via accessibility tree or SVG inspection)

**Traces to**: AC-005

---

### FR-017: Selector catalog documentation

**Priority**: High
**Description**: Create comprehensive selector catalog for Claude Code.

**Catalog format**:
```markdown
## Component: ActivityBar
| Selector | Purpose | Type |
|----------|---------|------|
| [data-testid="activity-bar"] | Container | static |
| [data-testid="activity-bar-button-files"] | Files panel toggle | static |
```

**Must cover**: All 88 components with interactive elements.

**Traces to**: AC-006

---

### FR-018: Test helper utilities

**Priority**: Medium
**Description**: Create utility functions for common test operations.

**Utilities**:
1. `waitForAppReady()` - Wait for Electron app initialization
2. `getByTestId(id)` - Shorthand for `page.getByTestId()`
3. `openProject(path)` - Open project folder
4. `closeProject()` - Close current project
5. `setEditorContent(content)` - Set Monaco content
6. `getEditorContent()` - Get Monaco content
7. `waitForTerminal()` - Wait for terminal ready
8. `sendTerminalInput(text)` - Type in terminal

**Traces to**: AC-007

---

### FR-019: Mermaid toolbar testids

**Priority**: High
**Description**: Add testids to MermaidToolbar component.

**Required testids**:
| Element | Testid |
|---------|--------|
| Toolbar container | `mermaid-toolbar` |
| Zoom in button | `mermaid-btn-zoom-in` |
| Zoom out button | `mermaid-btn-zoom-out` |
| Zoom reset button | `mermaid-btn-zoom-reset` |
| Pan button | `mermaid-btn-pan` |
| Fullscreen button | `mermaid-btn-fullscreen` |
| Direction dropdown | `mermaid-dropdown-direction` |
| Direction option | `mermaid-direction-{value}` |

**Traces to**: AC-001, AC-002

---

### FR-020: Diagram viewer testids

**Priority**: High
**Description**: Add testids to DiagramViewer full-screen component.

**Required testids**:
| Element | Testid |
|---------|--------|
| Viewer overlay | `diagram-viewer` |
| Close button | `diagram-viewer-btn-close` |
| Diagram container | `diagram-viewer-content` |
| Terminal portal | `diagram-viewer-terminal` |
| Chat bubble trigger | `diagram-viewer-btn-chat` |

**Traces to**: AC-001, AC-002

---

### FR-021: Chat bubble testids

**Priority**: High
**Description**: Add testids to ChatBubble component (Mermaid diagram chat).

**Required testids**:
| Element | Testid |
|---------|--------|
| Bubble container | `chat-bubble` |
| Input field | `chat-bubble-input` |
| Send button | `chat-bubble-btn-send` |
| Action button | `chat-bubble-btn-{action}` |
| Close button | `chat-bubble-btn-close` |
| Message container | `chat-bubble-messages` |

**Traces to**: AC-001, AC-002

---

### FR-022: File picker dialog testids

**Priority**: Medium
**Description**: Add testids to FilePickerDialog component.

**Required testids**:
| Element | Testid |
|---------|--------|
| Dialog container | `file-picker` |
| File list | `file-picker-list` |
| File item | `file-picker-item-{hash}` |
| Select button | `file-picker-btn-select` |
| Cancel button | `file-picker-btn-cancel` |
| Search input | `file-picker-input` |

**Traces to**: AC-001, AC-002

---

### FR-023: Toast notification testids

**Priority**: Medium
**Description**: Add testids to ToastNotification component.

**Required testids**:
| Element | Testid |
|---------|--------|
| Toast container | `toast-{type}` (success, error, warning, info) |
| Toast message | `toast-message` |
| Dismiss button | `toast-btn-dismiss` |
| Action button | `toast-btn-action` |

**Traces to**: AC-001, AC-002

---

### FR-024: Git status bar testids

**Priority**: Medium
**Description**: Add testids to GitStatusBar component.

**Required testids**:
| Element | Testid |
|---------|--------|
| Status bar container | `git-status-bar` |
| Branch name | `git-branch-name` |
| Status counts | `git-status-counts` |
| Sync indicator | `git-sync-indicator` |

**Traces to**: AC-001, AC-002

---

### FR-025: TypeScript testid constants

**Priority**: High
**Description**: Create centralized TypeScript constants file for all testids.

**Location**: `src/renderer/src/constants/testids.ts`

**Structure**:
```typescript
export const TEST_IDS = {
  // Activity Bar
  ACTIVITY_BAR: 'activity-bar',
  ACTIVITY_BAR_BTN_FILES: 'activity-bar-btn-files',
  ACTIVITY_BAR_BTN_TERMINAL: 'activity-bar-btn-terminal',
  // ... all static testids
} as const

export type TestId = typeof TEST_IDS[keyof typeof TEST_IDS]

// Hash helper for dynamic testids
export const getPathHash = (path: string): string => {
  // Implementation uses Web Crypto API
}
```

**Benefits**:
- Compile-time typo detection
- IDE autocomplete support
- Single source of truth
- Refactoring safety

**Traces to**: AC-003, AC-010

---

### FR-026: Portal-aware query helpers

**Priority**: High
**Description**: Create query helpers that search both component DOM and portal root.

**Location**: `src/renderer/src/utils/testHelpers.ts` (for production) and `e2e/utils/` (for tests)

**Helpers**:
```typescript
// Query across entire document including portals
export const getByTestIdGlobal = (testId: string): Element | null =>
  document.querySelector(`[data-testid="${testId}"]`)

// Wait for portal-rendered element
export const waitForPortalElement = async (testId: string): Promise<Element>

// Check if element is in portal
export const isInPortal = (element: Element): boolean =>
  element.closest('#portal-root') !== null
```

**Rationale**: Context menus, dialogs, and toasts render to `#portal-root`, not within component hierarchy.

**Traces to**: AC-007, AC-010

---

## Non-functional requirements

### NFR-001: Zero visual impact

**Priority**: Critical
**Description**: Adding `data-testid` attributes must not change any visual appearance.

**Verification**: Visual regression comparison before/after.

**Traces to**: AC-008

---

### NFR-002: Zero performance impact

**Priority**: Critical
**Description**: Adding `data-testid` attributes must not impact runtime performance.

**Rationale**: `data-*` attributes are passive; browsers ignore them unless explicitly queried.

**Traces to**: AC-008

---

### NFR-003: Maintainability

**Priority**: High
**Description**: Testid naming must be intuitive and self-documenting.

**Criteria**:
- Developers can guess testid from component/element name
- No abbreviations that require lookup
- Consistent patterns across all components

**Traces to**: AC-003

---

### NFR-004: Uniqueness

**Priority**: Critical
**Description**: Each `data-testid` must be unique within its scope.

**Rules**:
- Static testids must be globally unique
- Dynamic testids must be unique within their collection
- No duplicate testids in rendered DOM

**Traces to**: AC-009

---

### NFR-005: Third-party component isolation

**Priority**: High
**Description**: Third-party components (Monaco, xterm, Mermaid) must have testids on wrapper elements only.

**Rationale**: Cannot add testids inside third-party component DOM; wrappers provide stable anchor points.

**Traces to**: AC-005

---

### NFR-006: Documentation accessibility

**Priority**: High
**Description**: Testing documentation must be easily discoverable by Claude Code.

**Location**: `docs/testing/e2e-testing.md`

**Format**: Markdown with code examples, tables, and clear section headers.

**Traces to**: AC-006

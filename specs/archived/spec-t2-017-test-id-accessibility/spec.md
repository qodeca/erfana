# Test ID coverage and accessibility selectors

## Overview

Erfana's test infrastructure includes a centralized `TEST_IDS` registry (`src/renderer/src/constants/testids.ts`) with 138+ static test IDs and dynamic ID support via `getDynamicTestId()`. E2E tests exclusively use `data-testid` selectors for reliability.

An audit of the codebase reveals several categories of interactive and structural UI elements that lack test IDs, making them invisible to automated tests. Additionally, some components lack sufficient ARIA attributes, which limits the ability to use accessibility-driven selectors as a complementary testing strategy.

This spec addresses both gaps to maximize automated test coverage potential.

### Scope

- Add `data-testid` attributes to UI elements currently missing them
- Add ARIA roles and labels to interactive elements lacking semantic markup
- Update the centralized `testids.ts` registry and its validation tests
- Does NOT change existing test IDs or break existing selectors

### Out of scope

- Overflow/contextual menu trigger test IDs – no overflow buttons, "more actions" menus, or collapsed action groups exist in the current UI; the markdown toolbar renders all buttons unconditionally
- Custom tooltip components – the codebase uses native `title` attributes only; there are no custom tooltip components to target
- Editor drop zone – `EditorContentLayout` has no drop handling; adding interaction logic is out of scope for a test ID spec

### Related specs

- Spec #018 (E2E infrastructure overhaul) – consumes the new test IDs
- Spec #019 (Visual regression and CI resilience) – benefits from improved selectors

---

## Requirements

### Functional requirements

**017-FR-001: Draggable element test IDs**
`@dnd-kit/core` spreads drag listeners on the entire `ProjectTreeNode` row – there are no separate drag handle elements. The existing `PROJECT_TREE_NODE_FILE` / `PROJECT_TREE_NODE_FOLDER` dynamic IDs already cover draggable elements and are sufficient for initiating drag operations in E2E tests. Add `data-testid` to the drag overlay ghost element in `ProjectTree.tsx` (the `DragOverlay` children near line 1357), which currently lacks one. New ID: `project-tree-drag-overlay`.

**017-FR-002: Drop zone test IDs**
Add `data-testid` to all drop zone elements. The `TERMINAL_DROP_ZONE` constant already exists in `testids.ts` but is dead code – it is never applied to any component. Fix this by applying it to the terminal panel's drop target area. Enumerate actual drop surfaces:

- **Terminal panel** – apply the existing `TERMINAL_DROP_ZONE` constant to the terminal panel's file drop target
- **Project tree folders** – via `FolderDropHighlight`, add `data-testid` using a dynamic ID pattern: `project-tree-drop-target-<folderPath>`
- **External file drop overlay** – `DropModeDialog` and the external drop overlay; ensure `data-testid` is present on the overlay container

Drop zones must be identifiable both in their default and active (drag-hover) states.

**017-FR-003: Transitional state container test IDs**
Add `data-testid` to loading, error, and empty state containers. Concrete checklist:

- `UIBlocker` / `UIBlockerBase` – loading spinner overlay (no test ID today). New ID: `ui-blocker`
- `ProjectTree` error state (`.project-tree-error` div, ~line 1224) – no test ID. New ID: `project-tree-error`
- `ProjectTree` switching spinner (~line 1240) – no test ID. New ID: `project-tree-loading`
- `TerminalStatusContent` – unavailable/error states. Add test IDs for each state variant
- `EditorErrorBoundary` – error fallback (~line 89-99) – no test ID. New ID: `editor-error-boundary`
- `FileConflictNotification` – container, reload/keep/dismiss buttons – no test IDs. New IDs: `file-conflict-notification`, `file-conflict-btn-reload`, `file-conflict-btn-keep`, `file-conflict-btn-dismiss`
- `WelcomePanel` – recent projects list, individual items, remove buttons – only import button has test ID. New IDs: `welcome-recent-projects`, `welcome-recent-project-<path>`, `welcome-recent-project-btn-remove-<path>`

**017-FR-004: ARIA roles on interactive containers**
Add appropriate ARIA roles to interactive container elements. Concrete mapping:

| Component | Role to add | Notes |
|---|---|---|
| `ActivityBar` container | `role="toolbar"`, `aria-label="Activity bar"`, `aria-orientation="vertical"` | Currently plain `<div>` |
| `ProjectTree` content area | `role="tree"` | WAI-ARIA treeview pattern |
| `ProjectTreeNode` items | `role="treeitem"`, `aria-expanded` | Expose expand/collapse state |
| Terminal panel | `role="region"`, `aria-label="Terminal"` | |
| Editor area | `role="region"`, `aria-label="Editor"` | |
| `SearchBar` | `role="search"` | |
| Context menus | `role="menu"` with `role="menuitem"` on items | |

**Exclusion**: Dockview-managed tab containers are excluded – Dockview manages its own ARIA roles internally. Adding duplicate `role="tablist"` would create ARIA conflicts.

**017-FR-005: Accessible names on icon-only buttons**
`aria-label` is required for all icon-only interactive elements. The `title` attribute alone is not sufficient – it is not reliably announced by screen readers. `title` may additionally be set for tooltip behavior. This requirement subsumes the original tooltip trigger intent (tooltips in the codebase are `title` attributes on the same icon buttons).

Concrete targets:
- All ~20 `MarkdownToolbar` buttons (currently `title` only)
- `ActivityBarItem` items (currently `title` only)
- `ActivityBar` settings button (currently `title` only)
- `ProjectTree` header buttons (`BTN_OPEN`, `BTN_CLOSE`, `BTN_NEW_FILE`, `BTN_NEW_FOLDER` – `title` only, except refresh which already has `aria-label`)

**Recommendation**: Where feasible, convert `role="button"` on `<div>` elements to native `<button>` elements (e.g., `ActivityBarItem`, `ActivityBar` settings button) to get automatic accessible name derivation and keyboard behaviour.

**017-FR-006: Update testids.ts registry**
Add all new test IDs to the centralized `TEST_IDS` object in `testids.ts`. Update the integer in each section header comment (e.g., `// Project Tree (11)`) to match the actual count. Add corresponding count assertions in `testids.test.ts`. New component groups (e.g., `UI_BLOCKER_*`) need their own count test block. Ensure uniqueness checks pass.

**017-FR-007: Automated icon-button coverage test**
In each component unit test file, assert that every rendered `<button>` element with no text content has an `aria-label` attribute. This prevents future regressions where new icon-only buttons are added without accessible names.

### Non-functional requirements

**017-NFR-001: Naming convention compliance**
All new test IDs must follow the existing kebab-case convention with component prefix (e.g., `project-tree-drag-overlay`, `terminal-drop-zone`). Dynamic IDs must use the existing `getDynamicTestId()` pattern. Use `-btn-` infix for buttons (e.g., `project-tree-btn-refresh`, `file-conflict-btn-reload`). The `-button` suffix in existing external-drop dialog IDs is considered legacy.

**017-NFR-002: Zero regression on existing selectors**
No existing `data-testid` values may be changed or removed. All current E2E tests must pass without modification after these changes.

**017-NFR-003: Minimal runtime overhead**
Adding `data-testid` attributes must not measurably impact render performance. Attributes should be applied directly in JSX, not via runtime DOM manipulation.

**017-NFR-004: Production build retention**
`data-testid` attributes are retained in production builds. This is acceptable for an Electron desktop application where the DOM is not publicly exposed.

---

## Acceptance criteria

**017-AC-001: Draggable element testability**
Given a project tree with files, when an E2E test queries `byDynamicTestId(page, 'project-tree-node-file', filePath)`, then the draggable element is found and can initiate a drag operation via Playwright's drag API.

**017-AC-002: Drop zone testability**
Given the application with a project open:
- **Terminal**: `byTestId(page, 'terminal-drop-zone')` resolves to the terminal file drop target (fix dead code)
- **Project tree folder**: `byDynamicTestId(page, 'project-tree-drop-target', folderPath)` resolves during a drag operation
- **External drop overlay**: `byTestId(page, 'external-drop-overlay')` resolves when an external file is dragged over the window

**017-AC-003: Transitional state assertion**
Given a `ProjectTree` component rendered with `loading={true}`, when querying `getByTestId('project-tree-loading')`, then the loading indicator is visible. When re-rendered with `loading={false}`, the element is removed from the DOM. (Unit test approach – avoids E2E flakiness from sub-50ms loading states.)

**017-AC-004: ARIA toolbar on activity bar**
Given the activity bar, when a unit test queries `getByRole('toolbar', { name: 'Activity bar' })`, then the activity bar container is returned.

**017-AC-005: Icon button accessible names**
Given any icon-only button in the UI, when a unit test queries `getByRole('button', { name: '<action>' })`, then the button is found by its `aria-label`.

**017-AC-006: Registry integrity**
After all changes, `npm run test -- testids.test.ts` passes with updated counts, no duplicate values, and all keys in SCREAMING_SNAKE_CASE.

**017-AC-007: WAI-ARIA treeview**
Given the project tree with expanded folders, when a unit test queries `getByRole('tree')`, then the tree container is returned. Each file/folder node is queryable via `getByRole('treeitem')` and expanded folders have `aria-expanded="true"`.

**017-AC-008: UIBlocker visibility**
Given the UIBlocker is active, when an E2E test queries `byTestId(page, 'ui-blocker')`, then the overlay is visible. When the blocking operation completes, the element is removed.

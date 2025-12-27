# Acceptance criteria

## Test cases

### AC-001: Interactive element coverage

**Description**: All interactive UI elements have `data-testid` attributes.

**Steps**:
1. Run DOM analysis script to count interactive elements
2. Run script to count elements with `data-testid`
3. Compare counts

**Expected result**: 100% of interactive elements have testids.

**Traces to**: FR-001, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012

---

### AC-002: Component checklist verification

**Description**: Each target component has all required testids implemented.

**Checklist**:

| Component | Required testids | Status |
|-----------|-----------------|--------|
| ActivityBar | 5 (container, files, terminal, settings, theme) | [ ] |
| ProjectTree | 5 (container, node, toggle, icon, empty) | [ ] |
| TerminalPanel | 6 (container, instance, menu, copy, paste, clear) | [ ] |
| MonacoMarkdownEditor | 3 (container, monaco, toolbar) | [ ] |
| MarkdownPreview | 2 (container, content) | [ ] |
| EditorPanel | 4 (container, split, button-edit/preview/split) | [ ] |
| MermaidToolbar | 8 (container, zoom controls, direction) | [ ] |
| DiagramViewer | 5 (overlay, close, content, terminal, chat) | [ ] |
| ChatBubble | 6 (container, input, send, actions, close, messages) | [ ] |
| FilePickerDialog | 6 (container, list, items, buttons, input) | [ ] |
| ToastNotification | 4 (container, message, dismiss, action) | [ ] |
| GitStatusBar | 4 (container, branch, counts, sync) | [ ] |
| ConfirmDialog | 6 (overlay, container, title, message, confirm, cancel) | [ ] |
| AlertDialog | 5 (overlay, container, title, message, ok) | [ ] |
| PromptDialog | 7 (overlay, container, title, message, input, confirm, cancel) | [ ] |
| EditorContextMenu | 6 (container, items for each action) | [ ] |
| PreviewContextMenu | 6 (container, items for each action) | [ ] |
| SettingsOverlay | 10+ (container, close, sections, toggles) | [ ] |
| TabBar | 5 (container, items, close buttons, labels, active) | [ ] |
| SearchBar | 8 (container, input, toggles, buttons, count) | [ ] |

**Expected result**: All checkboxes marked complete.

**Traces to**: FR-003 through FR-012

---

### AC-003: Naming convention compliance

**Description**: All testids follow the documented naming convention.

**Steps**:
1. Extract all `data-testid` values from codebase
2. Validate each against pattern: `{component}-{element}-{identifier?}`
3. Check for kebab-case compliance
4. Check for prohibited characters (uppercase, underscores, spaces)

**Expected result**: 100% compliance with naming convention.

**Traces to**: FR-002, NFR-003

---

### AC-004: Playwright setup verification

**Description**: Playwright can launch and interact with Erfana.

**Steps**:
1. Install Playwright in project
2. Configure Playwright for Electron
3. Write test that launches app
4. Verify test can click activity bar button
5. Verify test can read project tree

**Expected result**: Sample test passes, demonstrating working Playwright setup.

**Traces to**: FR-013

---

### AC-005: Third-party component testing

**Description**: Monaco, xterm, and Mermaid can be tested via documented patterns.

**Steps**:
1. Write test that sets Monaco content
2. Write test that sends terminal input
3. Write test that interacts with Mermaid toolbar
4. All tests pass without flakiness

**Expected result**: All third-party component tests pass.

**Traces to**: FR-014, FR-015, FR-016, NFR-005

---

### AC-006: Documentation completeness

**Description**: Testing documentation covers all components and patterns.

**Checklist**:

| Documentation section | Status |
|----------------------|--------|
| Playwright installation guide | [ ] |
| Electron configuration | [ ] |
| Selector catalog (all 88 components) | [ ] |
| Monaco testing patterns | [ ] |
| xterm testing patterns | [ ] |
| Mermaid testing patterns | [ ] |
| Common test patterns | [ ] |
| Troubleshooting guide | [ ] |

**Expected result**: All sections complete and accurate.

**Traces to**: FR-013, FR-14, FR-15, FR-16, FR-17, NFR-006

---

### AC-007: Test helper utilities

**Description**: Helper utilities work as documented.

**Steps**:
1. Import utilities in test file
2. Use `waitForAppReady()` - app becomes interactive
3. Use `openProject()` - project tree populates
4. Use `setEditorContent()` - Monaco shows content
5. Use `getEditorContent()` - returns correct content
6. Use `waitForTerminal()` - terminal ready
7. Use `sendTerminalInput()` - input appears in terminal

**Expected result**: All utilities function correctly.

**Traces to**: FR-018

---

### AC-008: No visual or performance regression

**Description**: Adding testids causes no visual or performance changes.

**Steps**:
1. Take screenshots of all major views before changes
2. Add all testids
3. Take screenshots after changes
4. Compare screenshots pixel-by-pixel
5. Run performance benchmark (app startup time)
6. Compare before/after performance

**Expected result**:
- Screenshots match 100%
- Performance within 5% of baseline

**Traces to**: NFR-001, NFR-002

---

### AC-009: Testid uniqueness validation

**Description**: No duplicate testids exist in rendered DOM.

**Steps**:
1. Launch app with project loaded
2. Open all panels (editor, preview, terminal, settings)
3. Query DOM for all `[data-testid]` elements
4. Check for duplicate values

**Expected result**: All testids are unique.

**Traces to**: NFR-004

---

### AC-010: Infrastructure requirements

**Description**: TypeScript constants and portal helpers are implemented correctly.

**Steps**:
1. Verify `src/renderer/src/constants/testids.ts` exists
2. Import TEST_IDS in a component - verify autocomplete works
3. Verify `getPathHash()` function generates consistent 8-char hashes
4. Verify `getByTestIdGlobal()` finds portal-rendered elements
5. Open context menu, verify it can be queried via helper

**Expected result**:
- All static testids defined in TEST_IDS constant
- Hash function is deterministic (same path = same hash)
- Portal elements are queryable

**Traces to**: FR-025, FR-026

---

## Definition of done

### Component testids
- [ ] All interactive elements have `data-testid` attributes (FR-001 through FR-012)
- [ ] Mermaid toolbar testids added (FR-019)
- [ ] Diagram viewer testids added (FR-020)
- [ ] Chat bubble testids added (FR-021)
- [ ] File picker dialog testids added (FR-022)
- [ ] Toast notification testids added (FR-023)
- [ ] Git status bar testids added (FR-024)

### Infrastructure
- [ ] All testids follow naming convention with `-btn-` pattern (FR-002)
- [ ] TypeScript constants file created (FR-025)
- [ ] Portal-aware query helpers implemented (FR-026)
- [ ] Hash-based dynamic testids for paths/tabs (FR-004, FR-010)

### Documentation
- [ ] Playwright configuration documented (FR-013)
- [ ] Monaco testing patterns documented (FR-014)
- [ ] xterm testing patterns documented (FR-015)
- [ ] Mermaid testing patterns documented (FR-016)
- [ ] Selector catalog created (FR-017)
- [ ] Test helper utilities implemented (FR-018)
- [ ] Documentation in `docs/testing/e2e-testing.md`

### Quality gates
- [ ] No visual regression (NFR-001)
- [ ] No performance regression (NFR-002)
- [ ] All testids unique (NFR-004)
- [ ] Sample Playwright test demonstrating setup
- [ ] All existing unit tests still pass

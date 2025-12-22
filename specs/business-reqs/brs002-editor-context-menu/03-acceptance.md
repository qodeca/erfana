# Acceptance Criteria

## Test Cases

### TC-001: Context menu appears on right-click with selection

**Description:** Verify context menu appears when right-clicking with text selected in Monaco editor.
**Preconditions:** Markdown file open in Monaco editor.
**Steps:**
1. Select text in the Monaco editor
2. Right-click on the selection
**Expected Result:** Custom context menu appears with AI prompt options.
**Traces to:** FR-001, FR-002, AC-001

### TC-002: No context menu without selection

**Description:** Verify context menu does not appear when right-clicking without text selected.
**Preconditions:** Markdown file open in Monaco editor with no text selected.
**Steps:**
1. Ensure no text is selected
2. Right-click in the editor
**Expected Result:** Monaco's default context menu appears (or no menu if configured).
**Traces to:** FR-001, AC-002

### TC-003: Elaborate prompt execution

**Description:** Verify Elaborate prompt executes and sends to terminal.
**Preconditions:** Context menu is visible with prompts displayed.
**Steps:**
1. Select text in editor
2. Right-click to open context menu
3. Click "Elaborate" menu item
**Expected Result:** Prompt is rendered with selected text and sent to terminal panel.
**Traces to:** FR-004, FR-009, AC-003

### TC-004: Modify prompt with dialog

**Description:** Verify Modify prompt shows dialog and then executes.
**Preconditions:** Context menu is visible with prompts displayed.
**Steps:**
1. Select text in editor
2. Right-click to open context menu
3. Click "Modify" menu item
4. Enter modification instructions in dialog
5. Click execute/submit button
**Expected Result:** Dialog appears, user input captured, prompt executed with input and selected text.
**Traces to:** FR-005, FR-009, AC-004

### TC-005: Copy selection action

**Description:** Verify Copy selection copies text to clipboard.
**Preconditions:** Text selected in editor, context menu visible.
**Steps:**
1. Select text in editor
2. Right-click to open context menu
3. Click "Copy selection" menu item
**Expected Result:** Selected text is copied to system clipboard.
**Traces to:** FR-006, AC-005

### TC-006: Escape key closes menu

**Description:** Verify Escape key dismisses context menu.
**Preconditions:** Context menu is visible.
**Steps:**
1. Open context menu via right-click with selection
2. Press Escape key
**Expected Result:** Context menu closes, no action executed.
**Traces to:** FR-008, AC-006

### TC-007: Click outside closes menu

**Description:** Verify clicking outside dismisses context menu.
**Preconditions:** Context menu is visible.
**Steps:**
1. Open context menu via right-click with selection
2. Click anywhere outside the context menu
**Expected Result:** Context menu closes, no action executed.
**Traces to:** FR-008, AC-007

### TC-008: Menu viewport positioning

**Description:** Verify menu is positioned within viewport boundaries.
**Preconditions:** Monaco editor is visible.
**Steps:**
1. Position cursor near edge of viewport (right or bottom)
2. Select text
3. Right-click to open context menu
**Expected Result:** Menu appears fully visible, constrained to viewport boundaries.
**Traces to:** FR-007, AC-008

### TC-009: Prompt templates have correct area

**Description:** Verify editor prompts use correct area/subArea filtering.
**Preconditions:** Prompt templates exist for code-editor area.
**Steps:**
1. Inspect prompt template frontmatter
2. Verify area is `code-editor` and subArea is `context-menu`
3. Open context menu in editor
4. Verify only code-editor prompts appear
**Expected Result:** Only prompts with `area: code-editor` and `subArea: context-menu` are displayed.
**Traces to:** FR-003, FR-009, AC-009

### TC-010: Unit test coverage

**Description:** Verify EditorContextMenu component has adequate test coverage.
**Preconditions:** Unit tests exist for EditorContextMenu.
**Steps:**
1. Run test coverage report
2. Check coverage for EditorContextMenu.tsx
**Expected Result:** >80% line/branch coverage for EditorContextMenu component.
**Traces to:** NFR-004, AC-010

## Definition of Done

- [ ] All 10 test cases pass
- [ ] EditorContextMenu component implemented
- [ ] At least 3 editor-specific prompt templates created (Elaborate, Modify, Ask)
- [ ] Unit tests achieve >80% coverage for EditorContextMenu
- [ ] Monaco's default context menu suppressed when custom menu shown
- [ ] Existing prompt infrastructure reused (no duplication)
- [ ] Code review completed
- [ ] Manual QA verification of all acceptance criteria

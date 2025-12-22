# Acceptance criteria

## Test cases

### 001-AC-001: SearchBar renders correctly

**Description**: Verify SearchBar component renders with all required elements.

**Steps**:
1. Open a markdown file in editor
2. Press Cmd/Ctrl+F

**Expected result**: SearchBar overlay appears at top-right with:
- Search input field (focused)
- Case sensitivity toggle (icon button)
- Whole word toggle (icon button)
- Match count display
- Previous/Next buttons
- Close button

**Traces to**: 001-FR-001

### 001-AC-002: SearchBar visual consistency

**Description**: Verify SearchBar looks identical across views.

**Steps**:
1. Open SearchBar in editor view
2. Screenshot or note visual appearance
3. Switch to preview mode
4. Open SearchBar in preview

**Expected result**: SearchBar styling (colors, spacing, layout) is identical in both views. No border-radius. Uses design tokens.

**Traces to**: 001-FR-001, 001-NFR-003

### 001-AC-003: Open search shortcut

**Description**: Verify Cmd/Ctrl+F opens SearchBar.

**Steps**:
1. Focus editor panel
2. Press Cmd+F (macOS) or Ctrl+F (Windows/Linux)

**Expected result**: SearchBar opens. Monaco's built-in search does NOT appear. Search input is focused.

**Traces to**: 001-FR-002

### 001-AC-004: Close and navigate shortcuts

**Description**: Verify Escape, Enter, Shift+Enter shortcuts.

**Steps**:
1. Open SearchBar and enter "test"
2. Press Enter multiple times
3. Press Shift+Enter
4. Press Escape

**Expected result**:
- Enter: Navigates to next match, updates match counter
- Shift+Enter: Navigates to previous match
- Escape: Closes SearchBar, clears highlights

**Traces to**: 001-FR-002

### 001-AC-005: Monaco search replaces built-in

**Description**: Verify Monaco's built-in search widget is disabled.

**Steps**:
1. Open a file in editor
2. Press Cmd+F
3. Observe search behavior
4. Try Cmd+G (find next in Monaco)

**Expected result**: Custom SearchBar appears, NOT Monaco's built-in. Cmd+G does not open Monaco search.

**Traces to**: 001-FR-003

### 001-AC-006: Monaco match highlighting

**Description**: Verify matches are highlighted in Monaco editor.

**Steps**:
1. Open file containing "function" multiple times
2. Open search, type "function"

**Expected result**: All occurrences highlighted with visible background. Current match has distinct styling.

**Traces to**: 001-FR-003, 001-FR-007

### 001-AC-007: Preview DOM search

**Description**: Verify search works in Markdown Preview.

**Steps**:
1. Open file with repeated text in preview mode
2. Open search, enter query

**Expected result**: Matches found in rendered preview content. Match count displayed correctly.

**Traces to**: 001-FR-004

### 001-AC-008: Preview match navigation

**Description**: Verify navigation scrolls to matches in preview.

**Steps**:
1. Open long markdown file in preview
2. Search for text near bottom
3. Click Next to navigate

**Expected result**: Preview scrolls to show highlighted match. Current match indicator updates.

**Traces to**: 001-FR-004

### 001-AC-009: Case sensitivity toggle

**Description**: Verify case sensitivity affects matches.

**Steps**:
1. Open file with "Test" and "test"
2. Search "test" with case sensitivity OFF
3. Toggle case sensitivity ON
4. Observe match count

**Expected result**:
- Case insensitive: Both "Test" and "test" matched
- Case sensitive: Only "test" matched

**Traces to**: 001-FR-005

### 001-AC-010: Whole word toggle

**Description**: Verify whole word affects matches.

**Steps**:
1. Open file with "test" and "testing"
2. Search "test" with whole word OFF
3. Toggle whole word ON

**Expected result**:
- Whole word OFF: Matches "test" and "testing"
- Whole word ON: Matches only "test" (not "testing")

**Traces to**: 001-FR-006

### 001-AC-011: Match highlight distinction

**Description**: Verify current match is visually distinct.

**Steps**:
1. Search text with multiple matches
2. Navigate between matches

**Expected result**: Current match has different background color than other matches. Distinction is clear.

**Traces to**: 001-FR-007

### 001-AC-012: Independent search state

**Description**: Verify search state does not persist across views.

**Steps**:
1. In editor, open search, enter "test"
2. Switch to preview mode
3. Open search in preview

**Expected result**: Search input is empty in preview. No highlights from editor search.

**Traces to**: 001-FR-008

### 001-AC-013: SearchProvider extensibility

**Description**: Verify new providers can be added without core changes.

**Steps**:
1. Review SearchProvider interface
2. Implement mock provider for test
3. Register with search system

**Expected result**: Mock provider works with SearchBar without modifying SearchBar or store code.

**Traces to**: 001-FR-009, 001-NFR-004

### 001-AC-014: Zustand store state management

**Description**: Verify search store manages state correctly.

**Steps**:
1. Open search, enter query
2. Toggle case sensitivity
3. Navigate matches
4. Inspect store state

**Expected result**: Store contains accurate query, toggle states, match count, current match index.

**Traces to**: 001-FR-010

### 001-AC-015: Search performance

**Description**: Verify search meets performance requirements.

**Steps**:
1. Open large file (10,000+ lines)
2. Measure time from typing to results displayed
3. Navigate matches rapidly

**Expected result**: Results appear within 100ms. No frame drops during navigation.

**Traces to**: 001-NFR-001

### 001-AC-016: Keyboard accessibility

**Description**: Verify full keyboard operation.

**Steps**:
1. Open SearchBar with keyboard
2. Tab through all controls
3. Activate toggles with Enter/Space
4. Test with screen reader if available

**Expected result**: All controls reachable via Tab. Toggles operable via keyboard. Focus visible.

**Traces to**: 001-NFR-002

### 001-AC-017: Design token compliance

**Description**: Verify SearchBar uses design tokens.

**Steps**:
1. Inspect SearchBar CSS
2. Check all color, spacing, typography values

**Expected result**: All values use CSS custom properties from design-tokens.css. No hardcoded values. border-radius: 0.

**Traces to**: 001-NFR-003

### 001-AC-018: Test coverage verification

**Description**: Verify minimum 80% test coverage.

**Steps**:
1. Run `npm run test:cov`
2. Check coverage for search-related files

**Expected result**: SearchBar, providers, and store have >= 80% line coverage.

**Traces to**: 001-NFR-005

### 001-AC-019: Content change re-search

**Description**: Verify search updates when content changes.

**Steps**:
1. Open file in editor, open search, enter query with matches
2. Note match count
3. Type additional text containing the search term
4. Wait 200ms

**Expected result**: Match count increases. New match is highlighted. No flash or stutter.

**Traces to**: 001-FR-003, 001-FR-004, 001-FR-012

### 001-AC-020: Split mode pane switching

**Description**: Verify search context switches between panes in split mode.

**Steps**:
1. Open file in split mode (editor + preview visible)
2. Click in editor pane, open search, enter "test"
3. Note matches in editor
4. Click in preview pane
5. Observe SearchBar position and state

**Expected result**:
- SearchBar moves to preview pane's top-right corner
- Preview pane's search state is shown (may be empty if not searched yet)
- Editor's search state is preserved (not cleared)
- Clicking back to editor restores editor's search state

**Traces to**: 001-FR-008, 001-FR-011

### 001-AC-021: File change closes search

**Description**: Verify search closes when switching files.

**Steps**:
1. Open file A in editor
2. Open search, enter query, observe matches
3. Open file B (different file)

**Expected result**:
- SearchBar closes automatically
- All highlights cleared
- Search state reset
- No residual search state in file B

**Traces to**: 001-FR-013

### 001-AC-022: Focus restoration on close

**Description**: Verify focus returns to previous element on close.

**Steps**:
1. Focus editor (cursor blinking in Monaco)
2. Open search (Cmd+F)
3. Verify focus is in search input
4. Press Escape

**Expected result**: Focus returns to Monaco editor. Cursor visible and blinking.

**Traces to**: 001-FR-014

### 001-AC-023: Error handling graceful degradation

**Description**: Verify search handles errors gracefully.

**Steps**:
1. Open file with complex content
2. Enter search query with special characters: `[test`
3. Observe behavior

**Expected result**:
- No crash or error dialog
- Special characters are escaped automatically
- Search finds literal `[test` text if present
- If not found, shows "No results"

**Traces to**: 001-NFR-006

## Definition of done

- [ ] SearchBar component implemented with all controls
- [ ] MonacoSearchProvider replaces built-in Monaco search (keybinding intercept verified)
- [ ] MarkdownPreviewSearchProvider highlights DOM content (CSS Highlight API + fallback)
- [ ] SearchProvider interface documented for extensibility
- [ ] Zustand store manages search state with resetSearch action
- [ ] All keyboard shortcuts functional (including focus trap)
- [ ] Split mode pane switching works correctly
- [ ] Content change triggers re-search with debouncing
- [ ] File change closes and resets search
- [ ] Focus management: trap while open, restore on close
- [ ] Error handling: graceful degradation verified
- [ ] Design token compliance verified
- [ ] Unit tests written with >= 80% coverage
- [ ] Manual testing completed for all acceptance criteria
- [ ] Documentation updated (if applicable)

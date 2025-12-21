# Acceptance

## Test cases

### TC-001: Search activation from editor

**Given** the editor pane is focused
**When** the user presses Cmd+F
**Then** the unified search bar appears at the top of the editor area
**And** the search input is focused
**And** the Monaco native find widget does not appear

### TC-002: Search activation from preview

**Given** the preview pane is focused
**When** the user presses Cmd+F
**Then** the unified search bar appears at the top of the editor area
**And** the search input is focused

### TC-003: Basic text search

**Given** the search bar is open
**And** the document contains the text "markdown" 5 times
**When** the user types "markdown" in the search input
**Then** all 5 occurrences are highlighted in the editor
**And** matching text in the preview is highlighted
**And** the match count shows "1 of N" where N is total matches

### TC-004: Match navigation forward

**Given** the search has found 5 matches
**And** the current match is 2 of 5
**When** the user presses Enter or clicks Next
**Then** the current match becomes 3 of 5
**And** the view scrolls to show match 3

### TC-005: Match navigation backward

**Given** the search has found 5 matches
**And** the current match is 3 of 5
**When** the user presses Shift+Enter or clicks Previous
**Then** the current match becomes 2 of 5
**And** the view scrolls to show match 2

### TC-006: Match navigation wrap-around

**Given** the search has found 5 matches
**And** the current match is 5 of 5
**When** the user presses Enter
**Then** the current match becomes 1 of 5

### TC-007: Case-sensitive search

**Given** the document contains "Test" and "test"
**When** the user searches for "Test" with case-sensitive enabled
**Then** only "Test" (capital T) is highlighted
**And** "test" (lowercase) is not highlighted

### TC-008: Whole-word search

**Given** the document contains "test" and "testing"
**When** the user searches for "test" with whole-word enabled
**Then** only "test" is highlighted
**And** "testing" is not highlighted

### TC-009: Close search with Escape

**Given** the search bar is open
**When** the user presses Escape
**Then** the search bar closes
**And** all highlights are removed from editor and preview
**And** focus returns to the previously focused pane

### TC-010: Close search with button

**Given** the search bar is open
**When** the user clicks the close button (X)
**Then** the search bar closes
**And** all highlights are removed

### TC-011: Empty search query

**Given** the search bar is open
**When** the search input is empty
**Then** no highlights are shown
**And** the match count shows "0 results" or is hidden

### TC-012: No matches found

**Given** the search bar is open
**When** the user searches for "xyznonexistent"
**Then** no highlights are shown
**And** the match count shows "0 of 0" or "No results"
**And** the search input may show a "not found" visual indicator

### TC-013: Special characters in search

**Given** the document contains the text "price: $100"
**When** the user searches for "$100"
**Then** the text "$100" is highlighted
**And** the dollar sign is treated as literal (not regex)

### TC-014: Preview highlight cleanup

**Given** search is active with matches highlighted in preview
**When** the user closes the search
**Then** all `<mark>` elements are removed from preview
**And** the original DOM structure is restored

### TC-015: Rapid query changes

**Given** the search bar is open
**When** the user types quickly, changing the query multiple times in <100ms
**Then** only the final query is searched (debounced)
**And** the UI remains responsive

### TC-016: Performance - large document

**Given** a document with 50,000 words
**When** the user performs a search
**Then** results appear within 100ms
**And** the UI does not freeze or become unresponsive

### TC-017: Design token compliance

**Given** the search bar component is rendered
**Then** all colors use CSS variables from design-tokens.css
**And** all spacing uses design token values
**And** border-radius is 0 on all elements
**And** focus states are visible

### TC-018: Accessibility - keyboard navigation

**Given** the search bar is open
**Then** all controls are reachable via Tab key
**And** each control has an aria-label
**And** Enter activates the focused button

### TC-019: Search state synchronization

**Given** the document contains "test" 3 times in editor content and 2 times in preview-only content (e.g., rendered heading anchors)
**When** the user searches for "test"
**Then** the match count shows "1 of 5" (combined total)
**And** matches in both editor and preview are highlighted
**And** clearing the search removes highlights from both views
**And** the same query is applied to both views simultaneously

## Definition of done

- [ ] All test cases pass
- [ ] Code follows Erfana coding standards (TypeScript strict, functional components)
- [ ] Unit test coverage exceeds 80% for search logic
- [ ] UI follows design tokens and style guide (verified visually)
- [ ] Accessibility audit passes (keyboard navigation, screen reader)
- [ ] Performance verified with 50,000 word document
- [ ] Code reviewed and approved
- [ ] Documentation updated (if applicable)
- [ ] No console errors or warnings in development mode

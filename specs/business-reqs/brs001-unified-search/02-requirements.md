# Requirements

## Functional requirements

### 001-FR-001: SearchBar overlay component

**Priority**: High

A shared SearchBar component shall render as an overlay positioned at the top-right of the active view panel. The component includes:
- Text input field for search query
- Case sensitivity toggle button
- Whole word toggle button
- Match count display (format: "X of Y")
- Previous/Next navigation buttons
- Close button

**Traces to**: 001-AC-001, 001-AC-002

### 001-FR-002: Keyboard shortcuts

**Priority**: High

The search overlay shall respond to standard keyboard shortcuts:
- Cmd+F (macOS) / Ctrl+F (Windows/Linux): Open search overlay in active view
- Escape: Close search overlay and clear highlights
- Enter: Navigate to next match
- Shift+Enter: Navigate to previous match

**Traces to**: 001-AC-003, 001-AC-004

### 001-FR-003: Monaco Editor search provider

**Priority**: High

A MonacoSearchProvider shall implement the SearchProvider interface to:
- Intercept Cmd/Ctrl+F before Monaco receives it (window-level capture phase listener added on component mount, before Monaco initializes)
- Monaco's built-in search widget shall never appear
- Execute find operations using Monaco's findMatches API
- Register decoration classes with Monaco's IModelDecorationOptions
- Highlight all matches with decorations (distinct styling for current vs other matches)
- Navigate between matches with cursor selection and viewport centering
- Re-execute search automatically when document content changes (debounced 200ms)

**Traces to**: 001-AC-005, 001-AC-006, 001-AC-019

### 001-FR-004: Markdown Preview search provider

**Priority**: High

A MarkdownPreviewSearchProvider shall implement the SearchProvider interface to:
- Search rendered DOM content using TreeWalker for efficient text node traversal
- Highlight matches using CSS Custom Highlight API (with CSS class fallback for older Chromium)
- Fallback shall NOT mutate DOM inside React tree (use ancestor class injection)
- Handle TextNode navigation correctly (traverse to parentElement for scrolling)
- Scroll active match into viewport center with smooth animation
- Navigate between matches sequentially
- Re-execute search automatically when preview content changes (debounced 200ms)

**Traces to**: 001-AC-007, 001-AC-008, 001-AC-019

### 001-FR-005: Case sensitivity toggle

**Priority**: Medium

When case sensitivity is enabled, search shall match exact character case. When disabled (default), search shall be case-insensitive. Toggle state is indicated visually in the SearchBar.

**Traces to**: 001-AC-009

### 001-FR-006: Whole word toggle

**Priority**: Medium

When whole word matching is enabled, search shall only match complete words bounded by word boundaries (spaces, punctuation, start/end of content). When disabled (default), partial matches are included.

**Traces to**: 001-AC-010

### 001-FR-007: Match highlighting

**Priority**: High

All matches shall be highlighted in the view:
- Editor: Monaco decorations with distinct background color
- Preview: Mark elements or highlight class on matched text nodes
- Current match shall have distinct styling from other matches

**Traces to**: 001-AC-011

### 001-FR-008: Independent view search state

**Priority**: Medium

Each view type (Monaco Editor, Markdown Preview) maintains separate search state:
- Each provider has its own query, matches, and currentIndex
- In split mode: clicking a pane switches to that pane's search context
- In split mode: SearchBar visually moves to the active (focused) pane
- Switching view mode (e.g., split→editor) preserves the active provider's state
- Search state is cleared only when SearchBar is explicitly closed (Escape)
- Closing search in one pane does not affect other panes' stored state

**Traces to**: 001-AC-012, 001-AC-020

### 001-FR-009: SearchProvider interface

**Priority**: High

An extensible SearchProvider interface shall define:
- `search(query: string, options: SearchOptions): SearchResult`
- `nextMatch(): void`
- `previousMatch(): void`
- `clearSearch(): void`
- `getMatchCount(): { current: number; total: number }`

New preview types implement this interface to gain search capability.

**Traces to**: 001-AC-013

### 001-FR-010: Zustand search store

**Priority**: Medium

Search state shall be managed via Zustand store containing:
- `query`: Current search string
- `isOpen`: SearchBar visibility per view
- `caseSensitive`: Case sensitivity toggle state
- `wholeWord`: Whole word toggle state
- `matchCount`: Total matches found
- `currentMatch`: Index of current match (1-based)

**Traces to**: 001-AC-014

### 001-FR-011: Split mode pane switching

**Priority**: Medium

In split view modes (vertical or horizontal), the search system shall:
- Track which pane (editor or preview) is currently active/focused
- Switch active provider when user clicks into a different pane
- Move SearchBar overlay to the active pane's top-right corner
- Preserve each pane's search state independently
- On pane switch: display the target pane's existing search state (if any)

**Traces to**: 001-AC-020

### 001-FR-012: Search behavior on content change

**Priority**: Medium

When document content changes while search is active:
- Re-execute search automatically with debounced delay (200ms)
- Update match count to reflect current content
- Preserve currentIndex if the match still exists
- Reset currentIndex to 0 if current match was deleted
- Clear highlights and re-apply for new matches

**Traces to**: 001-AC-019

### 001-FR-013: Search behavior on file change

**Priority**: Medium

When user opens a different file while search is active:
- Close SearchBar automatically
- Clear all search state (query, matches, highlights)
- Reset Zustand store to initial state
- Provider cleanup: call dispose() on active provider

**Traces to**: 001-AC-021

### 001-FR-014: Focus management

**Priority**: Medium

Focus shall be managed correctly throughout the search lifecycle:
- Opening search: focus the search input field immediately
- While open: Tab cycles through SearchBar controls (input → toggles → buttons)
- Closing search: return focus to the previously focused element (editor or preview)
- Focus trap: Tab shall not escape SearchBar while open

**Traces to**: 001-AC-016, 001-AC-022

## Non-functional requirements

### 001-NFR-001: Performance - Search responsiveness

**Priority**: High

Search operations shall complete within 100ms for documents up to 10,000 lines in editor or 50,000 DOM nodes in preview. Match highlighting shall not cause visible frame drops.

**Traces to**: 001-AC-015

### 001-NFR-002: Accessibility - Keyboard navigation

**Priority**: Medium

SearchBar shall be fully operable via keyboard. Focus shall move to search input when opened. Tab navigation shall cycle through SearchBar controls. Screen readers shall announce match counts.

**Traces to**: 001-AC-016

### 001-NFR-003: Visual consistency - Design tokens

**Priority**: High

SearchBar styling shall use ERFANA design tokens exclusively:
- Colors: `var(--color-bg-secondary)`, `var(--color-border-default)`, `var(--color-accent-primary)`
- Spacing: `var(--space-*)` tokens
- No border-radius (per UI style guide)

**Traces to**: 001-AC-017

### 001-NFR-004: Extensibility - Provider pattern

**Priority**: High

Adding a new preview type (e.g., HTML Preview) shall require only implementing SearchProvider interface without modifying SearchBar or search store.

**Traces to**: 001-AC-013

### 001-NFR-005: Maintainability - Test coverage

**Priority**: Medium

Search functionality shall have minimum 80% test coverage including:
- SearchBar component unit tests
- SearchProvider implementation tests
- Integration tests for keyboard shortcuts

**Traces to**: 001-AC-018

### 001-NFR-006: Error handling - Graceful degradation

**Priority**: Medium

Search operations shall fail gracefully:
- Invalid search patterns (special regex characters) shall be escaped automatically
- TreeWalker errors shall result in empty results (no crash)
- Monaco API errors shall be caught and logged, returning empty results
- No error UI shown for transient errors; only log to console
- Repeated failures (3+ in 10 seconds) may show a non-blocking toast notification

**Traces to**: 001-AC-023

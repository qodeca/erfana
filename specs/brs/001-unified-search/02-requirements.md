# Requirements

## Functional requirements

### FR-001: Unified search UI component

The system shall provide a search bar component with:
- Text input field for search query
- Match count display (e.g., "3 of 12")
- Previous/Next navigation buttons
- Close button (Escape or click)
- Case-sensitive toggle
- Whole-word toggle

### FR-002: Keyboard shortcut activation

The system shall open the unified search UI when:
- User presses Cmd+F (macOS) or Ctrl+F (Windows/Linux)
- Focus is in editor pane
- Focus is in preview pane
- Focus is elsewhere in the application (fallback to editor search)

### FR-003: Monaco editor integration

The system shall integrate with Monaco editor by:
- Using Monaco's `getModel().findMatches()` API for search
- Decorating matches with highlight styling
- Suppressing the native Monaco find widget (Cmd+F override)
- Scrolling to current match when navigating
- Restoring focus to editor after search closes

### FR-004: Preview pane search

The system shall search preview content by:
- Traversing visible DOM text nodes
- Injecting highlight `<mark>` elements around matches
- Preserving original DOM structure (cleanup on search close)
- Scrolling to current match when navigating
- Handling dynamic content (Mermaid diagrams excluded from text search)

### FR-005: Match navigation

The system shall support match navigation:
- Enter or Down arrow: next match
- Shift+Enter or Up arrow: previous match
- Navigation cycles through all matches (editor + preview)
- Current match has distinct "active" highlight style
- Match position indicator updates (e.g., "3 of 12")

### FR-006: Search state synchronization

The system shall synchronize search across views:
- Same query searches both editor and preview
- Match counts combine totals from both views
- Navigation order: editor matches first, then preview matches
- Clearing search removes highlights from both views

### FR-007: Search options

The system shall support search options:
- Case-sensitive matching (toggle button)
- Whole-word matching (toggle button)
- Options apply to both editor and preview searches
- Options persist during session (reset on app restart)

### FR-008: Extensibility

The system shall be extensible for future preview types:
- Define a `SearchProvider` interface with methods: `search(query, options): SearchMatch[]`, `highlight(matches)`, `clearHighlights()`, `scrollToMatch(index)`
- Provide a `SearchProviderRegistry` that allows registering providers by content type (e.g., 'monaco', 'preview-html', 'mermaid')
- Search coordinator iterates registered providers and aggregates results
- New preview types can implement `SearchProvider` and register without modifying core search logic

## Non-functional requirements

### NFR-001: Performance

- Search results shall appear within 100ms for documents up to 50,000 words
- UI shall remain responsive during search (no blocking)
- Highlight rendering shall not cause visible layout shifts

### NFR-002: UI design compliance

- All colors shall use design tokens from `design-tokens.css`
- All spacing shall use design token values
- Border radius shall be 0 (no rounded corners)
- Focus states shall be visible for accessibility
- Transitions shall use `var(--transition-normal)`

### NFR-003: Accessibility

- Search input shall be focusable via keyboard
- All controls shall have accessible labels (aria-label)
- Focus shall be trapped in search UI when open
- Escape key shall close search and restore previous focus
- Screen reader shall announce match count changes

### NFR-004: Reliability

- Search shall gracefully handle empty documents
- Search shall handle special regex characters in query (escape them)
- Preview highlight cleanup shall be complete (no orphaned marks)
- Component shall handle rapid query changes (debounce input)

### NFR-005: Maintainability

- Search logic shall be separated from UI components
- Monaco integration shall be isolated in dedicated hook/service
- Preview search shall be isolated in dedicated hook/service
- Unit test coverage shall exceed 80% for search logic

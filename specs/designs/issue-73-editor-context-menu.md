# Implementation Design: Issue #73 - Editor Context Menu with AI Prompts

## Issue Summary

**Issue:** #73 - Editor context menu with AI prompts
**Type:** Enhancement
**Complexity Tier:** 2 (Medium - reuses existing infrastructure with minimal new code)
**BRS Reference:** `specs/business-reqs/brs002-editor-context-menu/`

## Technical Approach

Create an `EditorContextMenu` component that mirrors `PreviewContextMenu`, leveraging existing `ContextMenu` base component, prompt registry filtering (`getPromptsForArea('code-editor', 'context-menu')`), and `executePromptTemplate()` infrastructure. The implementation intercepts Monaco's `onContextMenu` event to show our custom menu instead of Monaco's default.

## Design Decisions

1. **Component Placement:** Create dedicated `EditorContextMenu.tsx` in `ContextMenu/` folder (matches `PreviewContextMenu` pattern) rather than inline in Monaco component.
   - *Rationale:* Separation of concerns, testability, consistency with existing architecture.

2. **Monaco Integration Point:** Hook into `editor.onContextMenu()` event in `MonacoMarkdownEditor.tsx` and propagate context up to parent panel via callback.
   - *Rationale:* Keeps Monaco component focused on editing; context menu logic lives in parent panel like preview.

3. **State Management:** Track context menu state in `MarkdownEditorPanel` (matches preview context menu pattern).
   - *Rationale:* Consistent with existing architecture; context menu is a panel-level concern.

4. **Prompt Templates:** Create 3 new templates (`code-elaborate.md`, `code-modify.md`, `code-ask.md`) with `area: code-editor`.
   - *Rationale:* Editor prompts may need slightly different wording/focus than preview prompts. Separate templates allow future customization.

5. **Selection Source:** Use Monaco's selection directly (not from `selectedText` state) to ensure accuracy at right-click time.
   - *Rationale:* Avoids race conditions where state might be stale; gets selection at the moment of the context menu trigger.

## Data Flow

```
User Right-Clicks in Monaco Editor
           │
           ▼
MonacoMarkdownEditor.tsx
  1. editor.onContextMenu(e) fires
  2. Check if selection exists
  3. If no selection → return (allow Monaco default)
  4. e.event.preventDefault() + stopPropagation()
  5. Call onContextMenu callback with { x, y, selection, range }
           │
           ▼
MarkdownEditorPanel.tsx
  1. Receives onContextMenu callback
  2. Sets state: { showContextMenu, menuPosition, menuSelection }
  3. Conditionally renders <EditorContextMenu />
           │
           ▼
EditorContextMenu.tsx
  1. Calls getPromptsForArea('code-editor', 'context-menu')
  2. Maps prompts to ContextMenuItem[]
  3. Adds "Copy Selection" item
  4. Renders <ContextMenu />
           │
           ▼
User Selects a Prompt
  1. If requiresInput: showPrompt() dialog → get userInput
  2. Build PromptVariables with selectedText, filePath, lines
  3. Call executePromptTemplate(promptId, variables)
  4. Schedule terminal scroll
  5. Close context menu
```

## Changes Required

### New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `src/renderer/src/components/ContextMenu/EditorContextMenu.tsx` | Editor-specific context menu | ~150 |
| `src/renderer/src/components/ContextMenu/EditorContextMenu.test.tsx` | Unit tests | ~200 |
| `src/renderer/src/prompts/templates/code-elaborate.md` | Elaborate prompt | ~35 |
| `src/renderer/src/prompts/templates/code-modify.md` | Modify prompt | ~40 |
| `src/renderer/src/prompts/templates/code-ask.md` | Ask prompt | ~40 |

### Modified Files

| File | Changes | Est. Lines |
|------|---------|------------|
| `src/renderer/src/components/Editor/MonacoMarkdownEditor.tsx` | Add `onContextMenu` prop and handler | +30 |
| `src/renderer/src/components/Panels/MarkdownEditorPanel.tsx` | Add context menu state and render | +50 |

**Total:** ~550 new lines

## Implementation Order

```
Phase 1: Prompt Templates (no dependencies)
├── code-elaborate.md
├── code-modify.md
└── code-ask.md

Phase 2: Monaco Integration (depends on Phase 1)
└── MonacoMarkdownEditor.tsx - add onContextMenu prop/handler

Phase 3: EditorContextMenu Component (depends on Phase 2)
├── EditorContextMenu.tsx
└── EditorContextMenu.test.tsx

Phase 4: Panel Integration (depends on Phase 3)
└── MarkdownEditorPanel.tsx - state + render

Phase 5: Final Testing & Polish
├── Manual QA (all 10 TC cases)
└── Coverage verification (>80%)
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Monaco default menu still appears | Use both `preventDefault()` and `stopPropagation()` |
| Selection state race condition | Get selection directly from Monaco at event time |
| Menu positioned off-screen | Reuse ContextMenu viewport boundary detection |
| Prompt templates not discovered | Templates auto-discovered via Vite glob |

## Security Considerations

- **Input Sanitization:** All user input passes through existing template sanitization
- **Selected Text Escaping:** Handlebars auto-escapes by default
- **File Path Validation:** Path from current file state, already validated

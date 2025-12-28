# adr-c001-markdown-editor-panel-decomposition
**Date:** 2025-12 | **Status:** Proposed

## Context

The `MarkdownEditorPanel.tsx` component (1343 lines) has grown into a "God Component" with multiple responsibilities, making it difficult to maintain, test, and reason about. While previous refactoring extracted pure logic to `markdownEditorPanel.logic.ts` (591 lines) and created `useAutoSave.ts` and `useFileWatcher.ts` hooks, the main component still violates the Single Responsibility Principle.

**Current pain points:**
- Large file requires full context for AI tools (token-inefficient)
- Multiple concerns interleaved: file operations, scroll sync, search, export, toolbar, keyboard shortcuts
- Testing requires complex mocking due to tight coupling
- New developers face steep learning curve

**Existing patterns in codebase:**
- Pure logic extraction to `.logic.ts` files (83+ functions across codebase)
- Custom hooks in `src/renderer/src/hooks/` (18+ hooks)
- Component folders with CSS modules
- Zustand stores for cross-component state

## Options

| Option | Pros | Cons |
|--------|------|------|
| **1. Vertical slicing by feature** | Clear boundaries, independent development | Some shared state complexity |
| **2. Container/Presenter pattern** | Clean separation of logic/UI | Deep prop drilling |
| **3. Render props/HOC composition** | Maximum flexibility | Complex mental model |
| **4. Custom hooks + smaller components** | Follows existing patterns, testable | Requires careful state coordination |

## Decision

**Option 4: Custom hooks + smaller components** - aligns with existing codebase patterns and provides the best balance of maintainability, testability, and gradual migration.

### Proposed file structure

```
src/renderer/src/components/Editor/
├── MarkdownEditorPanel/
│   ├── index.ts                          # Re-exports (public API)
│   ├── MarkdownEditorPanel.tsx           # Container (~200 lines)
│   ├── MarkdownEditorPanel.css           # Existing styles
│   │
│   ├── components/
│   │   ├── EditorToolbar.tsx             # Formatting buttons + view mode toggles (~120 lines)
│   │   ├── EditorStatusBar.tsx           # Document stats + selection info (~60 lines)
│   │   ├── EditorPaneLayout.tsx          # Split view rendering logic (~150 lines)
│   │   ├── FileConflictBanner.tsx        # Conflict/deleted file warnings (~40 lines)
│   │   └── ExportMenu.tsx                # PDF/DOCX export buttons (~80 lines)
│   │
│   ├── hooks/
│   │   ├── useScrollSync.ts              # Scroll synchronization (~180 lines)
│   │   ├── useEditorKeyboard.ts          # Keyboard shortcuts (~80 lines)
│   │   ├── useEditorSearch.ts            # Search provider integration (~60 lines)
│   │   ├── useExport.ts                  # PDF/DOCX export logic (~120 lines)
│   │   ├── useDividerPosition.ts         # Resizable divider state (~40 lines)
│   │   └── useEditorState.ts             # Core editor state management (~100 lines)
│   │
│   ├── logic/
│   │   └── markdownEditorPanel.logic.ts  # (existing, moved here)
│   │
│   └── types.ts                          # Shared interfaces (~50 lines)
│
├── MonacoMarkdownEditor/                  # (existing, unchanged)
└── MarkdownPreview/                       # (existing, unchanged)
```

### Extraction priority (highest impact first)

**Phase 1: Immediate high-impact extractions**

| Extraction | Lines saved | Impact | Reason |
|------------|-------------|--------|--------|
| `useScrollSync` hook | ~180 | **High** | Complex scroll sync logic (lines 302-607) is self-contained |
| `EditorToolbar` component | ~120 | **High** | Toolbar JSX (lines 1023-1177) is purely presentational |
| `useExport` hook | ~120 | **Medium** | Export handlers (lines 754-903) are isolated |

**Phase 2: Secondary extractions**

| Extraction | Lines saved | Impact | Reason |
|------------|-------------|--------|--------|
| `EditorStatusBar` component | ~60 | **Low** | Clean extraction (lines 1289-1324) |
| `useDividerPosition` hook | ~40 | **Low** | localStorage + state (lines 116-127, 729-744) |
| `EditorPaneLayout` component | ~150 | **Medium** | Complex JSX but requires props threading |
| `useEditorKeyboard` hook | ~80 | **Medium** | Keyboard shortcuts (lines 533-566) |

### Detailed extraction patterns

#### 1. useScrollSync hook (highest priority)

**Problem:** 300+ lines of scroll synchronization logic mixed with component lifecycle.

**Pattern:**
```typescript
// hooks/useScrollSync.ts
export interface UseScrollSyncOptions {
  editorRef: RefObject<MonacoEditorHandle>
  previewRef: RefObject<HTMLDivElement>
  viewMode: ViewMode
  isEditorReady: boolean
  content: string | undefined
}

export interface UseScrollSyncReturn {
  scrollMapRef: RefObject<ScrollMapEntry[]>
  rebuildScrollMap: () => void
}

export function useScrollSync(options: UseScrollSyncOptions): UseScrollSyncReturn {
  // Move all scroll map building and sync logic here
  // Lines 134-137, 302-448, 476-607 from MarkdownEditorPanel.tsx
}
```

**Benefits:**
- Fully testable without React component overhead
- Reusable if other panels need scroll sync
- Clear interface contract

#### 2. EditorToolbar component (highest priority)

**Problem:** 150+ lines of toolbar JSX cluttering the main component.

**Pattern:**
```typescript
// components/EditorToolbar.tsx
interface EditorToolbarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  isModified: boolean
  isAutoSaving: boolean
  isReloading: boolean
  editorRef: RefObject<MonacoEditorHandle>
  onExportPdf: () => void
  onExportDocx: () => void
  isExportingPdf: boolean
  isExportingDocx: boolean
  hasFile: boolean
}

export function EditorToolbar(props: EditorToolbarProps): JSX.Element {
  // Move toolbar JSX here (lines 1022-1177)
}
```

**Benefits:**
- Pure presentational component, easily testable
- Props interface documents all dependencies
- Can be tested in isolation with Storybook

#### 3. useExport hook (medium priority)

**Problem:** Export logic (PDF/DOCX) is self-contained but adds 150 lines.

**Pattern:**
```typescript
// hooks/useExport.ts
interface UseExportOptions {
  previewHandleRef: RefObject<MarkdownPreviewHandle>
  currentFile: EditorFile | null
  showToast: (options: ToastOptions) => void
}

interface UseExportReturn {
  handleExportPdf: () => Promise<void>
  handleExportDocx: () => Promise<void>
  isExportingPdf: boolean
  isExportingDocx: boolean
}

export function useExport(options: UseExportOptions): UseExportReturn {
  // Move lines 754-903 here
}
```

### State coordination strategy

The main component becomes a thin orchestrator:

```typescript
// MarkdownEditorPanel.tsx (~200 lines)
export function MarkdownEditorPanel(props: IDockviewPanelProps<EditorParams>) {
  // Core state (from useEditorState hook)
  const editorState = useEditorState(props)

  // Feature hooks
  const scrollSync = useScrollSync({ ... })
  const exportFns = useExport({ ... })
  const divider = useDividerPosition()
  const keyboard = useEditorKeyboard({ ... })

  // Existing hooks (already extracted)
  const autoSave = useAutoSave(...)
  const fileWatcher = useFileWatcher(...)

  return (
    <div className="markdown-editor-panel">
      <EditorToolbar {...toolbarProps} />
      <FileConflictBanner {...bannerProps} />
      <EditorPaneLayout {...layoutProps} />
      <EditorStatusBar {...statsProps} />
      {editorContextMenu && <EditorContextMenu {...menuProps} />}
    </div>
  )
}
```

## Consequences

### Positive
- **Token efficiency:** AI tools can work with ~200 line files instead of 1343 lines
- **Testability:** Each hook/component can be unit tested in isolation
- **Maintainability:** Changes to scroll sync don't risk breaking export logic
- **Discoverability:** New developers can understand one piece at a time
- **Consistency:** Follows existing patterns (useAutoSave, useFileWatcher, .logic.ts)

### Negative
- **Initial overhead:** Refactoring requires careful prop threading
- **State coordination:** Multiple hooks sharing refs needs documentation
- **Migration risk:** Must be done incrementally to avoid regressions

### Migration path

1. **Week 1:** Extract `useScrollSync` (highest complexity, highest value)
2. **Week 2:** Extract `EditorToolbar` + `EditorStatusBar` (low risk, visible progress)
3. **Week 3:** Extract `useExport` + remaining hooks
4. **Week 4:** Create `EditorPaneLayout` component (most complex JSX refactoring)

### Testing strategy

Each extraction should include:
1. Unit tests for the extracted hook/component
2. Integration test with MarkdownEditorPanel
3. Verify no visual regression in development

### Enforcement

- New features in editor area should be added to appropriate sub-module
- PR review should flag additions to main MarkdownEditorPanel.tsx
- Components exceeding 300 lines should trigger refactoring discussion

## Appendix: Responsibility analysis

### Current responsibilities in MarkdownEditorPanel.tsx

| Responsibility | Lines | Coupling |
|----------------|-------|----------|
| File loading/saving | 632-710 | High (state, watcher) |
| Scroll synchronization | 134-137, 302-607 | Medium (refs only) |
| View mode management | 53, 116-127, 284-300 | Low |
| Toolbar rendering | 1022-1177 | Low (presentational) |
| Export (PDF/DOCX) | 139-143, 754-903 | Low |
| Status bar rendering | 1289-1324 | Low (presentational) |
| Keyboard shortcuts | 533-566 | Medium |
| Search integration | 154-175, 1096-1122 | Medium |
| Context menu handling | 58-64, 909-965 | Low |
| Pane layout rendering | 1198-1281 | High (complex conditionals) |

### Which responsibilities to extract first

**Extract first (low coupling, high LOC):**
1. Scroll sync (300+ lines, medium coupling, self-contained)
2. Toolbar (150 lines, low coupling, pure presentation)
3. Export (150 lines, low coupling, async operations)

**Extract later (high coupling, requires careful design):**
4. Pane layout (complex JSX, many prop dependencies)
5. File operations (already uses hooks, but core to component)

## Medium Priority Issues (P2 - Next Quarter)

### ISSUE-9: 🟡 Excessive Component Complexity

**Severity:** MEDIUM
**Priority:** P2
**Impact:** Difficult maintenance, hard to test, high cognitive load
**Effort:** 1 week

**Evidence:**

**MarkdownEditorPanel.tsx: 1,119 lines, 32 hooks**

Breakdown:
- 15+ useEffect blocks
- Complex scroll synchronization (100+ lines)
- File watching integration (50+ lines)
- Auto-save mechanism (40+ lines)
- Multiple split modes (60+ lines)
- Toolbar actions (80+ lines)
- Context menu handling (40+ lines)
- Statistics calculation (30+ lines)

**ProjectTree.tsx: 1,025 lines**

Complexity:
- Recursive tree rendering
- Drag & drop logic (120+ lines)
- Context menu handling (80+ lines)
- File operations (CRUD) (150+ lines)
- Expanded state management (60+ lines)
- Watcher integration (40+ lines)

**Files Affected:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/Panels/MarkdownEditorPanel.tsx` (1,119 lines)
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/ProjectTree/ProjectTree.tsx` (1,025 lines)

**Impact:**
1. Difficult to understand and modify
2. Hard to test thoroughly
3. High risk of regressions
4. Slow code reviews
5. Performance issues from unnecessary re-renders

**Recommendations:**

1. **Extract MarkdownEditorPanel to smaller components** (3 days):
   ```typescript
   // components/Editor/
   ├── MarkdownEditorPanel.tsx (150 lines) - Container
   ├── EditorToolbar.tsx (80 lines) - Formatting toolbar
   ├── EditorStatusBar.tsx (40 lines) - Stats & info
   ├── EditorSplitView.tsx (100 lines) - Split layout logic
   ├── hooks/
   │   ├── useEditorFile.ts (60 lines) - File loading/saving
   │   ├── useScrollSync.ts (120 lines) - Scroll synchronization
   │   ├── useAutoSave.ts (50 lines) - Auto-save logic
   │   ├── useFileWatcher.ts (60 lines) - File watching
   │   └── useEditorToolbar.ts (40 lines) - Toolbar actions
   ```

2. **Extract ProjectTree file operations** (2 days):
   ```typescript
   // hooks/useFileOperations.ts
   export function useFileOperations(projectPath: string) {
     const createFile = useCallback(async (parentPath: string, name: string) => {
       // ... implementation
     }, [projectPath])

     const deleteFile = useCallback(async (path: string) => {
       // ... implementation
     }, [projectPath])

     const renameFile = useCallback(async (oldPath: string, newPath: string) => {
       // ... implementation
     }, [projectPath])

     return { createFile, deleteFile, renameFile }
   }
   ```

3. **Use composition over monolithic components** (2 days):
   ```typescript
   // Before: 1,119 lines
   export function MarkdownEditorPanel() {
     // Everything in one component
   }

   // After: Composed from smaller parts
   export function MarkdownEditorPanel() {
     return (
       <EditorContainer>
         <EditorToolbar />
         <EditorSplitView>
           <MonacoEditor />
           <MarkdownPreview />
         </EditorSplitView>
         <EditorStatusBar />
         <FileWatcherNotifications />
       </EditorContainer>
     )
   }
   ```

**Success Criteria:**
- No component >300 lines
- No more than 10 hooks per component
- Each component has single responsibility
- Easy to understand and test
- Better performance from memoization

---

### ISSUE-10: 🟡 Zustand Store Architecture Issues

**Severity:** MEDIUM
**Priority:** P2
**Impact:** State management complexity, testing difficulty
**Effort:** 5 days

**Evidence:**

**Problem 1: Direct store mutation outside actions**

```typescript
// AppDockLayout.tsx:143
useProjectStore.getState().setDockviewApi(api)
// ❌ Bypasses React rendering, no DevTools visibility
```

**Problem 2: Mixing UI and domain state**

```typescript
// useProjectStore.ts
interface ProjectState {
  dockviewApi: DockviewApi | null  // ❌ UI framework reference
  editorPanelIds: Set<string>      // ✅ Domain state
  dirtyPanelIds: Set<string>       // ✅ Domain state
}
```

**Problem 3: No store persistence for editor state**

```typescript
// useActivityBarStore.ts - Persisted
persist(
  (set, get) => ({ /* ... */ }),
  { name: 'activity-bar-storage' }
)

// useProjectStore.ts - NOT persisted
// Open tabs, scroll positions lost on crash
```

**Files Affected:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/stores/useProjectStore.ts`
- `/Users/marcinobel/Projects/erfana/src/renderer/src/stores/useActivityBarStore.ts`
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/DockLayout/AppDockLayout.tsx:143`

**Recommendations:**

1. **Separate UI and domain stores** (2 days):
   ```typescript
   // stores/uiStore.ts - UI framework state
   export const useUIStore = create<UIState>((set) => ({
     dockviewApi: null,
     splitviewApi: null,

     setDockviewApi: (api) => set({ dockviewApi: api }),
     setSplitviewApi: (api) => set({ splitviewApi: api })
   }))

   // stores/projectStore.ts - Pure domain state
   export const useProjectStore = create(
     persist<ProjectState>(
       (set) => ({
         openFiles: [],
         dirtyFiles: new Set(),
         currentFile: null,

         openFile: (path) => set((state) => ({
           openFiles: [...state.openFiles, path]
         })),

         closeFile: (path) => set((state) => ({
           openFiles: state.openFiles.filter(f => f !== path)
         }))
       }),
       { name: 'project-store' }
     )
   )
   ```

2. **Add DevTools middleware** (1 day):
   ```typescript
   import { devtools } from 'zustand/middleware'

   export const useProjectStore = create(
     devtools(
       persist(
         (set) => ({ /* ... */ }),
         { name: 'project-store' }
       ),
       { name: 'Project Store' }
     )
   )

   // Enable in development
   if (import.meta.env.DEV) {
     // Redux DevTools will show Zustand state
   }
   ```

3. **Implement session restoration** (2 days):
   ```typescript
   // stores/editorSessionStore.ts
   export const useEditorSessionStore = create(
     persist<EditorSessionState>(
       (set) => ({
         openTabs: [],
         activeTab: null,
         tabScrollPositions: {},
         tabCursorPositions: {},

         saveSession: () => {
           const state = useEditorSessionStore.getState()
           // Save to electron-store
           window.api.settings.saveEditorSession({
             openTabs: state.openTabs,
             activeTab: state.activeTab,
             positions: state.tabScrollPositions
           })
         },

         restoreSession: async () => {
           const session = await window.api.settings.loadEditorSession()
           set({
             openTabs: session.openTabs,
             activeTab: session.activeTab,
             tabScrollPositions: session.positions
           })
         }
       }),
       {
         name: 'editor-session',
         partialize: (state) => ({
           // Only persist essential data
           openTabs: state.openTabs,
           activeTab: state.activeTab
         })
       }
     )
   )

   // On app startup:
   useEffect(() => {
     useEditorSessionStore.getState().restoreSession()
   }, [])

   // On app close:
   window.addEventListener('beforeunload', () => {
     useEditorSessionStore.getState().saveSession()
   })
   ```

**Success Criteria:**
- UI state separated from domain state
- All stores use DevTools for debugging
- Editor session persisted and restored
- No direct `getState()` calls in components
- Store actions are pure functions

---

(Continuing with remaining issues in next section...)

---

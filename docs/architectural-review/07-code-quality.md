## Code Smell Analysis

### SMELL-1: God Object (MarkdownEditorPanel)

**Location:** `src/renderer/src/components/Panels/MarkdownEditorPanel.tsx`
**Lines:** 1,119
**Smell:** Single component doing too many things

**Responsibilities:**
1. File loading/saving
2. Monaco editor integration
3. Markdown preview rendering
4. Scroll synchronization
5. Split view management
6. Toolbar actions
7. Auto-save mechanism
8. File watching
9. Statistics calculation
10. Context menu handling
11. Keyboard shortcuts
12. Conflict resolution

**Recommendation:** Split into 4-5 focused components (see ISSUE-9)

---

### SMELL-2: Magic Numbers Everywhere

**Evidence:**

```typescript
// FileWatcherService.ts
private readonly DEBOUNCE_DELAY = 300  // Why 300?
private readonly MAX_WATCHED_FILES = 100  // Why 100?

// DirectoryWatcherService.ts
private readonly DEBOUNCE_DELAY = 1000  // Why 1000?
private readonly MIN_EVENTS_FOR_BULK = 5  // Why 5?

// TerminalPanel.tsx
const IDLE_TIMEOUT = 20000  // 20 seconds - Why?
const WARM_UP_PERIOD = 500  // 500ms - Why?

// MarkdownEditorPanel.tsx
const saved = localStorage.getItem('markdown-editor-divider-position')
return saved ? parseFloat(saved) : 50  // Why 50%?
```

**Impact:**
- Hard to tune performance
- Configuration scattered
- No documentation for values
- Difficult to test with different values

**Recommendation:**
```typescript
// src/config/constants.ts
export const WATCHER_CONFIG = {
  FILE_DEBOUNCE_MS: 300,  // Responsive for single file edits
  DIRECTORY_DEBOUNCE_MS: 1000,  // Batches git operations
  MAX_WATCHED_FILES: 100,  // Memory limit
  BULK_THRESHOLD: 5  // Events/sec to trigger bulk mode
} as const

export const TERMINAL_CONFIG = {
  IDLE_TIMEOUT_MS: 20_000,  // 20s of no I/O marks idle
  WARM_UP_MS: 500  // Wait for shell RC files
} as const

export const EDITOR_CONFIG = {
  DEFAULT_SPLIT_POSITION: 50,  // 50% vertical split
  AUTO_SAVE_DELAY_MS: 2000  // 2s debounce
} as const
```

---

### SMELL-3: Excessive Console Logging

**Evidence:**

```bash
$ grep -rn "console\.log\|console\.error\|console\.warn" src/main/services/*.ts | wc -l
47  # 47 console statements across 5 service files
```

**Examples:**
```typescript
// FileWatcherService.ts
this.safeLog('👁️  Starting watch for:', filePath)
this.safeLog('⏸️  Paused watch for:', filePath)
this.safeLog('▶️  Resumed watch for:', filePath)
this.safeLog('🔇 Stopped watch for:', filePath)

// DirectoryWatcherService.ts
this.safeLog('📁 Starting directory watch for:', dirPath)
console.log('📁 Directory changed, refreshing project tree...')
```

**Problems:**
- Every event logs (high frequency noise)
- No log levels (can't filter INFO vs ERROR)
- Emoji cute but not parseable
- No log rotation (unbounded growth)
- Performance impact in tight loops
- Logs lost after app close

**Recommendation:** See ISSUE-7 (structured logging with winston)

---

### SMELL-4: Long Parameter Lists

**Evidence:**

```typescript
// TerminalService.ts:172
private async verifyAndSetCwd(
  terminal: { id: string; ptyProcess: IPty; cwd: string },  // Object parameter
  shell: string
): Promise<void>

// FileWatcherService.ts:89
async watchFile(filePath: string, webContents: WebContents): Promise<void>

// DirectoryWatcherService.ts:91
async watchDirectory(dirPath: string, webContents: WebContents): Promise<void>
```

**Better:**
```typescript
interface WatchRequest {
  path: string
  webContents: WebContents
  options?: {
    debounceMs?: number
    ignoreInitial?: boolean
  }
}

async watchFile(request: WatchRequest): Promise<void>
```

---

### SMELL-5: Primitive Obsession

**Evidence:**

```typescript
// Paths passed as strings everywhere
async readFile(filePath: string): Promise<string>
async watchFile(filePath: string, webContents: WebContents): Promise<void>

// Should be:
class FilePath {
  constructor(
    private readonly path: string,
    private readonly projectRoot: string
  ) {
    this.validate()
  }

  private validate(): void {
    if (!this.path.startsWith(this.projectRoot)) {
      throw new Error('Path outside project')
    }
  }

  toString(): string {
    return this.path
  }

  isMarkdown(): boolean {
    return this.path.endsWith('.md')
  }
}

async readFile(filePath: FilePath): Promise<string>
```

---

### SMELL-6: Feature Envy

**Evidence:**

```typescript
// AppDockLayout.tsx accessing ProjectStore internals
const handleEditorPanelClose = (id: string) => {
  const panel = dockviewApi?.getPanel(id)
  const { editorPanelIds, removeEditorPanel } = useProjectStore.getState()

  if (editorPanelIds.has(id)) {
    removeEditorPanel(id)
  }
}

// Better: Store should handle this
const handleEditorPanelClose = (id: string) => {
  useProjectStore.getState().closeEditorPanel(id, dockviewApi)
}
```

---

### SMELL-7: Shotgun Surgery

**Evidence:**

To add a new IPC channel, must modify 4 files:
1. `src/preload/index.ts` - Add to API
2. `src/main/ipc/*-handlers.ts` - Add handler
3. `src/main/index.ts` - Register handler
4. `src/preload/index.d.ts` - Add TypeScript definition

**Better:**
```typescript
// Auto-register handlers
// src/main/ipc/index.ts
export function registerAllHandlers() {
  const handlers = import.meta.glob('./*-handlers.ts', { eager: true })

  for (const [path, module] of Object.entries(handlers)) {
    if (typeof module.register === 'function') {
      module.register()
    }
  }
}

// Each handler file exports register function
export function register() {
  ipcMain.handle('file:readFile', handleReadFile)
  ipcMain.handle('file:writeFile', handleWriteFile)
}
```

---

### SMELL-8: Callback Hell (avoided, but complex promises)

**Evidence:**

```typescript
// MarkdownEditorPanel.tsx - Complex promise chains
useEffect(() => {
  if (!currentFile?.path) return

  window.api.file.readFile(currentFile.path)
    .then(content => {
      setCurrentFile({ ...currentFile, content })
      return window.api.fileWatch.start(currentFile.path)
    })
    .then(() => {
      console.log('File watching started')
    })
    .catch(error => {
      console.error('Error loading file:', error)
    })
}, [currentFile])
```

**Better (async/await):**
```typescript
useEffect(() => {
  if (!currentFile?.path) return

  const loadFile = async () => {
    try {
      const content = await window.api.file.readFile(currentFile.path)
      setCurrentFile({ ...currentFile, content })

      await window.api.fileWatch.start(currentFile.path)
      console.log('File watching started')
    } catch (error) {
      console.error('Error loading file:', error)
    }
  }

  loadFile()
}, [currentFile])
```

---

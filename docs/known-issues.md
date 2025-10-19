# Known Issues & Workarounds

## Resolved Issues

### ✅ Terminal Scroll Jump During Streaming (RESOLVED in v0.3.1)

**Previous Issue**: Terminal viewport jumps to top during Claude CLI streaming output, disrupting user experience during long-running commands.

**Root Cause**: Claude CLI buffer redraws override xterm.js scroll position preservation.

**Solution**: Multi-layered fix implemented in v0.3.1:
1. Scroll position tracking using Buffer API (`viewportY` vs `baseY`)
2. Terminal options: `scrollOnUserInput: false`, `smoothScrollDuration: 0`
3. CSS fix: `overflow-y: auto` instead of forced scrollbars
4. Comprehensive test coverage (6 tests in TerminalPanel.scroll.test.tsx)

**Implementation Files**:
- `TerminalPanel.tsx:300-314` - Scroll tracking logic
- `TerminalPanel.css:69` - Viewport styling
- `TerminalPanel.scroll.test.tsx` - Test coverage

**Related Issues**:
- https://github.com/anthropics/claude-code/issues/826
- https://github.com/anthropics/claude-code/issues/1413
- https://github.com/anthropics/claude-code/issues/1426

**Status**: ✅ Terminal now preserves scroll position during streaming output.

See: [Terminal - Terminal Scroll Fix](./terminal.md#terminal-scroll-fix-v031)

---

### ✅ Panel Resizing (RESOLVED in v0.1.0, Commit 4ff94cb)

**Previous Issue**: Panels showed resize cursor but didn't actually resize. Users could see the resize handle but dragging it had no effect.

**Root Cause**: Was using DockviewReact for basic 3-column layout (not its intended purpose). All panels had `flexGrow: 0`, breaking flex layout and preventing proper space distribution.

**Solution**: Refactored to hybrid SplitviewReact (outer layout) + DockviewReact (editor tabs only). Now matches VS Code architecture pattern.

**Status**: ✅ All panels now resize correctly with working drag handles.

See: [Architecture - Hybrid Layout Architecture](./architecture.md#hybrid-layout-architecture)

---

### ✅ Monaco Editor CDN Loading (RESOLVED, Commit 121fbb6)

**Previous Issue**: Monaco Editor was loading web workers from CDN (`cdn.jsdelivr.net`) which caused Content Security Policy violations in Electron, resulting in the editor showing "Loading..." indefinitely and never rendering.

**Solution**: Configured Monaco loader to use local bundling instead of CDN:

```typescript
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Configure Monaco to use local files instead of CDN
// This prevents CSP violations in Electron
loader.config({ monaco })
```

**Status**: ✅ Editor now loads properly without CSP violations. Offline mode works correctly.

---

### ✅ Panel Protection (RESOLVED in v0.1.0, Commit 4ff94cb)

**Previous Issue**: Multiple attempts to hide close buttons on protected panels (Project, Git, Terminal) failed. Used wrong CSS class selectors and required multiple setTimeout calls.

**Solution**: New SplitviewReact architecture renders sidebar panels differently. Panel protection is now handled through the splitview API's visibility control rather than hiding close buttons.

**Status**: ✅ Panel visibility managed through Zustand store and SplitviewApi.

See: [UI Components - Panel Toggle System](./ui-components.md#panel-toggle-system)

---

### ✅ Scroll Synchronization (RESOLVED in v0.3.0, Commit 4cd79a8)

**Previous Issue**: Editor and preview panes in split view didn't synchronize scrolling, especially when switching between split modes.

**Solution (v0.2)**: Implemented bidirectional scroll synchronization using:
- Line-to-pixel mapping via `data-line` attributes
- React-markdown's `node.position` API for AST line numbers
- Linear interpolation for smooth scrolling between known points
- 50ms debouncing to prevent scroll loops
- Proper React ref handling to avoid re-render issues

**Latest Fix (v0.3+, Commit 4cd79a8)**: Resolved race condition when switching split modes:
- Force component remounting with React keys: `key={`editor-${viewMode}`}`
- Immediate scroll map building in `handleEditorMount()` when in split mode
- Simplified listener attachment (removed complex polling mechanism)
- Added comprehensive debugging logging with emoji-prefixed console output

**Status**: ✅ Editor ↔ Preview scrolling now fully synchronized, including during split mode transitions.

See: [Scroll Synchronization](./editor/scroll-sync.md)

---

### ✅ Plain Code Block Rendering (RESOLVED in v0.3.0, Commit 4ccd42f)

**Previous Issue**: Code blocks without language identifiers (``` without language) were rendering line-by-line instead of as unified blocks, creating visual gaps between each line.

**Root Cause**: Inline code detection logic was incorrect:
```typescript
// WRONG: Treated all code blocks without language as inline
const isInline = !match && !className?.includes('language-')
```

This caused plain code blocks to be treated as inline code, rendering each line separately instead of as a single `<pre>` block.

**Solution**: Improved detection to check for newlines:
```typescript
// CORRECT: Only treats single-line code without className as inline
const isInline = !className && typeof children === 'string' && !children.includes('\n')
```

**Status**: ✅ Plain code blocks now render as unified blocks. Block code (with newlines) renders as `<pre>`, inline code (no newlines) renders as `<code>`.

See: [Markdown Preview](./editor/markdown-preview.md)

---

### ✅ EPIPE Errors During Shutdown (RESOLVED in v0.4.0)

**Previous Issue**: Application crashed with "write EPIPE" errors during cleanup, especially when closing the app with active terminal instances.

**Root Cause**: Console.log and stream write operations continued after stdout/stderr were closed during the shutdown sequence. This happened in three scenarios:
1. Process cleanup during `app.on('before-quit')`
2. Child process (Terminal PTY) unexpected termination
3. Renderer process closing while main process continued logging

**Stack Trace Pattern**:
```
Error: write EPIPE
at afterWriteDispatched (node:internal/stream_base_commons:161:15)
at console.log (node:internal/console/constructor:378:26)
at /Users/.../erfana/out/main/index.js:2379:13
```

**Solution**: Implemented comprehensive EPIPE error handling:

1. **Global Console Safety** (`src/main/utils/safe-console.ts`):
   - Wraps all console methods with try-catch
   - Silently suppresses EPIPE errors during shutdown
   - Installed early in main process initialization

 
   - Pre-write validation of stdin availability
   - EPIPE suppression in write callback
   - Graceful degradation with informative logging

3. **TerminalService Protection**:
   - EPIPE suppression in PTY write operations
   - ESRCH (process not found) handling in kill operations
   - Safe cleanup in dispose method

**Status**: ✅ Application now shuts down cleanly without crashes. EPIPE errors are suppressed and logged informatively.

**Files Modified**:
- `src/main/utils/safe-console.ts` (new)
- `src/main/index.ts` (installSafeConsole)
 
- `src/main/services/TerminalService.ts` (write, killTerminal, dispose)

See: [EPIPE Error Handling Documentation](./epipe-error-handling.md)

---

## Active Issues

### node-pty Build Failure

**Issue**: Fails to build on Python 3.13 (missing `distutils`)

**Error**:
```
ModuleNotFoundError: No module named 'distutils'
```

**Workaround**:
- Terminal functionality may be limited
- Use external terminal if needed
 

**Solution**:
- Downgrade to Python 3.12, OR
- Wait for node-pty update

**Tracking**: https://github.com/microsoft/node-pty/issues

---

### Template ID System

**Issue**: Template IDs derived from slugified display names is fragile.

**Current Implementation**:
```typescript
// parser.ts
const id = slugify(result.data.name)  // Derives ID from name
```

**Problem**:
- Changing template name breaks all code references
- `name: "Mermaid Bug Report"` → `id: "mermaid-bug-report"`
- Code must look up by derived ID: `PROMPT_REGISTRY['mermaid-bug-report']`
- Fragile coupling between display name and programmatic identifier

**Example Issue:**
```yaml
# Template frontmatter
---
name: Report Mermaid Error  # Slugifies to "report-mermaid-error"
---
```
```typescript
// Code reference
const config = PROMPT_REGISTRY['mermaid-bug-report']  // WRONG ID!
// Returns undefined because actual ID is "report-mermaid-error"
```

**Recommended Solution**:
Add explicit `id` field to frontmatter:
```yaml
---
id: mermaid-bug-report    # Explicit, stable identifier
name: Mermaid Bug Report  # Display name (can change freely)
---
```

**Implementation Steps**:
1. Add `id` field to `PromptFrontmatterSchema` (schema.ts)
2. Update parser to use explicit ID instead of slugify
3. Add uniqueness validation in registry
4. Migrate all existing templates (elaborate, improve, rewrite, simplify, mermaid-bug-report)
5. Remove slugify function

**Status**: Architecture review complete, implementation pending.

**See**: [Prompt Templates](./prompts/README.md)

---

## Dockview CSS Import Path

**Issue**: Vite cannot resolve `dockview/dist/styles.css`

**Solution**: Use correct path:
```typescript
import 'dockview/dist/styles/dockview.css'  // ✅ Correct
```

---

## electron-store ES Module Import

**Issue**: electron-store v11+ is an ES Module and cannot be imported with `require()` in CommonJS

**Error**:
```
ERR_REQUIRE_ESM: require() of ES Module not supported
```

**Solution**: Use dynamic `import()` instead:
```typescript
export class SettingsService {
  private store: any
  private storePromise: Promise<any>

  constructor() {
    this.storePromise = import('electron-store').then((module) => {
      const ElectronStore = module.default
      this.store = new ElectronStore<Settings>({
        name: 'erfana-settings'
      })
      return this.store
    })
  }

  private async ensureStore(): Promise<any> {
    if (!this.store) await this.storePromise
    return this.store
  }

  async getLastProjectPath(): Promise<string | null> {
    const store = await this.ensureStore()
    return store.get('lastProjectPath') || null
  }
}
```

**Pattern**: All SettingsService methods must be async to handle dynamic import.

**Files**:
- `src/main/services/SettingsService.ts`
- `src/main/ipc/file-handlers.ts` (must await settingsService calls)

---

## ESLint Peer Dependency Warnings

**Issue**: ESLint 9 vs ESLint 8 peer dependencies

**Impact**: None (warnings only)

**Action**: Ignore warnings; electron-toolkit will update

---

## Panel Close Button CSS Selectors

**Status**: No longer applicable after v0.1.0 architectural refactoring

**Previous Issue**: CSS used `:has()` selector for hiding close buttons on protected panels

**Current State**: New SplitviewReact architecture handles panel visibility through API rather than hiding close buttons. This issue is resolved by the architectural change.

**Browser Support Note**: Electron uses recent Chromium which supports `:has()` if needed elsewhere

---

See: [Architecture](./architecture.md) | [UI Components](./ui-components.md)

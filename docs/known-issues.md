# Known Issues & Workarounds

## Resolved Issues

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

### ✅ Scroll Synchronization (RESOLVED in v0.2.0, Commits 5f1b85f-df8f220)

**Previous Issue**: Editor and preview panes in split view didn't synchronize scrolling.

**Solution**: Implemented bidirectional scroll synchronization using:
- Line-to-pixel mapping via `data-line` attributes
- React-markdown's `node.position` API for AST line numbers
- Linear interpolation for smooth scrolling between known points
- 50ms debouncing to prevent scroll loops
- Proper React ref handling to avoid re-render issues

**Status**: ✅ Editor ↔ Preview scrolling now synchronized in split view.

See: [Markdown Editing - Scroll Synchronization](./markdown-editing.md#scroll-synchronization)

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

See: [Markdown Editing - Code Block Rendering](./markdown-editing.md#code-block-rendering)

---

## Active Issues

### node-pty Build Failure

**Issue**: Fails to build on Python 3.13 (missing `distutils`)

**Error**:
```
ModuleNotFoundError: No module named 'distutils'
```

**Workaround**:
- Terminal panel is deferred
- Use Claude Agent SDK directly for now
- Claude CLI can be run via system terminal

**Solution**:
- Downgrade to Python 3.12, OR
- Wait for node-pty update

**Tracking**: https://github.com/microsoft/node-pty/issues

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

# Known Issues & Workarounds

## node-pty Build Failure

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

## Monaco Editor CDN Loading

**Status**: ✅ RESOLVED (commit 121fbb6)

**Component**: MonacoMarkdownEditor
**File**: `src/renderer/src/components/Editor/MonacoMarkdownEditor.tsx:6-8`

### Issue (Historical)

Monaco Editor was loading web workers from CDN (`cdn.jsdelivr.net`) which caused Content Security Policy violations in Electron, resulting in the editor showing "Loading..." indefinitely and never rendering.

### Solution

Configured Monaco loader to use local bundling instead of CDN:

```typescript
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Configure Monaco to use local files instead of CDN
// This prevents CSP violations in Electron
loader.config({ monaco })
```

This prevents CSP violations by bundling Monaco workers from `node_modules` instead of fetching from external CDN.

**Impact**: Editor now loads properly without CSP violations. Offline mode works correctly.

**Commit**: 121fbb6 (Fix Monaco Editor CSP violation and initialization issues)

---

## ESLint Peer Dependency Warnings

**Issue**: ESLint 9 vs ESLint 8 peer dependencies

**Impact**: None (warnings only)

**Action**: Ignore warnings; electron-toolkit will update

---

## Panel Close Button CSS Selectors

**Issue**: CSS uses `:has()` selector for hiding close buttons on protected panels

**Browser Support**: Chrome 105+, Firefox 121+, Safari 15.4+

**Impact**: If browser doesn't support `:has()`, close buttons won't be hidden by CSS

**Mitigation**: JavaScript capture-phase event listener provides fallback protection

**Status**: Acceptable - Electron uses recent Chromium which supports `:has()`

See: [UI Components](./ui-components.md#panel-protection)

---

## localStorage Clear on Startup

**Issue**: `loadPersistedState()` clears localStorage on every app start

**Location**: `src/renderer/src/components/DockLayout/AppDockLayout.tsx` line 89

**Reason**: Temporary workaround during development to force fresh state

**Impact**: Panel sizes and visibility reset to defaults every time

**Action**: Remove `localStorage.removeItem('erfana-sidebar-state')` after development stabilizes

---

## Panel Protection Implementation

**Issue**: Multiple attempts to hide close buttons failed

**Root Cause**: Used wrong CSS class selectors (`.tab-label` instead of `.dv-default-tab-content`)

**Current Solution**:
- Capture-phase event listener intercepts clicks on `.dv-default-tab-action`
- Fallback auto-restore if panel somehow removed

**Technical Debt**:
- Multiple setTimeout calls for button hiding (can be optimized)
- CSS selectors using `textContent` attribute may have compatibility issues

**Status**: Working solution, but could be more elegant

See: [UI Components](./ui-components.md#panel-protection)

---

See: [Architecture](./architecture.md) | [UI Components](./ui-components.md)

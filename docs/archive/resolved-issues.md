# Resolved issues

Historical record of issues that have been fixed. See [known-issues.md](../known-issues.md) for current issues.

---

## Terminal scroll jump during streaming (v0.3.1)

**Issue**: Terminal viewport jumps to top during Claude CLI streaming output.

**Root cause**: Claude CLI buffer redraws override xterm.js scroll position preservation.

**Solution**: Multi-layered fix:
1. Scroll position tracking using Buffer API (`viewportY` vs `baseY`)
2. Terminal options: `scrollOnUserInput: false`, `smoothScrollDuration: 0`
3. CSS fix: `overflow-y: auto` instead of forced scrollbars
4. Comprehensive test coverage

**Related**: GitHub issues #826, #1413, #1426

See: [Terminal - Scroll fixes](../terminal/scroll-fixes.md)

---

## Panel resizing (v0.1.0)

**Issue**: Panels showed resize cursor but didn't actually resize.

**Root cause**: Was using DockviewReact for basic 3-column layout. All panels had `flexGrow: 0`.

**Solution**: Refactored to hybrid SplitviewReact (outer layout) + DockviewReact (editor tabs only).

See: [Architecture - Hybrid layout](../architecture.md#hybrid-layout-architecture)

---

## Monaco Editor CDN loading

**Issue**: Monaco loading web workers from CDN caused CSP violations.

**Solution**: Configured Monaco loader to use local bundling:
```typescript
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
loader.config({ monaco })
```

---

## Panel protection (v0.1.0)

**Issue**: Multiple attempts to hide close buttons on protected panels failed.

**Solution**: New SplitviewReact architecture handles panel visibility through API rather than hiding close buttons.

See: [UI Components - Panel toggle](../ui-components.md#panel-toggle-system)

---

## Scroll synchronization (v0.3.0)

**Issue**: Editor and preview panes didn't synchronize scrolling.

**Solution**:
- Line-to-pixel mapping via `data-line` attributes
- React-markdown's `node.position` API for AST line numbers
- Force component remounting with React keys
- Immediate scroll map building in `handleEditorMount()`

See: [Scroll synchronization](../editor/scroll-sync.md)

---

## Plain code block rendering (v0.3.0)

**Issue**: Code blocks without language identifiers rendered line-by-line.

**Root cause**: Inline code detection logic was incorrect.

**Solution**: Improved detection to check for newlines:
```typescript
const isInline = !className && typeof children === 'string' && !children.includes('\n')
```

---

## EPIPE errors during shutdown (v0.4.0)

**Issue**: Application crashed with "write EPIPE" errors during cleanup.

**Root cause**: Console and stream writes continued after stdout/stderr closed during shutdown.

**Solution**: Comprehensive EPIPE error handling:
1. Global Console Safety (`src/main/utils/safeConsole.ts`)
2. TerminalService protection with EPIPE/ESRCH handling
3. Safe cleanup in dispose methods

See: [EPIPE Error Handling](../epipe-error-handling.md)

---

See: [Known issues](../known-issues.md) | [Troubleshooting](../troubleshooting.md)

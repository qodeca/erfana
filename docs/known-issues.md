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

**Issue**: Monaco loads workers from CDN by default

**Impact**: Offline mode doesn't work

**Workaround** (if needed):
```typescript
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

self.MonacoEnvironment = {
  getWorker: () => new editorWorker()
}
```

**Status**: Current implementation works online; offline mode is future enhancement

---

## ESLint Peer Dependency Warnings

**Issue**: ESLint 9 vs ESLint 8 peer dependencies

**Impact**: None (warnings only)

**Action**: Ignore warnings; electron-toolkit will update

See: [Architecture](./architecture.md)

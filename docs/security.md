# Security Guidelines

## Context Isolation

**Status**: ✅ ENABLED (required)

```typescript
// src/main/index.ts
webPreferences: {
  contextIsolation: true,    // NEVER disable
  nodeIntegration: false,    // NEVER enable
  sandbox: false             // Required for preload
}
```

## Content Security Policy

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self';
               style-src 'self' 'unsafe-inline';
               font-src 'self' data:" />
```

**Note**: `'unsafe-inline'` needed for dockview dynamic styles

## IPC Security Checklist

- [x] contextBridge used for all IPC
- [x] Input validation in all handlers
- [ ] Rate limiting (future)
- [ ] Permission system for sensitive operations (future)

## Input Validation

```typescript
// Example: Validate file paths
function isValidPath(path: string): boolean {
  // No path traversal
  if (path.includes('..')) return false
  // Must be absolute
  if (!path.startsWith('/')) return false
  // No hidden system files
  if (path.includes('/.')) return false
  return true
}
```

## Future Enhancements

1. Sandboxed renderer (currently `sandbox: false` for preload)
2. Signed updates with electron-updater
3. Encrypted local storage for sensitive data
4. Permission prompts for destructive operations

See: [IPC Patterns](./ipc-patterns.md) | [Architecture](./architecture.md)

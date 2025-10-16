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
               font-src 'self' data:;
               img-src 'self' https:;" />
```

**Policy Details**:
- `default-src 'self'` - All content from app origin only
- `script-src 'self'` - Scripts only from app (no inline, no external)
- `style-src 'self' 'unsafe-inline'` - Inline styles needed for dockview dynamic styling
- `font-src 'self' data:` - Fonts from app or data URIs
- `img-src 'self' https:;` - Images from app or HTTPS (enables external image CDNs)

**HTML Rendering Notes**:
- With `img-src 'self' https:;`, HTML `<img>` tags can load from HTTPS sources (Unsplash, CDNs, etc.)
- HTTP images are blocked by CSP (security)
- `data:` URI images are blocked (no image data URIs in HTML)
- Sanitization still applies (no malicious attributes)
- See [HTML Rendering](./markdown-editing.md#html-rendering-in-markdown) for details

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

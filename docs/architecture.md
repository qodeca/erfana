# Architecture

## Three-Process Model

1. **Main Process** (`src/main/`): Node.js environment
   - Window lifecycle, file system, native OS integration
   - IPC request handlers

2. **Preload Script** (`src/preload/`): Secure bridge
   - Exposes APIs via `contextBridge`
   - Type-safe IPC channels
   - NO direct Node.js access in renderer

3. **Renderer Process** (`src/renderer/`): React UI
   - Dockview panel system
   - No Node.js integration (security)

## Directory Structure

```
src/
├── main/
│   ├── index.ts              # Main process entry
│   ├── services/             # Business logic (OOP)
│   │   └── FileService.ts    # Currently implemented
│   └── ipc/
│       └── file-handlers.ts  # IPC handlers
├── preload/
│   ├── index.ts              # contextBridge setup
│   └── index.d.ts            # TypeScript definitions
└── renderer/
    └── src/
        ├── components/
        │   ├── DockLayout/      # Panel system
        │   ├── Toolbar/         # Top toolbar with toggle buttons
        │   ├── Panels/          # Panel implementations
        │   ├── Editor/          # Monaco + Preview
        │   └── FileTree/        # File explorer
        ├── App.tsx
        └── main.tsx
```

## Key Design Decisions

- **OOP Services**: Business logic in service classes
- **Secure IPC**: All main↔renderer communication via contextBridge
- **Component Registry**: Dockview uses string-based component lookup
- **Multi-model Editor**: Single Monaco instance, swap models per file

See: [IPC Patterns](./ipc-patterns.md) | [UI Components](./ui-components.md) | [Security](./security.md)

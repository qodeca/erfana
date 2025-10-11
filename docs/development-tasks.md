# Common Development Tasks

## Adding New IPC Channel

1. Define in `src/preload/index.ts`:
   ```typescript
   const api = {
     myFeature: {
       doSomething: (arg: string) => ipcRenderer.invoke('my:action', arg)
     }
   }
   ```

2. Add handler in `src/main/ipc/my-handlers.ts`:
   ```typescript
   export function registerMyHandlers() {
     ipcMain.handle('my:action', async (_event, arg: string) => {
       // Validate arg
       return result
     })
   }
   ```

3. Register in `src/main/index.ts`:
   ```typescript
   import { registerMyHandlers } from './ipc/my-handlers'

   app.whenReady().then(() => {
     registerMyHandlers()
   })
   ```

4. Call from renderer:
   ```typescript
   await window.api.myFeature.doSomething('value')
   ```

## Adding Dockview Panel

1. Create `src/renderer/src/components/Panels/MyPanel.tsx`

2. Register in `AppDockLayout.tsx`:
   ```typescript
   const components = {
     myPanel: MyPanel
   }
   ```

3. Add to layout:
   ```typescript
   event.api.addPanel({
     id: 'myPanel',
     component: 'myPanel',
     title: 'My Panel'
   })
   ```

## Adding Service Class

1. Create `src/main/services/MyService.ts`:
   ```typescript
   export class MyService {
     constructor(private config: Config) {}

     async doWork(): Promise<Result> {
       // Implementation
     }
   }

   export const myService = new MyService(config)
   ```

2. Use in IPC handler or main process

## Working with Panel State

### Reading Panel State

```typescript
// Get current state from localStorage
const state = localStorage.getItem('erfana-sidebar-state')
const parsed = JSON.parse(state)

console.log(parsed.leftSidebar.visible)  // boolean
console.log(parsed.leftSidebar.width)    // number (px)
```

### Updating Panel State

```typescript
// Update state programmatically
const updateSidebarState = (sidebarId: string, updates: any) => {
  setSidebarStates((prev) => {
    const newState = {
      ...prev,
      [sidebarId]: { ...prev[sidebarId], ...updates }
    }
    localStorage.setItem('erfana-sidebar-state', JSON.stringify(newState))
    return newState
  })
}
```

### Resetting Panel State

```typescript
// Clear state to force defaults on next load
localStorage.removeItem('erfana-sidebar-state')
```

### Adding New Protected Panel

1. Add panel ID to `protectedPanels` array:
   ```typescript
   const protectedPanels = ['fileExplorer', 'terminal', 'git', 'myNewPanel']
   ```

2. Add panel title to `protectedTitles` array:
   ```typescript
   const protectedTitles = ['Explorer', 'Terminal', 'Git', 'My New Panel']
   ```

Protection is automatic - click interception and auto-restore work immediately.

See: [UI Components](./ui-components.md#panel-protection)

## Debugging

- **Main Process**: Terminal output (`console.log`)
- **Renderer**: Chrome DevTools (F12 in app)
- **IPC**: Log both sides to trace calls
- **Hot Reload**: Save file → automatic reload

## Integrating New NPM Package

1. `npm install package-name`
2. Import where needed:
   - Main/Preload: Direct import
   - Renderer: Standard React import
3. Add types if needed: `npm install -D @types/package-name`

See: [Architecture](./architecture.md) | [IPC Patterns](./ipc-patterns.md) | [UI Components](./ui-components.md)

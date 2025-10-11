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

See: [Architecture](./architecture.md) | [IPC Patterns](./ipc-patterns.md)

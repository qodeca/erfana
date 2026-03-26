# 020 – Google Drive link integration: Implementation design

## Service interfaces

### IDriveAuthService

```typescript
// src/main/services/DriveAuthService.ts
interface IDriveAuthService {
  /** Open OAuth2 consent BrowserWindow; resolves when tokens stored or rejects on cancel */
  authenticate(): Promise<void>
  /** Return a valid access token, silently refreshing if expired */
  getAccessToken(): Promise<string>
  /** Revoke grant and clear stored tokens */
  signOut(): Promise<void>
  /** True if a refresh token is stored */
  isAuthenticated(): boolean
  /** Email address of the signed-in account, or null */
  getAccountInfo(): Promise<{ email: string } | null>
}
```

### IDriveLinkService

```typescript
// src/main/services/DriveLinkService.ts
interface IDriveLinkService {
  /** Parse a .gdrive file; throws ZodError if frontmatter invalid */
  parse(filePath: string): Promise<{ frontmatter: GDriveFrontmatter; body: string }>
  /** Write a new .gdrive file in targetDir; returns the created path */
  create(targetDir: string, metadata: DriveFileMetadata): Promise<string>
  /** Overwrite frontmatter fields; preserves markdown body */
  update(filePath: string, patch: Partial<GDriveFrontmatter>): Promise<void>
  /** List all .gdrive files in a directory (non-recursive) */
  list(dirPath: string): Promise<string[]>
  /** Sanitize a Drive file name to a safe .gdrive filename */
  sanitizeFilename(driveName: string): string
}
```

### IDriveApiService

```typescript
// src/main/services/DriveApiService.ts
interface IDriveApiService {
  /** Fetch current file metadata from Drive API */
  fetchMetadata(driveId: string): Promise<DriveFileMetadata>
  /** Fetch plain-text content appropriate to mime type */
  fetchContent(driveId: string, mimeType: string): Promise<string>
  /** Open Google Picker in a BrowserWindow; resolves with selected files */
  openPicker(parentWindow: BrowserWindow): Promise<DriveFileMetadata[]>
  /** Export a file to PDF bytes */
  exportAsPdf(driveId: string): Promise<Buffer>
}
```

### Shared data types

```typescript
// src/shared/ipc/drive-schema.ts
interface GDriveFrontmatter {
  type: 'document' | 'spreadsheet' | 'presentation' | 'file'
  drive_id: string
  name: string
  url: string
  mime_type: string
  linked_at: string          // ISO 8601
  last_modified?: string
  modified_by?: string
  size_bytes?: number
}

interface DriveLink {
  filePath: string
  frontmatter: GDriveFrontmatter
  body: string               // markdown below frontmatter
}

interface DriveFileMetadata {
  id: string
  name: string
  mimeType: string
  webViewLink: string
  modifiedTime?: string
  lastModifyingUser?: { emailAddress: string }
  size?: string
}
```

---

## IPC schema design

**File:** `src/shared/ipc/drive-schema.ts`

```typescript
import { z } from 'zod'

export const DriveFileTypeSchema = z.enum(['document', 'spreadsheet', 'presentation', 'file'])

export const GDriveFrontmatterSchema = z.object({
  type: DriveFileTypeSchema,
  drive_id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  mime_type: z.string().min(1),
  linked_at: z.string().datetime(),
  last_modified: z.string().datetime().optional(),
  modified_by: z.string().email().optional(),
  size_bytes: z.number().int().nonneg().optional()
})

// drive:authenticate – no input
export const DriveAuthResultSchema = z.object({
  success: z.boolean(),
  email: z.string().email().optional(),
  error: z.string().optional()
})

// drive:signOut – no input
export const DriveSignOutResultSchema = z.object({ success: z.boolean() })

// drive:isAuthenticated – no input
export const DriveIsAuthenticatedResultSchema = z.object({ authenticated: z.boolean() })

// drive:getAccountInfo – no input
export const DriveAccountInfoResultSchema = z.object({ email: z.string().nullable() })

// drive:openPicker
export const DriveOpenPickerRequestSchema = z.object({ targetDir: z.string().min(1) })
export const DriveOpenPickerResultSchema = z.object({
  created: z.array(z.string()),
  error: z.string().optional()
})

// drive:fetchContent
export const DriveFetchContentRequestSchema = z.object({
  driveId: z.string().min(1),
  mimeType: z.string().min(1)
})
export const DriveFetchContentResultSchema = z.object({
  content: z.string(),
  truncated: z.boolean()
})

// drive:refreshMetadata
export const DriveRefreshMetadataRequestSchema = z.object({ filePath: z.string().min(1) })
export const DriveRefreshMetadataResultSchema = z.object({
  success: z.boolean(),
  name: z.string().optional(),
  error: z.string().optional()
})

// drive:refreshAllMetadata
export const DriveRefreshAllMetadataRequestSchema = z.object({ dirPath: z.string().min(1) })
export const DriveRefreshAllMetadataResultSchema = z.object({
  refreshed: z.number(),
  errors: z.array(z.string())
})

// drive:linkFiles
export const DriveLinkFilesRequestSchema = z.object({
  targetDir: z.string().min(1),
  files: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    webViewLink: z.string()
  })).min(1).max(50)
})
export const DriveLinkFilesResultSchema = z.object({
  created: z.array(z.string()),
  error: z.string().optional()
})
```

---

## Data flow diagrams

### Auth flow (first sign-in)

```
Renderer (context menu click)
  │  api.drive.authenticate()
  ▼
Preload (ipcRenderer.invoke 'drive:authenticate')
  ▼
drive-handlers.ts → DriveAuthService.authenticate()
  │
  ├── generate PKCE code_verifier + code_challenge
  ├── start HTTP server on 127.0.0.1:0 (dynamic port)
  ├── open BrowserWindow → accounts.google.com/o/oauth2/v2/auth
  │     nodeIntegration: false, contextIsolation: true
  │     will-navigate blocked for non-Google domains
  │
  ├── user approves → Google redirects to 127.0.0.1:{port}/callback?code=...
  ├── HTTP server receives code → exchange for tokens via googleapis
  ├── safeStorage.encryptString(refresh_token) → ~/.erfana/google-refresh-token.enc
  ├── BrowserWindow.close()
  └── resolve { success: true }
  ▼
Renderer – proceeds with originally requested action
```

### Link creation flow (Picker → .gdrive file)

```
Renderer (directory context menu → "Link Google Drive file")
  │  api.drive.openPicker({ targetDir })
  ▼
drive-handlers.ts
  │
  ├── DriveAuthService.isAuthenticated() → false → DriveAuthService.authenticate()
  ├── DriveAuthService.getAccessToken() → accessToken
  │
  ├── open Picker BrowserWindow (loads picker.html from app resources)
  │     picker.html loads apis.google.com/js/api.js
  │     postMessage({ type: 'init', accessToken, pickerKey }) from main
  │
  ├── user selects files → Picker posts { type: 'picked', files: [...] }
  │     BrowserWindow preload captures postMessage → ipcRenderer.send
  │
  ├── ipcMain.once('drive:picker-result:{nonce}') resolves promise
  ├── DriveLinkService.create(targetDir, fileMetadata) × N files
  └── return { created: ['/path/to/report.gdrive', ...] }
  ▼
Renderer
  ├── toast "Linked N files from Google Drive"
  └── refreshProjectTree()
```

### AI prompt execution flow

```
Renderer (right-click .gdrive → "Summarize")
  │
  ├── read frontmatter from node data (drive_id, mime_type, name, type, url)
  │  api.drive.fetchContent({ driveId, mimeType })
  ▼
drive-handlers.ts → DriveApiService.fetchContent()
  │  (auto-refreshes access token if expired)
  └── return { content: "..." }
  ▼
Renderer
  ├── getPrompt('drive-summarize') → template string
  ├── renderTemplate(template, {
  │     driveContent, driveName, driveType, driveUrl, driveMimeType
  │   })
  └── paste rendered prompt into terminal panel
```

### Metadata refresh flow

```
Renderer (right-click .gdrive → "Refresh metadata")
  │  api.drive.refreshMetadata({ filePath })
  ▼
drive-handlers.ts
  ├── DriveLinkService.parse(filePath) → { frontmatter }
  ├── DriveApiService.fetchMetadata(frontmatter.drive_id)
  │     → { name, modifiedTime, lastModifyingUser, size }
  ├── DriveLinkService.update(filePath, { name, last_modified, modified_by, size_bytes })
  └── return { success: true, name }
  ▼
Renderer
  ├── toast "Metadata refreshed for {name}"
  └── FileWatcherService detects .gdrive write → tree re-renders automatically
```

---

## File-by-file change list

### New files to create

| File | Description |
|------|-------------|
| `src/main/services/DriveAuthService.ts` | OAuth2 PKCE loopback flow; token encrypt/decrypt via safeStorage |
| `src/main/services/DriveLinkService.ts` | Pure file-system service; YAML frontmatter parse/write using `js-yaml` |
| `src/main/services/DriveApiService.ts` | googleapis SDK wrapper; content fetch with mime-type routing |
| `src/main/ipc/drive-handlers.ts` | `registerDriveHandlers()` for all `drive:*` ipcMain.handle calls |
| `src/shared/ipc/drive-schema.ts` | Zod schemas and TypeScript types for all drive IPC channels |
| `src/shared/ipc/drive-channels.ts` | String constants for channel names |
| `src/renderer/src/prompts/drive-summarize.md` | Prompt template: summarize document |
| `src/renderer/src/prompts/drive-explain.md` | Prompt template: explain document |
| `src/renderer/src/prompts/drive-extract.md` | Prompt template: extract key points |
| `src/renderer/src/prompts/drive-ask.md` | Prompt template: ask question about document |
| `src/renderer/src/prompts/drive-analyze.md` | Prompt template: analyze in project context |
| `src/renderer/src/components/ProjectTree/context-menu/DriveFileContextMenuStrategy.ts` | Context menu strategy for .gdrive files |
| `src/renderer/src/components/Settings/GoogleDriveSection.tsx` | Settings UI section |
| `src/renderer/src/components/ProjectTree/DriveFreshnessIndicator.tsx` | Relative time badge component |
| `resources/picker.html` | Static HTML for Picker BrowserWindow |

### Files to modify

| File | Change |
|------|--------|
| `src/main/index.ts` | Import and call `registerDriveHandlers(mainWindow)` |
| `src/shared/constants.ts` | Add `GOOGLE_DRIVE` constant group |
| `src/shared/ipc/global-settings-schema.ts` | Add `GoogleDriveSettingsSchema` under `googleDrive` key |
| `src/preload/index.ts` | Add `drive` namespace to `api` object; extend `FileNode` with `driveDisplayName`, `driveLastModified` |
| `src/main/services/FileService.ts` | Call `DriveLinkService.parse()` for `.gdrive` files in `readDirectory()` |
| `src/renderer/src/prompts/schema.ts` | Extend `area` enum with `'drive-link'` |
| `src/renderer/src/prompts/types.ts` | Add Drive variables to `PromptVariables` |
| `src/renderer/src/prompts/variableFactory.ts` | Pass through Drive variables in `createPromptVariables()` |
| `src/renderer/src/components/ProjectTree/context-menu/factory.ts` | Register `DriveFileContextMenuStrategy` before `FileContextMenuStrategy` |
| `src/renderer/src/components/ProjectTree/context-menu/strategies.tsx` | Export strategy; extend `DirectoryContextMenuStrategy` with Drive items |
| `src/renderer/src/components/ProjectTree/context-menu/types.ts` | Add `drive` to `MenuContext` |
| `src/renderer/src/components/ProjectTree/ProjectTreeNode.tsx` | Cloud icon, display name, freshness, double-click handler |
| `src/renderer/src/utils/iconRegistry.tsx` | Add `'cloud'` icon name |
| `src/renderer/src/components/Settings/SettingsOverlay.tsx` | Render `<GoogleDriveSection />` |
| `CLAUDE.md` | Add "Google Drive links" section |
| `package.json` | Add `@googleapis/drive`, `@googleapis/docs`, `@googleapis/sheets`, `google-auth-library` |

---

## Integration points

### DI registration

Services are singletons exported at module level (no DI container):

```typescript
// DriveAuthService.ts
export const driveAuthService = new DriveAuthService()

// DriveApiService.ts – receives auth via constructor
export const driveApiService = new DriveApiService(driveAuthService)

// DriveLinkService.ts – no dependencies
export const driveLinkService = new DriveLinkService()
```

### IPC handler registration

In `src/main/index.ts`, inside `app.whenReady()` after `createWindow()`:

```typescript
import { registerDriveHandlers } from './ipc/drive-handlers'
registerDriveHandlers(mainWindow)
```

### Preload bridge

New namespace in `src/preload/index.ts`:

```typescript
drive: {
  authenticate: () => ipcRenderer.invoke('drive:authenticate'),
  signOut: () => ipcRenderer.invoke('drive:signOut'),
  isAuthenticated: () => ipcRenderer.invoke('drive:isAuthenticated'),
  getAccountInfo: () => ipcRenderer.invoke('drive:getAccountInfo'),
  openPicker: (req) => ipcRenderer.invoke('drive:openPicker', req),
  fetchContent: (req) => ipcRenderer.invoke('drive:fetchContent', req),
  refreshMetadata: (req) => ipcRenderer.invoke('drive:refreshMetadata', req),
  refreshAllMetadata: (req) => ipcRenderer.invoke('drive:refreshAllMetadata', req),
  linkFiles: (req) => ipcRenderer.invoke('drive:linkFiles', req)
}
```

### Prompt registry

No manual registration needed. Adding `.md` files to `src/renderer/src/prompts/` is sufficient – `registry.ts` uses `import.meta.glob` which picks them up automatically. Only change: extend `area` enum in `schema.ts`.

### Context menu factory

Prepend `DriveFileContextMenuStrategy` before `FileContextMenuStrategy`:

```typescript
this.strategies = [
  new DriveFileContextMenuStrategy(),   // most specific – matches .gdrive
  new DirectoryContextMenuStrategy(),
  new FileContextMenuStrategy()
]
```

### Project tree node rendering

`FileNode` gains optional `driveDisplayName` and `driveLastModified` fields. `FileService.readDirectory()` populates them by calling `DriveLinkService.parse()` for `.gdrive` files. `ProjectTreeNode` renders `Cloud` icon and `driveDisplayName` when present.

---

## Build sequence

### Phase 1 – Foundation (no UI)

- Add npm dependencies
- Create `src/shared/ipc/drive-channels.ts` and `drive-schema.ts`
- Create `DriveLinkService` (pure file I/O, fully testable)
- Extend `FileNode` in preload with Drive fields
- Extend `FileService.readDirectory()` to parse `.gdrive` files
- Add `GOOGLE_DRIVE` constants

### Phase 2 – Authentication

- Implement `DriveAuthService` with OAuth2 loopback flow
- Add `GoogleDriveSettingsSchema` to global settings
- Create `GoogleDriveSection` settings component
- IPC handlers: authenticate, signOut, isAuthenticated, getAccountInfo

### Phase 3 – Drive API and content

- Implement `DriveApiService` with mime-type routing
- IPC handlers: fetchContent, refreshMetadata, openPicker
- Error mapping and retry logic

### Phase 4 – Project tree rendering

- Cloud icon for `.gdrive` in `ProjectTreeNode`
- Display name from frontmatter
- `DriveFreshnessIndicator` component
- Double-click → `shell.openExternal`

### Phase 5 – Context menu and prompts

- `DriveFileContextMenuStrategy` with direct ops + AI prompts
- Register in `ContextMenuFactory`
- Extend prompt variables and schema
- Write five Drive prompt template files
- "Link Google Drive file" in directory context menu

### Phase 6 – Google Picker BrowserWindow

- Create `resources/picker.html`
- Implement Picker nonce/postMessage handshake
- Wire `drive:openPicker` end-to-end

### Phase 7 – Integration and polish

- CLAUDE.md documentation
- Rate limit handling (200ms throttle for bulk refresh)
- Offline error handling
- Test ID updates
- E2E tests (mocked auth)

---

## Testing strategy

### Unit tests (Vitest, main process)

| File | Coverage |
|------|----------|
| `DriveLinkService.test.ts` | Parse/create/update/sanitize/collision; rejects invalid frontmatter |
| `DriveAuthService.test.ts` | Token encrypt/decrypt round-trip; PKCE generation; signOut clears tokens |
| `DriveApiService.test.ts` | Content routing by MIME type; 401 triggers refresh; 429 retries with backoff |
| `drive-handlers.test.ts` | Zod validation rejects invalid payloads; successful paths return typed results |

### Unit tests (Vitest, renderer)

| File | Coverage |
|------|----------|
| `DriveFileContextMenuStrategy.test.tsx` | `supports()` true for .gdrive; `build()` returns correct items |
| `GoogleDriveSection.test.tsx` | Connected vs disconnected states |
| `drive-schema.test.ts` | All schemas reject invalid inputs |

### E2E tests (Playwright)

| Scenario | Approach |
|----------|---------|
| .gdrive Cloud icon in tree | Fixture .gdrive file; assert icon via `data-testid` |
| Context menu shows Drive items | Right-click fixture node; assert menu items visible |
| Double-click opens external URL | Mock `shell.openExternal`; assert called with correct URL |
| Unlink deletes file | Right-click → Unlink → confirm → assert file removed from tree |

E2E tests must not call real Google APIs. Use IPC interception to stub all `drive:*` handlers.

---

## Critical details

### Error handling

All `drive:*` handlers return `{ error: string }` on failure, never throw. The renderer maps error codes to toast messages. Specific handling: 401 → re-auth, 403 → "check sharing settings", 404 → "document may have been deleted", 429 → exponential backoff (3 retries), offline → "no network connection" toast.

### OAuth client ID bundling

Read from `import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID` at build time. Set in `.env.local` for development. `DriveAuthService` throws a clear error if missing.

### TestIDs

`testids.ts` has count-based tests. Adding new test IDs for `GoogleDriveSection` and Drive context menu items will require updating the count.

### Rate limiting

"Refresh all Drive links" processes files sequentially with 200ms delay between requests to stay under Google's quota.

### Offline degradation

`DriveLinkService.parse()` is network-free. Tree renders from cached frontmatter. All network-requiring actions check connectivity first and return descriptive errors.

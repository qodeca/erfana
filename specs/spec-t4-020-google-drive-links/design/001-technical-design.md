# 020 – Google Drive link integration: Technical design

**Spec**: T4-020
**Status**: draft
**Date**: 2026-03-26

---

## .gdrive file schema

### Zod schema – `src/shared/ipc/drive-schema.ts`

```typescript
import { z } from 'zod'

export const DriveFileTypeSchema = z.enum([
  'document',
  'spreadsheet',
  'presentation',
  'file'
])
export type DriveFileType = z.infer<typeof DriveFileTypeSchema>

export const GDriveFrontmatterSchema = z.object({
  /** Google Workspace document type */
  type: DriveFileTypeSchema,
  /** Google Drive file ID (alphanumeric, 25–44 chars) */
  drive_id: z.string().min(10).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid Google Drive file ID format'),
  /** Display name shown in the project tree */
  name: z.string().min(1).max(500),
  /** Full Google Drive URL */
  url: z.string().url(),
  /** Google MIME type (e.g., application/vnd.google-apps.document) */
  mime_type: z.string().min(1),
  /** ISO 8601 timestamp of when this link was created in Erfana */
  linked_at: z.string().datetime(),
  /** ISO 8601 timestamp of last modification in Drive (cached) */
  last_modified: z.string().datetime().optional(),
  /** Email of user who last modified the document (cached) */
  modified_by: z.string().email().optional(),
  /** File size in bytes (cached; not available for native Google Docs formats) */
  size_bytes: z.number().int().nonneg().optional()
})
export type GDriveFrontmatter = z.infer<typeof GDriveFrontmatterSchema>
```

### File on disk

```yaml
---
type: document
drive_id: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
name: Q1 Sales Report
url: https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit
mime_type: application/vnd.google-apps.document
linked_at: "2026-03-26T10:30:00.000Z"
last_modified: "2026-03-25T14:22:00.000Z"
modified_by: alice@example.com
---

Notes about this document...
```

---

## DriveAuthService design

**File**: `src/main/services/DriveAuthService.ts`

### Token storage

Follows `ApiKeyService` pattern exactly. Encrypted binary files in `~/.erfana/` with `0o600` permissions:

| Service name | File path | Content |
|---|---|---|
| `google-drive-refresh-token` | `~/.erfana/google-drive-refresh-token.enc` | Encrypted refresh token |
| `google-drive-account-email` | `~/.erfana/google-drive-account-email.enc` | Encrypted account email |

Access tokens are **never persisted** – held in memory with an expiry timestamp. On `getAccessToken()`, if `Date.now() < expiresAt - 60_000` (60-second buffer), the cached token is returned without a network call.

**Plaintext fallback:** Unlike `ApiKeyService` which falls back to plaintext when `safeStorage` is unavailable, `DriveAuthService` shall **refuse** to store tokens without encryption. If `safeStorage.isEncryptionAvailable()` returns false, `authenticate()` rejects with a typed error and the renderer shows: 'Google Drive requires a system keyring for secure token storage. Please install GNOME Keyring, KWallet, or similar.'

### OAuth2 flow state machine

```
IDLE → AWAITING_CODE → EXCHANGING → AUTHENTICATED | ERROR
```

1. **IDLE**: No tokens stored. `isAuthenticated()` returns false.
2. **AWAITING_CODE**: `authenticate()` called.
   - Generate PKCE code verifier (32 random bytes, base64url) and challenge (SHA-256, base64url)
   - Generate cryptographic `state` parameter (32 random bytes, base64url). Include in authorization URL. Validate on callback – reject if mismatched (CSRF protection per RFC 6749 section 10.12).
   - Start `http.createServer()` on port `0` (dynamic)
   - Redirect URI: `http://127.0.0.1:{port}/oauth/callback`
   - Scope: `https://www.googleapis.com/auth/drive.file` (files created or opened by the app via Picker)
   - Construct Google authorization URL with scopes, `response_type=code`, PKCE params (`code_challenge`, `code_challenge_method=S256`), `access_type=offline`, `prompt=consent`
   - Open BrowserWindow, load authorization URL
3. **AWAITING_CODE → EXCHANGING**: Loopback receives callback with `code` param.
   - Respond with "Sign-in complete" HTML
   - Shut down HTTP server
4. **EXCHANGING → AUTHENTICATED**: `OAuth2Client.getToken({ code, codeVerifier })`
   - Store refresh token via `safeStorage.encryptString()`
   - Store account email
   - Set in-memory access token + expiry
   - Close BrowserWindow, resolve promise
5. **Refresh path**: `refreshAccessToken()` using stored refresh token.
   - On `invalid_grant` (revoked): clear tokens, reject with typed error → caller triggers re-auth UX
   - If the refresh response includes a new `refresh_token` field, store it immediately via safeStorage, replacing the previous token. This handles Google's optional token rotation.

### BrowserWindow configuration

```typescript
new BrowserWindow({
  width: 500, height: 700,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false
    // No preload – external Google page
  }
})
```

---

## DriveLinkService design

**File**: `src/main/services/DriveLinkService.ts`

No network calls. All methods use only `fs/promises`.

### YAML parsing approach

Reuse the regex + `js-yaml` approach from `src/renderer/src/prompts/parser.ts`. The same frontmatter regex (`/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/`) extracts YAML and markdown body. Parse with `yaml.load()`, validate through `GDriveFrontmatterSchema.parse()`.

### File naming sanitization algorithm

```
Input: "Q1 Sales Report (Final v2)"
 1. Trim whitespace
 2. Lowercase
 3. Remove characters not in [a-z0-9 -]
 4. Replace spaces with single hyphen
 5. Collapse multiple hyphens
 6. Trim leading/trailing hyphens
 7. Truncate to 80 characters
 8. Append .gdrive extension
Output: "q1-sales-report-final-v2.gdrive"
```

Copy-increment on collision: reuse `IMPORT.MAX_COPY_ATTEMPTS` from `src/shared/constants.ts`.

### Frontmatter update strategy

1. Read raw file content
2. Apply frontmatter regex → extract YAML block + body
3. Merge patch into parsed frontmatter object
4. Re-serialize: `yaml.dump(merged, { lineWidth: -1, quotingType: '"' })`
5. Reconstruct: `---\n${serialized}---\n${body}`
6. Write back with `writeFile`

The body is never touched – preserves user notes exactly including trailing newlines.

---

## DriveApiService design

**File**: `src/main/services/DriveApiService.ts`

### googleapis client initialization

Use individual packages (`@googleapis/drive`, `@googleapis/docs`, `@googleapis/sheets`) rather than the monolith. Receive shared `OAuth2Client` instance from `DriveAuthService` via constructor injection. Each call uses `this.authService.getAccessToken()` to keep the token current.

### Content fetching per MIME type

| MIME type | Strategy | API call |
|---|---|---|
| `application/vnd.google-apps.document` | Export as plain text | `drive.files.export({ fileId, mimeType: 'text/plain' })` |
| `application/vnd.google-apps.spreadsheet` | Read sheet values | `sheets.spreadsheets.values.batchGet()` → format as TSV |
| `application/vnd.google-apps.presentation` | Export as plain text | `drive.files.export({ fileId, mimeType: 'text/plain' })` |
| Any other | Media download | `drive.files.get({ fileId, alt: 'media' })` → UTF-8, truncate at 100 KB |

Content truncated at **100,000 characters** with notice appended when truncation occurs.

### Error mapping

```typescript
// Error codes extend the existing ErrorCode enum in src/shared/errors.ts:
//   DRIVE_NOT_FOUND        // 404
//   DRIVE_PERMISSION_DENIED // 403
//   DRIVE_AUTH_REQUIRED     // 401
//   DRIVE_RATE_LIMITED      // 429
//   DRIVE_OFFLINE           // ENOTFOUND
//   DRIVE_SCOPE_DENIED      // drive.file scope limitation
//   DRIVE_INVALID_FILE      // bad .gdrive format
//   DRIVE_FEATURE_DISABLED  // feature flag off
//
// Uses AppError from src/shared/errors.ts (not a separate DriveApiError class):
//   throw new AppError('Document not found', ErrorCode.DRIVE_NOT_FOUND, { driveId })
//
// See ADR-008 for rationale on extending ErrorCode vs creating DriveErrorCode.
```

Rate limit handling: retry up to 3 times with exponential backoff (1s base, 2x multiplier, 30s max).

---

## DrivePickerService design

**File**: `src/main/services/DrivePickerService.ts`

### Interface

```typescript
export interface IDrivePickerService {
  /** Open Google Picker in a BrowserWindow; resolves with selected files or empty array on cancel */
  open(parentWindow: BrowserWindow): Promise<DrivePickerFile[]>
}
```

### BrowserWindow configuration

Same secure options as OAuth window (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`). Uses a dedicated `picker-preload.ts` that exposes only:

```typescript
// src/preload/picker-preload.ts
contextBridge.exposeInMainWorld('pickerBridge', {
  sendResult: (files: DrivePickerFile[]) => ipcRenderer.send('drive:picker-result', files)
})
```

### Communication protocol

1. Main process generates a random nonce per Picker session
2. Opens BrowserWindow loading `resources/picker.html`
3. `picker.html` loads Google Picker API (`apis.google.com/js/api.js`)
4. `picker.html` calls `window.pickerBridge.getConfig()` (via contextBridge) which returns `{ accessToken, pickerApiKey }` from the main process via IPC (see ADR-009)
5. User selects files → Picker fires callback
6. `picker.html` calls `window.pickerBridge.sendResult(files)`
7. Main process receives via `ipcMain.once('drive:picker-result')`, validates nonce
8. BrowserWindow closes

### postMessage origin validation

Messages received in the Picker preload from Google's Picker iframe must have origin `https://docs.google.com`. Other origins are silently ignored.

### CSP

The Picker window CSP must permit Google's hosted JavaScript. The exact CSP should be tested during implementation as Google Picker may require `'unsafe-eval'`. If needed, scope it to the Picker window only:
```
script-src 'self' https://apis.google.com https://*.googleapis.com 'unsafe-eval';
frame-src https://docs.google.com;
connect-src https://*.googleapis.com;
img-src 'self' data: https://*.googleusercontent.com;
object-src 'none'; base-uri 'none'
```

---

## Prompt template variables

### Extended types

Add to `PromptVariables`:

```typescript
driveContent?: string    // Plain text fetched from Drive document
driveName?: string       // Display name
driveType?: string       // document | spreadsheet | presentation | file
driveUrl?: string        // Full Drive URL
driveMimeType?: string   // Google MIME type
```

### Async content fetch before template rendering

In `DriveFileContextMenuStrategy`, AI prompt actions:

1. Read `.gdrive` frontmatter (pure file I/O, no auth)
2. Show loading state
3. Call `window.api.drive.fetchContent({ driveId, mimeType })`
4. Build `PromptVariables` with all Drive fields
5. `renderTemplate(template, variables)` → final prompt string
6. Dispatch to terminal
7. On error: toast with mapped message, no prompt pasted

"Ask about document" additionally shows input dialog to collect user's question.

### Template files

| File | `area` | `requiresInput` | `order` |
|---|---|---|---|
| `src/renderer/src/prompts/templates/drive-summarize.md` | `drive-link` | false | 10 |
| `src/renderer/src/prompts/templates/drive-explain.md` | `drive-link` | false | 20 |
| `src/renderer/src/prompts/templates/drive-extract.md` | `drive-link` | false | 30 |
| `src/renderer/src/prompts/templates/drive-ask.md` | `drive-link` | true | 40 |
| `src/renderer/src/prompts/templates/drive-analyze.md` | `drive-link` | false | 50 |

---

## Project tree rendering changes

### Cloud icon for .gdrive

`ProjectTreeNode.tsx` – new branch in `renderIcon()`:

```typescript
const isGDriveLink = node.extension === '.gdrive'

if (isGDriveLink) {
  return <Cloud size={16} strokeWidth={2} />
}
```

Add `'cloud'` to `iconRegistry.tsx` as new `IconName` entry.

### Display name from frontmatter

`FileNode` interface gains optional fields:

```typescript
driveDisplayName?: string    // from frontmatter `name`
driveLastModified?: string   // ISO 8601 from frontmatter `last_modified`
```

`FileService.readDirectory()` remains unchanged – it returns raw `FileNode` objects with no knowledge of `.gdrive` semantics. A post-processing enrichment step in the IPC handler calls `DriveLinkService.enrichNodes(nodes: FileNode[]): Promise<FileNode[]>` which scans for `.gdrive` nodes, reads their frontmatter (cached by file mtime), and populates `driveDisplayName` and `driveLastModified`. This mirrors how git status is overlaid separately rather than embedded in FileService.

Label: `node.driveDisplayName ?? node.name`

### Freshness indicator

`DriveFreshnessIndicator` component renders relative time:

```typescript
function formatFreshness(isoDate: string): string {
  const delta = Date.now() - new Date(isoDate).getTime()
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d ago`
  return `${Math.floor(delta / 604_800_000)}w ago`
}
```

Positioned after label, before git status badge. Only rendered when `driveLastModified` is defined.

### Double-click behavior

Check `node.extension === '.gdrive'` at `onFileClick`. If double-click → `window.api.shell.openExternal(url)`. Single-click → open in Monaco (raw frontmatter + notes).

Before calling `shell.openExternal(url)`, validate that `new URL(url).protocol === 'https:'`. Reject URLs with other protocols (http, javascript, file, data) with a toast: 'Invalid URL protocol – only HTTPS links are supported.'

---

## Security hardening

### BrowserWindow for OAuth and Picker

```typescript
const secureWindowOptions = {
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false
  }
}
```

### Navigation restriction

```typescript
const ALLOWED_ORIGINS = [
  'accounts.google.com', 'oauth2.googleapis.com',
  'apis.google.com', 'drive.google.com', '127.0.0.1'
]

win.webContents.on('will-navigate', (event, url) => {
  const hostname = new URL(url).hostname
  const allowed = ALLOWED_ORIGINS.some(
    o => hostname === o || hostname.endsWith('.googleapis.com') || hostname.endsWith('.google.com')
  )
  if (!allowed) event.preventDefault()
})

win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
```

### Token encryption

Refresh tokens encrypted via `safeStorage.encryptString()`. Files at `0o600`, directory at `0o700`. Access tokens only in memory – gone on process restart; `getAccessToken()` auto-refreshes.

### Scope minimization

Only `drive.file`. No `drive` (full), no `drive.readonly`, no `gmail`, no `calendar`.

### Google Picker CSP

Picker BrowserWindow loads `apis.google.com/js/api.js`. Targeted CSP set via `webRequest.onHeadersReceived()`:

```
script-src 'self' https://apis.google.com https://*.googleapis.com;
frame-src https://docs.google.com;
connect-src https://*.googleapis.com https://accounts.google.com;
img-src 'self' data: https://*.googleusercontent.com
```

Only applies to the Picker window, not the main window.

### Error message sanitization

All Drive service errors are sanitized before crossing the IPC boundary. Access tokens, authorization headers, and URL query parameters containing credentials are stripped. Only the `ErrorCode` (from the unified enum in `src/shared/errors.ts`) and a user-friendly message string are passed to the renderer (see ADR-008).

### shell:openExternal protocol validation

The existing `shell:openExternal` handler at `src/main/ipc/shell-handlers.ts` passes URLs directly to Electron's `shell.openExternal()` without server-side protocol validation. The comment states "Dangerous protocols should be blocked in renderer" – this is insufficient for defense-in-depth.

**Required change (020-FR-047):** Add server-side URL protocol validation in the handler:

```typescript
const parsed = new URL(url)
const ALLOWED_PROTOCOLS = new Set(['https:', 'mailto:'])
if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
  throw new AppError(
    `Protocol ${parsed.protocol} not allowed`,
    ErrorCode.PATH_INVALID
  )
}
```

This benefits all callers (markdown preview links, Drive URLs, etc.), not just Drive integration.

---

## OAuth client ID bundling

Read from `process.env.GOOGLE_OAUTH_CLIENT_ID` in the main process. The value is injected via electron-vite `define` configuration in `electron.vite.config.ts`:

```typescript
// electron.vite.config.ts
main: {
  define: {
    'process.env.GOOGLE_OAUTH_CLIENT_ID': JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_ID),
    'process.env.GOOGLE_PICKER_API_KEY': JSON.stringify(process.env.GOOGLE_PICKER_API_KEY)
  }
}
```

The main process has zero `import.meta.env` usage in the codebase – this convention must be maintained. `DriveAuthService` throws a clear startup error if the value is missing.

## Settings overlay integration

`GoogleDriveSettingsSchema` added to `global-settings-schema.ts`:

```typescript
export const GoogleDriveSettingsSchema = z.object({
  /** Feature flag – set to false to disable all Drive UI and IPC */
  enabled: z.boolean().default(true)
})
```

Embedded under `googleDrive` key in `GlobalSettingsSchema`.

**Note:** `connected` and `accountEmail` are NOT stored in settings – they are runtime state derived from `DriveAuthService.isAuthenticated()` and `getAccountInfo()`. They belong in the `useDriveStore` Zustand store, not in the persisted settings schema. The settings schema stores only user-configurable preferences.

`GoogleDriveSection.tsx` uses `window.api.drive.isAuthenticated()` and `getAccountInfo()` on mount. Shows account email + "Sign out" when connected, "Sign in with Google" button when disconnected, and linked file count for current project.

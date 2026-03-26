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
  drive_id: z.string().min(10).max(64).regex(/^[a-zA-Z0-9_-]+$/),
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

### OAuth2 flow state machine

```
IDLE → AWAITING_CODE → EXCHANGING → AUTHENTICATED | ERROR
```

1. **IDLE**: No tokens stored. `isAuthenticated()` returns false.
2. **AWAITING_CODE**: `authenticate()` called.
   - Generate PKCE code verifier (32 random bytes, base64url) and challenge (SHA-256, base64url)
   - Start `http.createServer()` on port `0` (dynamic)
   - Redirect URI: `http://127.0.0.1:{port}/oauth/callback`
   - Construct Google authorization URL with scopes, `response_type=code`, PKCE params, `access_type=offline`, `prompt=consent`
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
export type DriveErrorCode =
  | 'NOT_FOUND'         // 404
  | 'PERMISSION_DENIED' // 403
  | 'AUTH_REQUIRED'     // 401
  | 'RATE_LIMITED'      // 429
  | 'OFFLINE'           // ENOTFOUND
  | 'UNKNOWN'

export class DriveApiError extends Error {
  constructor(
    public readonly code: DriveErrorCode,
    message: string,
    public readonly retryable: boolean
  ) { super(message) }
}
```

Rate limit handling: retry up to 3 times with exponential backoff (1s base, 2x multiplier, 30s max).

---

## Prompt template variables

### Extended types

Add to `PromptVariables` and `PromptVariableInput`:

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
4. Build `PromptVariableInput` with all Drive fields
5. `renderTemplate(template, variables)` → final prompt string
6. Dispatch to terminal
7. On error: toast with mapped message, no prompt pasted

"Ask about document" additionally shows input dialog to collect user's question.

### Template files

| File | `area` | `requiresInput` | `order` |
|---|---|---|---|
| `drive-summarize.md` | `drive-link` | false | 10 |
| `drive-explain.md` | `drive-link` | false | 20 |
| `drive-extract.md` | `drive-link` | false | 30 |
| `drive-ask.md` | `drive-link` | true | 40 |
| `drive-analyze.md` | `drive-link` | false | 50 |

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

`FileService.readDirectory()` detects `.gdrive` files during traversal, calls `DriveLinkService.parse()` for each, populates the fields. On parse failure → graceful degradation (raw filename shown).

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

Only `drive.readonly` + `drive.file`. No `drive` (full), no `gmail`, no `calendar`.

### Google Picker CSP

Picker BrowserWindow loads `apis.google.com/js/api.js`. Targeted CSP set via `webRequest.onHeadersReceived()`:

```
script-src 'self' https://apis.google.com https://*.googleapis.com;
frame-src https://docs.google.com;
connect-src https://*.googleapis.com https://accounts.google.com;
img-src 'self' data: https://*.googleusercontent.com
```

Only applies to the Picker window, not the main window.

---

## OAuth client ID bundling

Read from `import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID` at build time. Set in `.env.local` for development, baked in during CI for production. `DriveAuthService` throws a clear startup error if missing.

## Settings overlay integration

`GoogleDriveSettingsSchema` added to `global-settings-schema.ts`:

```typescript
export const GoogleDriveSettingsSchema = z.object({
  connected: z.boolean().default(false),
  accountEmail: z.string().email().optional()
})
```

Embedded under `googleDrive` key in `GlobalSettingsSchema`.

`GoogleDriveSection.tsx` uses `window.api.drive.isAuthenticated()` and `getAccountInfo()` on mount. Shows account email + "Sign out" when connected, "Sign in with Google" button when disconnected, and linked file count for current project.

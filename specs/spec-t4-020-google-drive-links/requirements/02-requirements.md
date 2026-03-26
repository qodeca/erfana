# 020 – Google Drive link integration: Requirements

## Functional requirements

### .gdrive file format

- **020-FR-001**: The system shall support a `.gdrive` file format consisting of YAML frontmatter (metadata) and an optional markdown body (local notes/annotations).
- **020-FR-002**: The YAML frontmatter shall include required fields: `type` (document | spreadsheet | presentation | file), `drive_id` (Google Drive file ID), `name` (display name), `url` (Google Drive URL), `mime_type` (Google MIME type), `linked_at` (ISO 8601 timestamp).
- **020-FR-003**: The YAML frontmatter shall include optional cached metadata fields: `last_modified` (ISO 8601), `modified_by` (email), `size_bytes` (integer).
- **020-FR-004**: The system shall validate `.gdrive` files against a Zod schema on read, rejecting files with missing required fields or invalid field types.
- **020-FR-005**: The markdown body below the frontmatter shall be treated as user-authored local notes, editable in the Monaco editor like any other file.

### Authentication

- **020-FR-006**: On first use of any Drive feature, the system shall prompt the user with "Sign in with Google" and open a BrowserWindow with Google's standard OAuth2 consent screen.
- **020-FR-007**: The OAuth2 flow shall use the loopback redirect method (HTTP server on `127.0.0.1` with dynamic port) with PKCE (S256 code challenge method) and a cryptographic `state` parameter for CSRF protection.
- **020-FR-008**: The system shall store refresh tokens encrypted via Electron `safeStorage`, following the existing `ApiKeyService` pattern.
- **020-FR-009**: The system shall silently refresh expired access tokens using the stored refresh token without user interaction.
- **020-FR-010**: The system shall provide a sign-out action that clears all stored tokens and revokes the Google OAuth grant.
- **020-FR-011**: The system shall request a single OAuth scope: `drive.file` (manage files created or opened by the app via Picker). The `drive.readonly` scope shall not be requested, limiting access to only files the user explicitly selects.
- **020-FR-012**: The OAuth client ID shall be bundled with the application – users shall never need to configure GCP projects or API keys.

### Google Picker integration

- **020-FR-013**: The system shall provide a "Link Google Drive file" action in the directory context menu that opens Google Picker in a BrowserWindow popup.
- **020-FR-014**: Google Picker shall allow the user to browse, search, and select one or more Drive files.
- **020-FR-015**: Upon file selection in the Picker, the system shall create `.gdrive` files in the right-clicked directory, one per selected file.
- **020-FR-016**: The `.gdrive` filename shall be derived from the Drive file name, sanitized for the local file system (lowercase, spaces to hyphens, special chars removed), with `.gdrive` extension.
- **020-FR-017**: If a `.gdrive` file with the same name already exists in the target directory, the system shall use the existing copy-increment pattern (e.g., `report (1).gdrive`).
- **020-FR-018**: If the user is not authenticated when triggering the Picker, the system shall initiate the sign-in flow first, then open the Picker upon successful authentication.

### Services

- **020-FR-019**: `DriveAuthService` shall manage the full OAuth2 lifecycle: authenticate, getAccessToken, signOut, isAuthenticated, getAccountInfo.
- **020-FR-020**: `DriveLinkService` shall handle `.gdrive` file operations: create, parse, update, validate, list (all `.gdrive` files in a project). This service shall perform no network calls.
- **020-FR-021**: `DriveApiService` shall wrap googleapis SDK calls: `fetchMetadata`, `fetchContent`, `exportFile`. It shall depend on `DriveAuthService` for token injection. It is a pure API wrapper with no UI or file-system concerns. Picker functionality is handled by `DrivePickerService` (separate service per ADR-003).
- **020-FR-022**: `DriveApiService.fetchContent` shall return plain text content appropriate to the file type: document body for Docs, cell values for Sheets, slide text for Presentations, raw content or export for generic files.

### IPC channels

- **020-FR-023**: The system shall expose IPC channels: `drive:authenticate`, `drive:signOut`, `drive:isAuthenticated`, `drive:getAccountInfo`, `drive:openPicker`, `drive:fetchContent`, `drive:refreshMetadata`, `drive:refreshAllMetadata`, `drive:exportAsPdf`, `drive:linkFiles`.
- **020-FR-024**: All IPC channel inputs and outputs shall be validated with Zod schemas in `src/shared/ipc/drive-schema.ts`.

### Project tree integration

- **020-FR-025**: `.gdrive` files shall display with a `Cloud` icon (Lucide) in the project tree, replacing the default `File` icon.
- **020-FR-026**: The project tree shall display the `name` field from frontmatter as the node label instead of the filename.
- **020-FR-027**: The project tree node shall show a freshness indicator based on the cached `last_modified` field (e.g., "2d ago").
- **020-FR-028**: Double-clicking a `.gdrive` file shall open the linked document in the default browser via `shell.openExternal(url)`.
- **020-FR-029**: Single-clicking a `.gdrive` file shall open it in the Monaco editor, showing the raw frontmatter and markdown body for editing local notes.

### Context menu

- **020-FR-030**: The system shall implement `DriveFileContextMenuStrategy` following the existing factory pattern in `src/renderer/src/components/ProjectTree/context-menu/`.
- **020-FR-031**: The context menu for `.gdrive` files shall include direct operations: Open in browser, Fetch content (display in terminal or new tab), Export as PDF, Refresh metadata, Copy Drive URL, Unlink (delete `.gdrive` file with confirmation).
- **020-FR-032**: The context menu shall include AI prompt actions: Summarize, Explain, Extract key points, Ask about document (requires user input), Analyze with context.
- **020-FR-033**: AI prompt actions shall fetch document content via `DriveApiService` before rendering the prompt template, injecting it as the `driveContent` template variable.

### Prompt templates

- **020-FR-034**: New prompt templates shall be created with `area: drive-link` and `subArea: context-menu` in `src/renderer/src/prompts/templates/`.
- **020-FR-035**: The prompt template engine shall support new variables: `driveContent`, `driveName`, `driveType`, `driveUrl`, `driveMimeType`.
- **020-FR-036**: Prompt templates for Drive links shall follow the existing template format (YAML frontmatter + Handlebars-style content body).

### Metadata refresh

- **020-FR-037**: Right-clicking a `.gdrive` file shall offer a "Refresh metadata" action that fetches current metadata from Drive API and updates the frontmatter fields (`last_modified`, `modified_by`, `size_bytes`, `name`).
- **020-FR-038**: Right-clicking a directory shall offer "Refresh all Drive links" that refreshes metadata for all `.gdrive` files within the directory (non-recursive).

### Settings overlay

- **020-FR-039**: The settings overlay shall include a "Google Drive" section showing: connected Google account email (or "Not connected"), a Sign in / Sign out button, and the count of linked files in the current project.

### Claude Code integration

- **020-FR-040**: The project CLAUDE.md shall be updated with a "Google Drive links" section documenting: `.gdrive` file format, how to discover links (`glob *.gdrive`), and the correct `gws` CLI commands per file type.

### Security and validation

- **020-FR-041**: The `drive:fetchContent` handler shall validate that the requested `driveId` matches a `.gdrive` file in the currently open project (via `DriveLinkService.list()`) before making any Google API call. Requests for unlinked file IDs shall be rejected with a structured error.
- **020-FR-042**: Long-running IPC operations (`drive:fetchContent`, `drive:refreshAllMetadata`, `drive:openPicker`) shall accept an optional `AbortSignal` for cancellation, following the `TranscriptionService` pattern.
- **020-FR-043**: Before calling `shell.openExternal()` with a URL from `.gdrive` frontmatter, the system shall validate that the URL uses the `https:` protocol. URLs with other protocols (http, javascript, file, etc.) shall be rejected.
- **020-FR-044**: If a token refresh response from Google includes a new refresh token (token rotation), the system shall store the new token immediately, replacing the previous one.

### Feature management

- **020-FR-045**: The system shall support a `googleDrive.enabled` feature flag in `GlobalSettingsSchema` (default: `true`). When disabled, all Drive context menu items and settings UI shall be hidden, tree enrichment shall be skipped, and `drive:*` IPC handlers shall return `{ success: false, errorCode: 'DRIVE_FEATURE_DISABLED' }`.
- **020-FR-046**: The renderer shall manage Drive integration state via a `useDriveStore` Zustand store (`src/renderer/src/stores/useDriveStore.ts`), following the `useGitStore` / `useTranscriptionStore` pattern. The store shall track: `isAuthenticated`, `accountEmail`, `isPickerOpen`, `isFetchingContent`, and expose actions for state transitions. Components shall read auth state from this store, not from direct IPC calls.
- **020-FR-047**: The `shell:openExternal` IPC handler in `src/main/ipc/shell-handlers.ts` shall validate the URL protocol server-side, rejecting protocols other than `https:` and `mailto:` with a structured error. This is a codebase-wide hardening that benefits Drive links but applies to all `shell:openExternal` callers.
- **020-FR-048**: Before Phase 3b implementation begins, a proof-of-concept spike shall verify that Google Picker API loads and functions correctly inside an Electron BrowserWindow with `contextIsolation: true` and `sandbox: true`. The spike shall document exact CSP requirements and whether `'unsafe-eval'` is needed. If the Picker fails in a sandboxed BrowserWindow, the fallback is a custom Drive file browser dialog using `DriveApiService` with the user's `drive.file`-scoped files.
- **020-FR-049**: The `.gdrive` YAML frontmatter shall include an optional `schema_version` field (integer, default `1`). `DriveLinkService.parse()` shall support migrating older schema versions forward, enabling non-breaking format evolution.
- **020-FR-050**: When creating the first `.gdrive` file in a git-tracked project, the system shall check if `*.gdrive` is in `.gitignore`. If not, it shall show a one-time toast: "Consider adding *.gdrive to .gitignore – these files may contain Google Drive IDs and email addresses."
- **020-FR-051**: The Google Picker API key shall be read from `process.env.GOOGLE_PICKER_API_KEY` via electron-vite `define` configuration. It shall never be read via `import.meta.env` in the main process, consistent with the zero `import.meta.env` usage in `src/main/`.

## Non-functional requirements

- **020-NFR-001**: OAuth token refresh shall complete within 2 seconds. If refresh fails, the system shall prompt re-authentication rather than silently failing.
- **020-NFR-002**: Google Picker BrowserWindow shall load within 3 seconds on a standard broadband connection.
- **020-NFR-003**: `.gdrive` file parsing (DriveLinkService.parse) shall complete in under 5ms per file.
- **020-NFR-004**: The system shall handle Google API rate limits gracefully – if a 429 response is received during metadata refresh, display a user-friendly message and retry with exponential backoff.
- **020-NFR-005**: All Google API credentials (refresh tokens, access tokens) shall be encrypted at rest via Electron `safeStorage`. No tokens shall be stored in plain text.
- **020-NFR-006**: The BrowserWindow for OAuth and Picker shall be configured with minimal permissions: no Node.js integration, no remote module, CSP enforced.
- **020-NFR-007**: The OAuth BrowserWindow shall only navigate to Google domains (`accounts.google.com`, `*.googleapis.com`). Navigation to other domains shall be blocked.
- **020-NFR-008**: New services shall follow Erfana's existing DI pattern with interface-first design (`IDriveAuthService`, `IDriveLinkService`, `IDriveApiService`).
- **020-NFR-009**: All new code shall be covered by unit tests (services) and the feature shall include E2E test coverage for the authentication and linking flows.
- **020-NFR-010**: The feature shall degrade gracefully when offline – `.gdrive` files remain visible and editable (local notes), but actions requiring network shall show a clear error message.
- **020-NFR-011**: If `safeStorage.isEncryptionAvailable()` returns false, the system shall refuse to store OAuth refresh tokens and shall display a clear error message requiring a system keyring (e.g., GNOME Keyring, KWallet). The system shall not fall back to plaintext storage for OAuth tokens.
- **020-NFR-012**: Error messages crossing the IPC boundary from Drive services shall be sanitized to never contain access tokens, authorization headers, or URL query parameters containing credentials.
- **020-NFR-013**: The Picker BrowserWindow shall validate `postMessage` event origins against `https://docs.google.com` before processing file selection results. Messages from other origins shall be ignored.
- **020-NFR-014**: The combined size of new npm dependencies (`@googleapis/drive`, `@googleapis/docs`, `@googleapis/sheets`, `google-auth-library`) shall not increase the production ASAR bundle by more than 5 MB. Bundle size shall be verified during Phase 1 and documented.
- **020-NFR-015**: All `drive:*` IPC handlers shall return `{ success: boolean, error?: string, errorCode?: ErrorCode, ...data }` matching the codebase convention in `src/main/ipc/`. Error codes shall extend the `ErrorCode` enum in `src/shared/errors.ts` as `DRIVE_*` entries (e.g., `DRIVE_NOT_FOUND`, `DRIVE_PERMISSION_DENIED`, `DRIVE_AUTH_REQUIRED`, `DRIVE_RATE_LIMITED`, `DRIVE_OFFLINE`, `DRIVE_SCOPE_DENIED`, `DRIVE_INVALID_FILE`, `DRIVE_FEATURE_DISABLED`) – not a separate `DriveErrorCode` type.

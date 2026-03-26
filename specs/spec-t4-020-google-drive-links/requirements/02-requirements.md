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
- **020-FR-007**: The OAuth2 flow shall use the loopback redirect method (HTTP server on `127.0.0.1` with dynamic port) with PKCE for security.
- **020-FR-008**: The system shall store refresh tokens encrypted via Electron `safeStorage`, following the existing `ApiKeyService` pattern.
- **020-FR-009**: The system shall silently refresh expired access tokens using the stored refresh token without user interaction.
- **020-FR-010**: The system shall provide a sign-out action that clears all stored tokens and revokes the Google OAuth grant.
- **020-FR-011**: The system shall request minimal OAuth scopes: `drive.readonly` (list and read files) and `drive.file` (manage files opened by the app).
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
- **020-FR-021**: `DriveApiService` shall wrap googleapis SDK calls: fetchMetadata, fetchContent, listFiles, exportFile, and openPicker. It shall depend on `DriveAuthService` for tokens.
- **020-FR-022**: `DriveApiService.fetchContent` shall return plain text content appropriate to the file type: document body for Docs, cell values for Sheets, slide text for Presentations, raw content or export for generic files.

### IPC channels

- **020-FR-023**: The system shall expose IPC channels: `drive:authenticate`, `drive:signOut`, `drive:isAuthenticated`, `drive:getAccountInfo`, `drive:openPicker`, `drive:fetchContent`, `drive:refreshMetadata`, `drive:linkFiles`.
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

- **020-FR-034**: New prompt templates shall be created with `area: drive-link` and `subArea: context-menu` in `src/renderer/src/prompts/`.
- **020-FR-035**: The prompt template engine shall support new variables: `driveContent`, `driveName`, `driveType`, `driveUrl`, `driveMimeType`.
- **020-FR-036**: Prompt templates for Drive links shall follow the existing template format (YAML frontmatter + Handlebars-style content body).

### Metadata refresh

- **020-FR-037**: Right-clicking a `.gdrive` file shall offer a "Refresh metadata" action that fetches current metadata from Drive API and updates the frontmatter fields (`last_modified`, `modified_by`, `size_bytes`, `name`).
- **020-FR-038**: Right-clicking a directory shall offer "Refresh all Drive links" that refreshes metadata for all `.gdrive` files within the directory (non-recursive).

### Settings overlay

- **020-FR-039**: The settings overlay shall include a "Google Drive" section showing: connected Google account email (or "Not connected"), a Sign in / Sign out button, and the count of linked files in the current project.

### Claude Code integration

- **020-FR-040**: The project CLAUDE.md shall be updated with a "Google Drive links" section documenting: `.gdrive` file format, how to discover links (`glob *.gdrive`), and the correct `gws` CLI commands per file type.

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

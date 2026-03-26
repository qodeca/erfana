# ADR-001–006: Google Drive link integration – architecture decisions

**Spec:** 020 – Google Drive link integration
**Status:** accepted
**Date:** 2026-03-26
**Authors:** marcin

---

## ADR-001: Reference links over sync/cache/mirror

### Context

Erfana is a local-first markdown IDE. Drive documents live in Google's cloud. The feature must bridge these two worlds without compromising the local-first guarantee or introducing hidden background processes.

### Decision

Drive artifacts are represented as `.gdrive` link files containing YAML frontmatter and an optional markdown body. No Drive content is ever cached or mirrored to disk. Metadata (`name`, `last_modified`, `modified_by`, `size_bytes`) is fetched on demand and written back into the frontmatter as a light cache – visible as a freshness indicator but never treated as authoritative content.

### Rationale

Sync introduces state reconciliation complexity (conflicts, stale reads, partial syncs) that is out of scope for v1. Link files are git-trackable, human-readable, individually visible in the project tree, and trivially editable. They degrade gracefully offline – the file remains visible and its local notes body is editable even when Drive is unreachable (020-NFR-010).

### Consequences

Positive: no background polling, no hidden disk usage, no conflict resolution logic, full offline readability of local notes.
Negative: Drive content is not searchable within Erfana; metadata freshness depends on user-triggered refresh rather than passive updates.

Existing pattern: `FileService` (`src/main/services/FileService.ts`) establishes the convention of treating files as the ground truth for project state.

---

## ADR-002: googleapis SDK for Erfana, gws CLI for Claude Code

### Context

Two separate consumers need to read Drive content: Erfana itself (for context menu AI prompts and metadata refresh) and Claude Code running in the integrated terminal (for agentic workflows). Each consumer operates in a different runtime environment with different authentication contexts.

### Decision

Erfana uses the `@googleapis/drive`, `@googleapis/docs`, `@googleapis/sheets`, and `google-auth-library` Node.js packages inside the main process for all network operations. Claude Code uses the `gws` CLI already present in the developer environment (`gws docs documents get`, `gws sheets spreadsheets values get`, etc.). The `.gdrive` frontmatter encodes `drive_id`, `type`, and `mime_type` – sufficient to construct the correct `gws` command without any additional Erfana tooling (UC-005).

### Rationale

The googleapis SDK gives Erfana typed responses, proper error handling, token injection, and backoff retry. It runs in Node.js inside the main process – the correct Electron environment for network calls. The gws CLI is already authenticated independently; adding a secondary SDK auth stack to the terminal environment would be redundant. Keeping these paths separate avoids coupling Claude Code's tool use to Erfana's OAuth session.

### Consequences

Positive: each consumer uses the tool best suited to its runtime; no IPC bridging needed for Claude Code agentic flows.
Negative: two auth paths must be kept in sync via CLAUDE.md documentation (020-FR-040, 020-AC-032).

---

## ADR-003: Three-service decomposition

### Context

Drive integration spans three distinct concerns: credential lifecycle, local file operations, and Google API calls. Following Erfana's interface-first DI pattern (020-NFR-008), these must be separated into individually testable units. The existing `ApiKeyService` / `TranscriptionService` split establishes the precedent: one service stores credentials, another uses them.

### Decision

Three services with explicit interface contracts:

- `IDriveAuthService` / `DriveAuthService` – owns the OAuth2 lifecycle: `authenticate`, `getAccessToken`, `signOut`, `isAuthenticated`, `getAccountInfo`. Wraps `google-auth-library` OAuth2Client; delegates encrypted storage to safeStorage following the `ApiKeyService` pattern.
- `IDriveLinkService` / `DriveLinkService` – owns `.gdrive` file CRUD: `create`, `parse`, `update`, `validate`, `list`. Makes zero network calls. Uses the same YAML parsing library as the prompt system; validates with a Zod schema (020-FR-004).
- `IDriveApiService` / `DriveApiService` – wraps googleapis SDK calls: `fetchMetadata`, `fetchContent`, `listFiles`, `exportFile`, `openPicker`. Depends solely on `IDriveAuthService` for token injection.

### Rationale

`DriveLinkService` being network-free makes it trivially testable without HTTP mocks. `DriveApiService` has a single injected dependency so it can be unit tested with a mock auth service. This mirrors the `ApiKeyService` (stores credentials) / `TranscriptionService` (consumes them) split already in the codebase.

### Consequences

Positive: unit tests for file operations need no HTTP mocks; future MCP server extraction can reuse `DriveApiService` directly.
Negative: three service registrations added to the main process bootstrap; `DriveLinkService` must duplicate the YAML parsing setup already in the renderer-side prompt parser.

---

## ADR-004: OAuth2 loopback with BrowserWindow

### Context

Consumer-grade OAuth ("Sign in with Google") requires a redirect URI. Google's OAuth policy for installed native apps mandates the loopback method (`127.0.0.1` with a dynamic port). The OAuth BrowserWindow must be locked down – a misconfigured window could expose Node.js APIs to Google's consent page.

### Decision

`DriveAuthService.authenticate()` spawns an ephemeral HTTP server on a random localhost port, opens a `BrowserWindow` with `nodeIntegration: false`, `contextIsolation: true`, and a strict CSP that permits only `accounts.google.com` and `*.googleapis.com`. A `will-navigate` listener blocks navigation to any domain outside that allowlist (020-AC-005). After receiving the auth code on the loopback listener, both the server and window are destroyed. PKCE is used for code exchange. The resulting refresh token is stored via `safeStorage.encryptString()` following the existing `ApiKeyService` encryption pattern (file mode `0o600`).

### Rationale

The loopback pattern is Google's recommended approach for installed apps and requires no publicly hosted redirect URI. Reusing the `ApiKeyService` encryption approach avoids duplicating safeStorage logic. The BrowserWindow allowlist directly satisfies 020-NFR-006 and 020-NFR-007.

### Consequences

Positive: no user-visible GCP configuration required; tokens encrypted at rest; OAuth window cannot execute Node.js.
Negative: loopback may be blocked by enterprise firewalls or antivirus (risk documented in `05-notes.md`); external refresh token revocation must be detected on the next 401 and trigger re-authentication.

---

## ADR-005: Context menu strategy pattern extension

### Context

The project tree's `ContextMenuFactory` (`src/renderer/src/components/ProjectTree/context-menu/factory.ts`) uses an ordered strategy list and picks the first strategy whose `supports(node)` returns `true`. Currently two strategies are registered: `DirectoryContextMenuStrategy` and `FileContextMenuStrategy`. Adding `.gdrive` support must not modify the dispatch logic in either existing strategy.

### Decision

Add `DriveFileContextMenuStrategy` implementing `IContextMenuStrategy`. Its `supports(node)` returns `true` when `node.type === 'file' && node.extension === '.gdrive'`. It is inserted before `FileContextMenuStrategy` in the factory's strategy array so that the more specific match wins.

`build()` produces two sections separated by a visual separator: direct operations (Open in browser, Fetch content, Export as PDF, Refresh metadata, Copy Drive URL, Unlink) and AI prompt actions (Summarize, Explain, Extract key points, Ask about document, Analyze with context). AI actions call `DriveApiService.fetchContent()` before invoking the prompt renderer, injecting `driveContent` into the variable bag. `MenuContext` is extended with a `drive` field providing the renderer-side IPC bridge.

### Rationale

The strategy pattern's `supports()` dispatch guarantees zero changes to existing strategies. Inserting before `FileContextMenuStrategy` follows the specificity-first convention already implicit in the existing ordering. Extending `MenuContext` with a new optional field is non-breaking for all existing strategy implementations.

### Consequences

Positive: `FileContextMenuStrategy` and `DirectoryContextMenuStrategy` are entirely unchanged; new strategy is independently testable.
Negative: `ContextMenuFactory` constructor must be updated to include the new strategy; `MenuContext` interface gains a new optional dependency.

---

## ADR-006: Prompt template area extension

### Context

The prompt template engine validates templates against `PromptFrontmatterSchema` (`src/renderer/src/prompts/schema.ts`) which uses a closed `z.enum` for `area`: `markdown-preview`, `code-editor`, `global`, `diagram-viewer`. Drive prompt templates need their own area so they can be filtered and discovered separately from editor-context prompts.

### Decision

Extend `PromptFrontmatterSchema.area` to include `'drive-link'` as a fifth enum value. Add five template files: `drive-summarize.md`, `drive-explain.md`, `drive-extract.md`, `drive-ask.md` (with `requiresInput: true`), and `drive-analyze.md`. All use `area: drive-link` and `subArea: context-menu`.

Extend `PromptVariables` and `PromptVariableInput` with five Drive-specific optional fields: `driveContent`, `driveName`, `driveType`, `driveUrl`, `driveMimeType`. Drive prompt content fetch and variable construction is the responsibility of `DriveFileContextMenuStrategy` – the renderer remains content-agnostic.

### Rationale

Adding one enum value is the minimal, non-breaking change (one location, all other areas and their tests unaffected). Keeping content fetch in the strategy rather than the renderer preserves the renderer's pure-function character, consistent with the pattern for `mermaidCode` and `mermaidError` injection in diagram templates. The `drive-ask.md` template uses the existing `requiresInput: true` / `inputLabel` mechanism to collect the user's question before rendering.

### Consequences

Positive: Drive templates participate in the same registry, filtering, and rendering pipeline as all other templates; future MCP-based content fetch is a strategy-layer change only.
Negative: `PromptFrontmatterSchema` enum must be updated and schema tests must include `'drive-link'` in valid-area test cases.

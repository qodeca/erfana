# 020 – Google Drive link integration: Notes

## Dependencies

### New npm packages

| Package | Purpose | Size impact |
|---------|---------|-------------|
| `@googleapis/drive` | Drive API v3 (list, metadata, export) | ~2 MB |
| `@googleapis/docs` | Docs API (read document content) | ~1 MB |
| `@googleapis/sheets` | Sheets API (read cell values) | ~1 MB |
| `google-auth-library` | OAuth2 client (peer dep of googleapis) | ~1 MB |
| `p-limit` | Concurrency limiter for bulk metadata refresh | ~5 KB |

### Existing dependencies leveraged

- `electron` safeStorage API (token encryption)
- `js-yaml` (already installed, package.json:66) – used by prompt parser, reuse for .gdrive frontmatter parsing
- `lucide-react` Cloud icon (already installed)

### External dependencies

- Google Cloud Platform project with OAuth client ID configured (developer setup, not user-facing)
- Google Picker API enabled on the GCP project
- `gws` CLI installed and authenticated (for Claude Code integration only – not required for Erfana functionality)

## Constraints

- **OAuth client ID bundling:** The OAuth client ID will be bundled with the app binary. For open-source distribution, this may need to be configured via environment variable or first-run setup. Consider a fallback to user-provided client ID.
- **Google Picker API:** Requires loading Google's JavaScript API client library (`apis.google.com/js/api.js`) in the BrowserWindow. This is a Google-hosted script – CSP must allow it.
- **API quotas:** Google Drive API has a default quota of 20,000 requests per 100 seconds and a hard limit of 3 writes/second. Bulk "Refresh all Drive links" must throttle requests.
- **Scope limitations:** The app uses `drive.file` scope only, which limits access to files the user explicitly selects via Picker. This means Erfana cannot list or read files the user has not opened through the app. For Claude Code's broader access, `gws` CLI uses its own independent authentication with wider scopes.
- **Single Google account:** v1 supports one Google account at a time. Signing into a different account invalidates links created under the previous account. Multi-account support is a future consideration.
- **Corporate Google Workspace:** Organizations may restrict OAuth consent to admin-approved apps only. Users in such environments will see a 403 `admin_policy_enforced` error. Erfana shows a clear message directing the user to contact their IT administrator or use a personal account.
- **PII in `.gdrive` files:** `.gdrive` files contain `drive_id` (direct reference to a Google document) and optionally `modified_by` (email address). For public repositories, consider adding `*.gdrive` to `.gitignore` to prevent accidental exposure.

## Assumptions

- Users have a Google account and are familiar with the "Sign in with Google" flow.
- Google Picker API remains available and stable for Electron BrowserWindow usage.
- The `js-yaml` library is available for YAML parsing of `.gdrive` frontmatter.
- The project's existing file watcher infrastructure will correctly detect `.gdrive` file changes triggered by DriveLinkService writes.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Google deprecates Picker API | Low | High | Fall back to custom Drive browser dialog using SDK `files.list` |
| OAuth loopback flow blocked by firewall/antivirus | Low | Medium | Document firewall exception; consider custom protocol handler as alternative |
| Large Google Docs cause slow content fetch | Medium | Low | Truncate content for prompt injection; show loading indicator |
| Token revocation by user via Google account settings | Medium | Low | Detect 401 on next request, prompt re-authentication |
| `drive.file` scope still requires Google's OAuth verification for published apps | Medium | Medium | For initial development, use "Testing" mode (100 users). For wider release, complete Google's OAuth verification process |
| Corporate OAuth blocking | Medium | Medium | Show clear error message; document as known limitation |
| safeStorage unavailable on Linux | Low | High | Refuse to store tokens; show error requiring keyring installation |
| Picker CSP requires `unsafe-eval` | High | Low | Test exact CSP requirements during implementation; scope permissive CSP to Picker window only |

## Future considerations

- **MCP server:** Extract `DriveLinkService` + `DriveApiService` into an MCP server so Claude Code can discover and read Drive content programmatically (without `gws` CLI dependency).
- **Background metadata refresh:** Periodic polling via `changes.list` API to keep `.gdrive` freshness indicators accurate without manual refresh.
- **Google Drive folder links:** Support linking an entire Drive folder, displayed as a virtual subtree in the project tree.
- **Bidirectional editing:** Allow editing Docs/Sheets content from within Erfana (requires Google Docs API write access).
- **Shared Drive support:** Extend Picker and API calls to include Shared Drives (requires `drive.readonly` scope or broader).
- **Multiple Google accounts:** Support linking files from different Google accounts, with per-link account tracking and automatic token selection based on the `.gdrive` file's account.

## Architecture notes

### Service placement

```
src/main/services/
├── DriveAuthService.ts       # OAuth2 lifecycle
├── DriveLinkService.ts       # .gdrive file CRUD (pure file ops)
├── DriveApiService.ts        # googleapis SDK wrapper
├── DrivePickerService.ts     # Google Picker BrowserWindow orchestration
src/main/interfaces/
├── IDriveAuthService.ts      # Auth service interface
├── IDriveLinkService.ts      # Link service interface
├── IDriveApiService.ts       # API service interface
├── IDrivePickerService.ts    # Picker service interface
src/main/ipc/
├── drive-handlers.ts         # IPC handler registration
src/shared/ipc/
├── drive-schema.ts           # Zod schemas for drive:* channels
src/preload/
├── index.ts                  # Add drive.* API bridge
├── picker-preload.ts         # Minimal preload for Picker BrowserWindow – exposes only `sendPickerResult(files)` via `contextBridge`
src/renderer/src/
├── components/ProjectTree/context-menu/
│   └── strategies.tsx        # Add DriveFileContextMenuStrategy
├── prompts/templates/
│   ├── drive-summarize.md
│   ├── drive-explain.md
│   ├── drive-extract.md
│   ├── drive-ask.md
│   └── drive-analyze.md
├── components/Settings/
│   └── (add Google Drive section)
```

### Relationship to existing services

- `DriveAuthService` follows the same encryption pattern as `ApiKeyService`
- `DriveLinkService` follows the same YAML parsing approach as the prompt `parser.ts`
- `DriveApiService` follows the same external API pattern as `TranscriptionService`
- `DrivePickerService` handles BrowserWindow lifecycle for the Google Picker, separated from `DriveApiService` to maintain single responsibility (DriveApiService = pure API calls, DrivePickerService = UI orchestration)
- `DriveFileContextMenuStrategy` plugs into the existing `ContextMenuFactory`
- New prompt templates use the existing `area` / `subArea` / template variable system

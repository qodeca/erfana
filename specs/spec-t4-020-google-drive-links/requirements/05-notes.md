# 020 – Google Drive link integration: Notes

## Dependencies

### New npm packages

| Package | Purpose | Size impact |
|---------|---------|-------------|
| `@googleapis/drive` | Drive API v3 (list, metadata, export) | ~2 MB |
| `@googleapis/docs` | Docs API (read document content) | ~1 MB |
| `@googleapis/sheets` | Sheets API (read cell values) | ~1 MB |
| `google-auth-library` | OAuth2 client (peer dep of googleapis) | ~1 MB |

### Existing dependencies leveraged

- `electron` safeStorage API (token encryption)
- `yaml` or `gray-matter` (YAML frontmatter parsing – check if already used by prompt parser)
- `lucide-react` Cloud icon (already installed)

### External dependencies

- Google Cloud Platform project with OAuth client ID configured (developer setup, not user-facing)
- Google Picker API enabled on the GCP project
- `gws` CLI installed and authenticated (for Claude Code integration only – not required for Erfana functionality)

## Constraints

- **OAuth client ID bundling:** The OAuth client ID will be bundled with the app binary. For open-source distribution, this may need to be configured via environment variable or first-run setup. Consider a fallback to user-provided client ID.
- **Google Picker API:** Requires loading Google's JavaScript API client library (`apis.google.com/js/api.js`) in the BrowserWindow. This is a Google-hosted script – CSP must allow it.
- **API quotas:** Google Drive API has a default quota of 20,000 requests per 100 seconds and a hard limit of 3 writes/second. Bulk "Refresh all Drive links" must throttle requests.
- **Scope limitations:** `drive.readonly` allows listing and reading all files. `drive.file` only allows managing files the app has created or that the user explicitly opened via the Picker. For reading arbitrary files, `drive.readonly` is the relevant scope.

## Assumptions

- Users have a Google account and are familiar with the "Sign in with Google" flow.
- Google Picker API remains available and stable for Electron BrowserWindow usage.
- The `gray-matter` or equivalent YAML parsing library is available or can be added without conflict.
- The project's existing file watcher infrastructure will correctly detect `.gdrive` file changes triggered by DriveLinkService writes.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Google deprecates Picker API | Low | High | Fall back to custom Drive browser dialog using SDK `files.list` |
| OAuth loopback flow blocked by firewall/antivirus | Low | Medium | Document firewall exception; consider custom protocol handler as alternative |
| Large Google Docs cause slow content fetch | Medium | Low | Truncate content for prompt injection; show loading indicator |
| Token revocation by user via Google account settings | Medium | Low | Detect 401 on next request, prompt re-authentication |
| `drive.readonly` scope triggers Google's security review for published apps | Medium | Medium | For initial development, use "Testing" mode (100 users). For wider release, complete Google's OAuth verification process |

## Future considerations

- **MCP server:** Extract `DriveLinkService` + `DriveApiService` into an MCP server so Claude Code can discover and read Drive content programmatically (without `gws` CLI dependency).
- **Background metadata refresh:** Periodic polling via `changes.list` API to keep `.gdrive` freshness indicators accurate without manual refresh.
- **Google Drive folder links:** Support linking an entire Drive folder, displayed as a virtual subtree in the project tree.
- **Bidirectional editing:** Allow editing Docs/Sheets content from within Erfana (requires Google Docs API write access).
- **Shared Drive support:** Extend Picker and API calls to include Shared Drives (requires `drive.readonly` scope or broader).

## Architecture notes

### Service placement

```
src/main/services/
├── DriveAuthService.ts       # OAuth2 lifecycle
├── DriveLinkService.ts       # .gdrive file CRUD (pure file ops)
├── DriveApiService.ts        # googleapis SDK wrapper
src/main/ipc/
├── drive-handlers.ts         # IPC handler registration
src/shared/ipc/
├── drive-schema.ts           # Zod schemas for drive:* channels
src/preload/
├── index.ts                  # Add drive.* API bridge
src/renderer/src/
├── components/ProjectTree/context-menu/
│   └── strategies.tsx        # Add DriveFileContextMenuStrategy
├── prompts/
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
- `DriveFileContextMenuStrategy` plugs into the existing `ContextMenuFactory`
- New prompt templates use the existing `area` / `subArea` / template variable system

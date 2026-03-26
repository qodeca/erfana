# 020 – Google Drive link integration: Notes

## Dependencies

### New npm packages

| Package | Purpose | Size impact |
|---------|---------|-------------|
| `@googleapis/drive` | Drive API v3 (list, metadata, export) | ~2 MB |
| `@googleapis/docs` | Docs API (read document content) | ~1 MB |
| `@googleapis/sheets` | Sheets API (read cell values) | ~1 MB |
| `google-auth-library` | OAuth2 client (peer dep of googleapis) | ~1 MB |
| *(none – concurrency limiting uses inline semaphore)* | Bulk metadata refresh uses a simple ~20-line semaphore utility | 0 |

### Existing dependencies leveraged

- `electron` safeStorage API (token encryption)
- `js-yaml` (already installed, package.json:66) – used by prompt parser, reuse for .gdrive frontmatter parsing
- `lucide-react` Cloud icon (already installed)

**Version alignment:** `google-auth-library` version must align with the versions expected by `@googleapis/drive`, `@googleapis/docs`, and `@googleapis/sheets` as a peer dependency. Pin to the version range specified by the googleapis packages to avoid subtle auth failures.

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
- **`drive.file` scope and team collaboration:** When `.gdrive` files are committed to a shared repository and cloned by other team members, those team members will NOT have `drive.file` scope access to the referenced documents unless they have independently opened them via their own Google Picker session. This is a fundamental limitation: `drive.file` scope grants access only to files explicitly selected by each user's Picker. Workaround: team members can open the document URL in browser (which uses their own Google session), then re-link via Picker to grant Erfana SDK access. See UC-010.
- **File watcher pause during bulk creation:** When creating multiple `.gdrive` files (Picker multi-select), the `drive:openPicker` handler shall use `withWatcherPause()` (PauseController from `src/main/utils/`) to prevent the DirectoryWatcherService from firing individual change events for each file creation. The tree refresh happens once after all files are created.
- **Retry boundary:** Retry logic (exponential backoff for 429, auto-refresh for 401) is implemented in `DriveApiService` only. IPC handlers and renderer code do not implement their own retry. The renderer receives the final result or error after all retries are exhausted.
- **googleapis ASAR size:** The `@googleapis/drive`, `@googleapis/docs`, and `@googleapis/sheets` packages must be verified for ASAR bundle size impact during Phase 1. If combined size exceeds 5 MB, consider using raw googleapis REST calls with `fetch` instead of the SDK packages.
- **Content truncation for terminal paste:** When `fetchContent` result is injected into a prompt template and pasted to the terminal, the rendered prompt shall be truncated at 100,000 characters total (content + template). This prevents terminal buffer overflow and excessive token consumption.
- **Presentation content limitation:** Google Slides exported as plain text loses all visual formatting, speaker notes hierarchy, and slide boundaries. The exported text is a flat concatenation of all text boxes. This is acceptable for AI prompt injection but should be documented in prompt templates.
- **NFR-002 (Picker load time) not testable in CI:** The 3-second Picker load time target depends on network conditions and Google's server response time. This NFR is verified manually during development, not in automated CI. E2E tests stub the Picker entirely.
- **"Fetch content" action target:** The "Fetch content" context menu action fetches document content and opens it in a new read-only editor tab (titled "{displayName} [Drive]"). It does NOT paste into the terminal. Terminal paste is reserved for AI prompt actions only.
- **No fetchContent progress indicator:** v1 shows a loading toast ("Fetching document content...") but no progress bar. Google's export API does not provide progress callbacks. For large documents, the fetch may take several seconds with no intermediate feedback.
- **Freshness indicator font:** The UX spec uses `var(--font-mono)` for freshness indicators to ensure fixed-width alignment. If this causes visual inconsistency with the proportional display name font, fall back to `var(--font-sans)` with `tabular-nums` CSS property.
- **Color-blind consideration:** The Cloud icon uses `var(--color-brand-violet)` which has sufficient contrast against the dark background. The Cloud shape itself distinguishes `.gdrive` nodes from regular file nodes (which use `File`/`FileText` shapes) – color is supplementary, not the sole differentiator.
- **Freshness indicator screen reader:** The visual freshness text ("2d ago") shall have `aria-hidden="true"`. The equivalent information is conveyed via the tree node's `aria-label` (e.g., "Q1 Sales Report, modified 2 days ago"). See AC-049, AC-050.

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
| Token refresh race condition | Low | Medium | If multiple IPC handlers trigger `getAccessToken()` concurrently while the token is expired, only one refresh request shall be in-flight. Subsequent callers await the same promise. Implemented via a `refreshPromise` singleton in DriveAuthService. |

## Future considerations

- **MCP server:** Extract `DriveLinkService` + `DriveApiService` into an MCP server so Claude Code can discover and read Drive content programmatically (without `gws` CLI dependency).
- **Background metadata refresh:** Periodic polling via `changes.list` API to keep `.gdrive` freshness indicators accurate without manual refresh.
- **Google Drive folder links:** Support linking an entire Drive folder, displayed as a virtual subtree in the project tree.
- **Bidirectional editing:** Allow editing Docs/Sheets content from within Erfana (requires Google Docs API write access).
- **Shared Drive support:** Extend Picker and API calls to include Shared Drives (requires `drive.readonly` scope or broader).
- **Multiple Google accounts:** Support linking files from different Google accounts, with per-link account tracking and automatic token selection based on the `.gdrive` file's account.
- **Batch API for metadata refresh:** Use Google Drive API batch endpoint to refresh multiple file metadata in a single HTTP request, reducing network round-trips for "Refresh all Drive links".
- **Token file cleanup on uninstall:** Consider adding a cleanup script or documentation for removing `~/.erfana/google-drive-*.enc` files on application uninstall.
- **Telemetry:** Consider tracking Drive feature usage (sign-in rate, links created per project, most-used AI prompts) for feature adoption measurement. No telemetry in v1.
- **Markdown-embeddable Drive references:** Support a syntax like `![[drive:report.gdrive]]` in markdown files to inline Drive document content during preview rendering. Requires real-time content fetch and caching strategy.

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

### enrichNodes cache design

`DriveLinkService.enrichNodes()` caches parsed frontmatter keyed by `(filePath, mtime)`. When a `.gdrive` file's mtime has not changed since the last parse, the cached `driveDisplayName` and `driveLastModified` are reused without re-reading the file.

Cache structure: in-memory `Map<string, { mtime: number, displayName: string, lastModified: string | null }>` with a max size of 1000 entries (LRU eviction). Cache is invalidated on project switch.

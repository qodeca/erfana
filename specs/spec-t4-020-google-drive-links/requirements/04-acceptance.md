# 020 – Google Drive link integration: Acceptance criteria

## Authentication

- **020-AC-001**: Given a user with no stored Google tokens, when they trigger any Drive feature, then a "Sign in with Google" prompt appears followed by a BrowserWindow with Google's consent screen.
- **020-AC-002**: Given a user completes the OAuth flow, when the BrowserWindow closes, then tokens are stored in safeStorage and the originally requested action proceeds automatically.
- **020-AC-003**: Given a user with an expired access token, when they trigger a Drive feature, then the token is refreshed silently using the stored refresh token without any visible prompt.
- **020-AC-004**: Given a user clicks "Sign out" in settings, when sign-out completes, then all stored tokens are cleared, the Google grant is revoked, and the settings UI shows "Not connected".
- **020-AC-005**: Given the OAuth BrowserWindow is open, when navigation is attempted to a non-Google domain, then the navigation is blocked.

## Linking files

- **020-AC-006**: Given a user right-clicks a directory, then the context menu includes "Link Google Drive file" with a Cloud icon.
- **020-AC-007**: Given a user selects files in Google Picker, when they click "Select", then `.gdrive` files are created in the target directory with correct frontmatter (all required fields populated).
- **020-AC-008**: Given a `.gdrive` file with the same sanitized name already exists, when a new link is created, then the system appends an increment suffix (e.g., `report (1).gdrive`).
- **020-AC-009**: Given the user is not authenticated, when they trigger "Link Google Drive file", then the sign-in flow completes first and the Picker opens automatically afterward.
- **020-AC-042**: Given a Google Drive file named "Q1 Sales Report (Final v2)", when it is linked via Picker, then the created file is named `q1-sales-report-final-v2.gdrive` (lowercase, spaces to hyphens, special chars removed).

## Project tree display

- **020-AC-010**: Given a directory contains `.gdrive` files, when the tree renders, then each `.gdrive` node shows a Cloud icon (not the default File icon).
- **020-AC-011**: Given a `.gdrive` file with `name: "Q1 Sales Report"` in frontmatter, when displayed in the tree, then the label shows "Q1 Sales Report" (not the filename).
- **020-AC-012**: Given a `.gdrive` file with `last_modified` in frontmatter, when displayed in the tree, then a relative freshness indicator is visible (e.g., "2d ago").
- **020-AC-013**: Given a user double-clicks a `.gdrive` file, then the linked URL opens in the default system browser.
- **020-AC-014**: Given a user single-clicks a `.gdrive` file, then it opens in the Monaco editor showing the raw YAML frontmatter and markdown body.
- **020-AC-041**: Given a `.gdrive` file with invalid YAML syntax (not a schema error – a parse error), when the project tree renders, then the node displays the raw filename (not a display name), shows a warning icon, and no toast notification is triggered.

## Context menu – direct operations

- **020-AC-015**: Given a user right-clicks a `.gdrive` file, then the context menu shows: Open in browser, Fetch content, Export as PDF, Refresh metadata, Copy Drive URL, Unlink.
- **020-AC-016**: Given a user selects "Copy Drive URL", then the `url` field value is copied to the system clipboard and a toast confirms the action.
- **020-AC-017**: Given a user selects "Refresh metadata", then the `.gdrive` frontmatter is updated with current Drive API metadata and the tree node reflects the changes.
- **020-AC-018**: Given a user selects "Unlink", then a confirmation dialog appears; upon confirmation, the `.gdrive` file is deleted and the tree refreshes.

## Context menu – AI prompts

- **020-AC-019**: Given a user right-clicks a `.gdrive` file, then the context menu includes AI actions: Summarize, Explain, Extract key points, Ask about document, Analyze with context.
- **020-AC-020**: Given a user selects "Summarize", then the system fetches document content via SDK, renders the prompt template with `driveContent` injected, and pastes the result into the terminal panel.
- **020-AC-021**: Given a user selects "Ask about document", then an input dialog appears for the user's question, which is included in the rendered prompt alongside the document content.
- **020-AC-022**: Given the Drive document is inaccessible (deleted, unshared), when an AI prompt is triggered, then a toast shows an error message and no prompt is pasted to the terminal.
- **020-AC-043**: Given a linked Google Spreadsheet, when the "Summarize" AI prompt is triggered, then the fetched content passed to the template contains cell values in a structured text format (TSV or similar), not raw HTML or JSON API response.

## Metadata refresh

- **020-AC-023**: Given a user right-clicks a directory containing `.gdrive` files and selects "Refresh all Drive links", then metadata is refreshed for all `.gdrive` files in that directory.
- **020-AC-024**: Given a Drive file has been renamed since linking, when metadata is refreshed, then the `name` field in frontmatter is updated to the new name and the tree label updates accordingly.
- **020-AC-044**: Given a directory containing `.gdrive` files and subdirectories that also contain `.gdrive` files, when "Refresh all Drive links" is triggered on the parent directory, then only `.gdrive` files directly in that directory are refreshed – files in subdirectories are not included.

## Settings overlay

- **020-AC-025**: Given the user opens the settings overlay, then a "Google Drive" section is visible.
- **020-AC-026**: Given the user is signed in, then the settings section shows the connected email address, a "Sign out" button, and the count of `.gdrive` files in the current project.
- **020-AC-027**: Given the user is not signed in, then the settings section shows "Not connected" and a "Sign in with Google" button.

## IPC and schema validation

- **020-AC-028**: Given a renderer sends a `drive:*` IPC message with invalid payload, then the handler returns a structured error (not a crash) and the renderer shows a toast.
- **020-AC-029**: Given all `drive:*` IPC channels, then input and output types are defined in `src/shared/ipc/drive-schema.ts` using Zod schemas.

## Claude Code integration

- **020-AC-030**: Given a project with `.gdrive` files, when Claude Code runs `glob **/*.gdrive`, then all Drive link files are discovered.
- **020-AC-031**: Given Claude Code reads a `.gdrive` file, then the frontmatter contains sufficient information (drive_id, type, name, url, mime_type) to construct the correct `gws` CLI command.
- **020-AC-032**: Given the CLAUDE.md file, then it contains a "Google Drive links" section with format documentation and `gws` command examples for each supported type.

## Offline and error handling

- **020-AC-033**: Given the system is offline, when a user views the project tree, then `.gdrive` files are still visible with their cached display names.
- **020-AC-034**: Given the system is offline, when a user triggers a Drive action requiring network, then a clear error message is shown (not a generic crash or timeout).
- **020-AC-035**: Given Google API returns 429 (rate limited), when refreshing metadata, then the system displays a user-friendly message and retries with exponential backoff.

## Security

- **020-AC-036**: Given the token storage, then refresh tokens are encrypted via `safeStorage` and never stored in plain text.
- **020-AC-037**: Given the OAuth/Picker BrowserWindow, then `nodeIntegration` is disabled, `contextIsolation` is enabled, and CSP is enforced.
- **020-AC-038**: Given the OAuth authorization URL constructed by `DriveAuthService`, then it contains both a cryptographic `state` parameter (random, unguessable) and `code_challenge_method=S256`. The callback handler shall reject responses where the `state` parameter does not match.
- **020-AC-039**: Given a renderer sends `drive:fetchContent` with a `driveId` that does not match any `.gdrive` file in the currently open project, then the handler returns a structured error without making any Google API call.
- **020-AC-040**: Given `safeStorage.isEncryptionAvailable()` returns false, when the user triggers Google sign-in, then the system shows an error message explaining that a system keyring is required and does not attempt to store tokens in plaintext.

## Cancellation and token management

- **020-AC-045**: Given a user triggers "Fetch content" and then cancels (e.g., navigates away or triggers another action), when the AbortSignal fires, then the in-flight Google API request is cancelled and no content is returned to the renderer.
- **020-AC-046**: Given Google returns a new refresh token during a token refresh response (token rotation), then the system stores the new refresh token immediately via safeStorage, replacing the previous one, without user interaction.

## Double-click and keyboard interaction

- **020-AC-047**: Given a user double-clicks a `.gdrive` file in the project tree, then the linked URL opens in the default browser. The first click of the double-click sequence may briefly open the file in Monaco editor before the browser launches – this is documented as expected behavior.
- **020-AC-048**: Given a user presses Enter on a focused `.gdrive` tree node, then the file opens in the Monaco editor (single-click behavior). To open in the browser, the user must use the context menu "Open in browser" action or double-click.

## Accessibility

- **020-AC-049**: Given a `.gdrive` node in the project tree, then the tree item has `aria-label` including the display name, freshness, and type (e.g., "Q1 Sales Report, modified 2 days ago, Google Drive link").
- **020-AC-050**: Given the freshness indicator on a `.gdrive` node, then it has `aria-hidden="true"` (the equivalent information is conveyed via the parent node's `aria-label`).

## PDF export

- **020-AC-051**: Given a user selects "Export as PDF" on a `.gdrive` file, then a save dialog appears allowing the user to choose the destination. The default filename is `{drive-display-name}.pdf` and the default directory is the project root.

## Feature management

- **020-AC-052**: Given `googleDrive.enabled` is set to `false` in global settings, then Drive context menu items are not shown, the Settings Google Drive section shows "Feature disabled", and `drive:*` IPC calls return `{ success: false, errorCode: 'DRIVE_FEATURE_DISABLED' }`.
- **020-AC-053**: Given the renderer mounts any Drive-related component (GoogleDriveSection, DriveFileContextMenuStrategy), then authentication state is read from `useDriveStore` (Zustand), not from direct IPC calls on every render.

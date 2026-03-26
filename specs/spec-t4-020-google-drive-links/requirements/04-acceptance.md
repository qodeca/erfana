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

## Project tree display

- **020-AC-010**: Given a directory contains `.gdrive` files, when the tree renders, then each `.gdrive` node shows a Cloud icon (not the default File icon).
- **020-AC-011**: Given a `.gdrive` file with `name: "Q1 Sales Report"` in frontmatter, when displayed in the tree, then the label shows "Q1 Sales Report" (not the filename).
- **020-AC-012**: Given a `.gdrive` file with `last_modified` in frontmatter, when displayed in the tree, then a relative freshness indicator is visible (e.g., "2d ago").
- **020-AC-013**: Given a user double-clicks a `.gdrive` file, then the linked URL opens in the default system browser.
- **020-AC-014**: Given a user single-clicks a `.gdrive` file, then it opens in the Monaco editor showing the raw YAML frontmatter and markdown body.

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

## Metadata refresh

- **020-AC-023**: Given a user right-clicks a directory containing `.gdrive` files and selects "Refresh all Drive links", then metadata is refreshed for all `.gdrive` files in that directory.
- **020-AC-024**: Given a Drive file has been renamed since linking, when metadata is refreshed, then the `name` field in frontmatter is updated to the new name and the tree label updates accordingly.

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

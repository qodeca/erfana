# 020 – Google Drive link integration: Use cases

## UC-001: First-time Google sign-in

**Actor:** User
**Precondition:** User has never signed into Google within Erfana
**Trigger:** User right-clicks a folder and selects "Link Google Drive file"

**Flow:**
1. System detects no stored Google tokens
2. System shows prompt: "Sign in with Google to link Drive files"
3. User clicks "Sign in"
4. BrowserWindow opens with Google OAuth consent screen
5. User selects their Google account and approves requested permissions
6. Google redirects to loopback URL with auth code
7. System exchanges auth code for tokens, stores refresh token in safeStorage
8. BrowserWindow closes automatically
9. System proceeds with the originally requested action (opens Google Picker)

**Postcondition:** User is authenticated; subsequent Drive actions skip sign-in
**Error path:** If user closes the BrowserWindow without completing sign-in, the original action is cancelled with no error toast.

## UC-002: Link a Google Drive file to a project

**Actor:** User
**Precondition:** User is signed in to Google, a project is open
**Trigger:** User right-clicks a directory in the project tree → "Link Google Drive file"

**Flow:**
1. Google Picker BrowserWindow opens
2. User browses/searches their Drive, selects one or more files
3. User clicks "Select" in the Picker
4. Picker returns selected file metadata (ID, name, MIME type, URL)
5. System creates `.gdrive` files in the target directory (one per selection)
6. Project tree refreshes, showing new nodes with cloud icons and Drive display names
7. Toast confirms: "Linked 2 files from Google Drive"

**Postcondition:** `.gdrive` files exist in the directory, visible in the project tree
**Error path:** If Picker is closed without selection, no files are created. If file creation fails (disk full, permissions), toast shows error.

## UC-003: Execute AI prompt on a linked Drive document

**Actor:** User
**Precondition:** A `.gdrive` file exists in the project tree, user is signed in
**Trigger:** User right-clicks a `.gdrive` file → "Summarize"

**Flow:**
1. System reads `.gdrive` frontmatter to get `drive_id` and `mime_type`
2. System calls `DriveApiService.fetchContent(drive_id, mime_type)` to get document text
3. System renders the "Summarize" prompt template, injecting `driveContent`, `driveName`, `driveType`
4. Rendered prompt is pasted into the terminal panel
5. Claude Code (or other CLI tool) processes the prompt with the document content

**Postcondition:** Prompt with Drive content appears in terminal
**Error path:** If token is expired, system refreshes silently and retries. If document is inaccessible (deleted, permissions revoked), toast shows "Cannot access document – it may have been deleted or unshared."

## UC-004: Refresh metadata for a Drive link

**Actor:** User
**Precondition:** A `.gdrive` file exists
**Trigger:** User right-clicks a `.gdrive` file → "Refresh metadata"

**Flow:**
1. System reads `drive_id` from frontmatter
2. System calls `DriveApiService.fetchMetadata(drive_id)`
3. System updates frontmatter fields: `last_modified`, `modified_by`, `size_bytes`, `name`
4. File watcher detects the change, project tree re-renders with updated freshness indicator
5. Toast confirms: "Metadata refreshed for Q1 Sales Report"

**Postcondition:** `.gdrive` frontmatter reflects current Drive state
**Error path:** If file no longer exists on Drive, toast warns: "Document not found on Google Drive – it may have been deleted."

## UC-005: Claude Code discovers and reads a Drive link

**Actor:** Claude Code (AI agent in terminal)
**Precondition:** A project is open with `.gdrive` files, `gws` CLI is authenticated
**Trigger:** User asks Claude Code to work with a linked document

**Flow:**
1. Claude Code runs `glob *.gdrive` to discover link files
2. Claude Code reads a `.gdrive` file to extract frontmatter (drive_id, type, name)
3. Based on `type`, Claude Code constructs the appropriate `gws` command:
   - Document: `gws docs documents get --params '{"documentId":"DRIVE_ID"}' --json`
   - Spreadsheet: `gws sheets spreadsheets values get --params '{"spreadsheetId":"DRIVE_ID","range":"Sheet1"}' --json`
   - Presentation: `gws slides presentations get --params '{"presentationId":"DRIVE_ID"}' --json`
   - Generic file: `gws drive files get --params '{"fileId":"DRIVE_ID","alt":"media"}'`
4. Claude Code processes the returned content per the user's request

**Postcondition:** Claude Code has retrieved and can reason about the Drive document content
**Note:** This flow relies on CLAUDE.md conventions – no special tooling in Erfana needed.

## UC-006: Open linked document in browser

**Actor:** User
**Precondition:** A `.gdrive` file exists
**Trigger:** User double-clicks a `.gdrive` file in the project tree

**Flow:**
1. System reads `url` from frontmatter
2. System calls `shell.openExternal(url)`
3. Default browser opens with the Google Drive document

**Postcondition:** Document is open in the browser
**Note:** No authentication check needed – the browser handles its own Google session.

## UC-007: Sign out from Google

**Actor:** User
**Precondition:** User is signed in to Google
**Trigger:** User clicks "Sign out" in Settings → Google Drive section

**Flow:**
1. System calls `DriveAuthService.signOut()`
2. Stored tokens are cleared from safeStorage
3. OAuth grant is revoked via Google API
4. Settings overlay updates to show "Not connected"
5. All Drive context menu actions now trigger re-authentication when used

**Postcondition:** No Google tokens stored, Drive features require sign-in again

## UC-008: Unlink a Drive file

**Actor:** User
**Precondition:** A `.gdrive` file exists
**Trigger:** User right-clicks a `.gdrive` file → "Unlink"

**Flow:**
1. Confirmation dialog: "Remove link to 'Q1 Sales Report'? This deletes the .gdrive file but does not affect the Google Drive document."
2. User confirms
3. System deletes the `.gdrive` file
4. Project tree refreshes

**Postcondition:** `.gdrive` file is deleted, Drive document is unaffected

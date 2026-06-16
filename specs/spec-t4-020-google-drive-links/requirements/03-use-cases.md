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
**Error path (corporate restriction):** If the OAuth flow returns `admin_policy_enforced` (403), the system shows an AlertDialog: 'Your organization has not approved this application. Contact your IT administrator or try signing in with a personal Google account.'

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
**Error path (Picker timeout):** If the Google Picker BrowserWindow fails to load within 10 seconds, a toast shows 'Google Picker failed to load. Check your internet connection.' and the window is closed.
**Error path (partial failure):** If some `.gdrive` files are created but others fail (e.g., filename sanitization collision at max attempts), a toast shows 'Linked N of M files. K files could not be created.' with details.

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
**Error path (not found):** If the Drive API returns 404, toast warns: 'Document not found on Google Drive – it may have been deleted.'
**Error path (permission revoked):** If the Drive API returns 403, toast warns: 'Access denied – the document may have been unshared or your permissions changed.'
**Error path (invalid .gdrive):** If DriveLinkService.parse() fails, toast warns: 'Cannot refresh – invalid .gdrive file format.'

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
**Error path:** If `shell.openExternal()` fails (no browser registered, invalid URL), a toast shows 'Could not open document in browser.' If the URL does not use `https:` protocol, the action is blocked with toast: 'Invalid URL protocol – only HTTPS links are supported.'
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
**Error path (offline sign-out):** If the token revocation API call fails (network error), local tokens are still cleared, settings UI updates to 'Not connected', and a toast warns: 'Signed out locally, but could not revoke access on Google. You can revoke manually at myaccount.google.com/permissions.'

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
**Error path:** If the `.gdrive` file cannot be deleted (read-only file system, file locked), a toast shows 'Could not remove link – file may be read-only or locked.'

## UC-009: Refresh all Drive links in a directory

**Actor:** User
**Precondition:** A directory contains one or more `.gdrive` files, user is signed in
**Trigger:** User right-clicks a directory in the project tree → "Refresh all Drive links"

**Flow:**
1. System identifies all `.gdrive` files directly in the directory (non-recursive)
2. Toast shows: "Refreshing metadata for N Drive links..."
3. System calls `DriveApiService.fetchMetadata()` for each file using a concurrency pool (max 5 concurrent)
4. For each successful refresh, `DriveLinkService.update()` writes updated frontmatter
5. Toast updates on completion: "Refreshed N Drive links"

**Postcondition:** All `.gdrive` files in the directory have updated cached metadata; tree re-renders with fresh indicators
**Error path (partial failure):** If some refreshes succeed and others fail, toast shows "Refreshed N of M links (K errors)" with error details for each failure.
**Error path (rate limited):** If Google API returns 429, the system pauses with exponential backoff and retries, extending the total operation time. Progress toast updates accordingly.
**Note:** Subdirectories are not included – the operation is non-recursive by design.

## UC-010: Cloned repository with existing .gdrive files

**Actor:** User
**Precondition:** User clones a repository that contains `.gdrive` files committed by another team member
**Trigger:** User opens the cloned project in Erfana

**Flow:**
1. Project tree renders, detecting `.gdrive` files by extension
2. `DriveLinkService.enrichNodes()` parses frontmatter from each `.gdrive` file
3. Tree shows Cloud icons with display names and freshness indicators (from cached `last_modified` in frontmatter)
4. User is NOT signed in – Drive actions requiring network show "Sign in with Google" prompt on first use
5. If user signs in and triggers "Refresh metadata", the system attempts to fetch metadata using the user's own `drive.file` scope

**Postcondition:** `.gdrive` files are visible with cached metadata; network actions require the user's own authentication
**Error path (scope limitation):** If the `.gdrive` file references a document the user has NOT opened via Picker, the `drive.file` scope will deny access (403). Toast shows: "Cannot access this document – you may need to open it via Google Picker first to grant access, or ask the document owner to share it with you." This is a fundamental limitation of `drive.file` scope (see 05-notes.md constraints).
**Note:** This UC highlights that `.gdrive` files are portable references but NOT portable access grants. The `drive.file` scope is per-app-per-user – it does not transfer via git.

## UC-011: Google account switch

**Actor:** User
**Precondition:** User is signed in to Google account A; project contains `.gdrive` files linked under account A
**Trigger:** User signs out and signs in with Google account B

**Flow:**
1. User clicks "Sign out" in Settings – tokens for account A are cleared
2. User clicks "Sign in with Google" – OAuth flow opens for account B
3. After sign-in, Settings shows account B email
4. Existing `.gdrive` files remain in the project tree (they are local files, unaffected by auth state)
5. User triggers "Refresh metadata" on an existing `.gdrive` file
6. If account B has access to the document (via sharing), refresh succeeds
7. If account B does NOT have access, toast shows "Access denied – this document was linked under a different account"

**Postcondition:** User is authenticated as account B; `.gdrive` files linked under account A may become inaccessible via Erfana SDK (but remain accessible if shared with account B, or via browser where Google's own session applies)
**Note:** v1 supports a single account. Multi-account is a future consideration.

# 020 – Google Drive link integration: User experience

## 1. User journey map

### 1a. First-time sign-in

1. User right-clicks a folder in the project tree and selects "Link Google Drive file"
2. System detects no stored tokens and shows an **AlertDialog** (Info icon):
   - Title: "Sign in with Google"
   - Message: "Connect your Google account to browse and link Drive files."
   - Buttons: [Cancel] [Sign in]
3. User clicks "Sign in" -- a BrowserWindow opens with Google's OAuth consent screen
4. User selects their account and approves permissions
5. BrowserWindow closes automatically on success
6. System proceeds to open Google Picker (the originally requested action)

**Cancellation:** If the user closes the BrowserWindow or clicks "Cancel" in the prompt, the action is silently cancelled -- no error toast.

### 1b. Linking files from Google Drive

1. User right-clicks a directory -- context menu shows "Link Google Drive file" with a Cloud icon
2. Google Picker opens in a BrowserWindow popup
3. User browses or searches their Drive, selects one or more files, clicks "Select"
4. Picker closes; `.gdrive` files appear in the target directory
5. Project tree refreshes -- new nodes show Cloud icons and display names from frontmatter
6. Success toast: "Linked 2 files from Google Drive"

### 1c. Interacting with a .gdrive file

- **Single-click:** Opens in Monaco editor showing raw YAML frontmatter and markdown body (for editing local notes)
- **Double-click:** Opens the linked document in the default browser via `shell.openExternal(url)`
- **Right-click:** Opens the `.gdrive` context menu (see section 3)

### 1d. Using AI prompts on Drive content

1. User right-clicks a `.gdrive` file and selects an AI action (e.g., "Summarize")
2. System fetches document content from Drive API (loading indicator in status area)
3. Rendered prompt with injected `driveContent` is pasted into the terminal panel
4. For "Ask about document" -- a PromptDialog appears first for the user's question

### 1e. Managing Google account in Settings

1. User opens Settings overlay (gear icon in activity bar)
2. Scrolls to the "Google Drive" section
3. **Connected state:** Shows account email, linked file count, and "Sign out" button
4. **Disconnected state:** Shows "Not connected" and "Sign in with Google" button
5. Clicking "Sign out" clears tokens, revokes the Google grant, and updates the section to disconnected state

---

## 2. Project tree visual design

`.gdrive` nodes use a Cloud icon (`lucide-react` Cloud, 16px) and display the `name` field from frontmatter instead of the filename. A freshness indicator appears as muted secondary text to the right of the name, before any git status badge.

```
project-root/
  > docs/
  > research/
      Cloud  Q1 Sales Report           2d ago
      Cloud  Product roadmap 2026      5h ago
      Cloud  Team OKRs                 14d ago
      FileText  meeting-notes.md        M
      FileText  summary.md
  > src/
```

### Node anatomy (left to right)

```
[indent] [Cloud icon] [display name]        [freshness] [git badge]
  24px      16px        flex-grow              shrink-0    shrink-0
```

**Design tokens applied:**

| Element | Token | Value |
|---------|-------|-------|
| Cloud icon color | `var(--color-brand-violet)` | #A0A8FF -- distinguishes from file/folder icons |
| Display name | `var(--color-text-primary)` | #cccccc -- same as regular files |
| Freshness text | `var(--color-text-secondary)` | #858585 -- muted, non-distracting |
| Freshness font | `var(--text-xs)` | 10px -- smaller than file name |
| Node hover | `var(--color-bg-hover)` | rgba(255,255,255,0.05) -- standard tree hover |
| Selected node | `var(--color-bg-selected)` | violet-muted -- same as current selection |

**Freshness indicator format:** Relative time -- "2m ago", "5h ago", "2d ago", "3w ago". Falls back to nothing if `last_modified` is absent. Uses `var(--font-mono)` for fixed-width alignment. If this creates visual inconsistency with the proportional display name, `tabular-nums` on `var(--font-sans)` maintains numeric alignment without a monospace typeface.

**Visual distinction from other node types:**

- Regular files: `File` or `FileText` icon in `var(--color-text-secondary)` -- gray
- Symlinks: `Link` icon prefix (12px) -- gray, with 0.8 opacity
- `.gdrive` files: `Cloud` icon in `var(--color-brand-violet)` -- violet, immediately recognizable

**Color-blind accessibility:** The `.gdrive` node is distinguished by BOTH icon shape (Cloud vs File/FileText) and color (violet vs gray). Shape alone is sufficient for differentiation – color is supplementary, not the sole differentiator. No additional color-blind accommodation is needed.

### Invalid .gdrive files

If a `.gdrive` file has corrupt YAML or missing required frontmatter fields, the tree node degrades gracefully:
- **Icon:** `AlertTriangle` (warning) instead of `Cloud`, using `var(--color-warning)`
- **Label:** Raw filename (e.g., `broken-link.gdrive`) instead of Drive display name
- **Tooltip:** 'Invalid .gdrive file – check frontmatter format'
- **No toast on render** – the warning is passive (icon + tooltip only), not disruptive
- **Context menu:** Only shows 'Delete' and 'Open in editor' – Drive-specific actions are disabled
- Triggering an explicit action (e.g., right-click → Refresh metadata) shows a toast: 'Cannot refresh – invalid .gdrive file format'

---

## 3. Context menu layout

The `.gdrive` context menu follows the existing `ContextMenuItem` interface with `separator` dividers between logical groups.

```
+---------------------------------------+
|  ExternalLink  Open in browser        |
|  Download      Fetch content          |
|  FileDown      Export as PDF          |
|  ───────────────────────────────────  |
|  RefreshCw     Refresh metadata       |
|  Copy          Copy Drive URL         |
|  ───────────────────────────────────  |
|  Sparkles      Summarize              |
|  BookOpen      Explain                |
|  ListChecks    Extract key points     |
|  MessageSquare Ask about document...  |
|  BrainCircuit  Analyze with context   |
|  ───────────────────────────────────  |
|  Trash2        Unlink                 |  <- danger style
+---------------------------------------+
```

### Grouping logic

| Group | Items | Purpose |
|-------|-------|---------|
| Direct operations | Open in browser, Fetch content, Export as PDF | Primary actions -- open, view, export |
| Metadata | Refresh metadata, Copy Drive URL | Housekeeping actions |
| AI prompts | Summarize, Explain, Extract key points, Ask about document, Analyze with context | Claude Code prompt injection |
| Destructive | Unlink | Dangerous -- styled with `danger: true` |

**"Fetch content" behavior:** Opens the fetched document content in a new read-only editor tab (titled "{displayName} [Drive]"). Does NOT paste into terminal – terminal paste is reserved for AI prompt actions. See 05-notes.md "Fetch content action target" constraint.

**Icons:** All from `lucide-react`, 16px, `strokeWidth={2}`. The AI section uses distinguishing icons to differentiate prompt types.

**"Ask about document..."** includes an ellipsis in the label to signal that it opens a secondary dialog (following macOS HIG convention).

**Keyboard shortcuts:** None assigned initially -- the context menu is mouse/keyboard-navigable via arrow keys and Enter (standard `role="menu"` behavior).

### Directory context menu additions

When right-clicking a directory:
- "Link Google Drive file" with Cloud icon -- appears after existing directory actions, before a separator
- "Refresh all Drive links" with RefreshCw icon -- appears only if the directory contains `.gdrive` files

---

## 4. Dialog designs

### 4a. Sign-in prompt

Uses `AlertDialog` pattern (Info icon, two buttons). Appears before the BrowserWindow opens.

```
+------------------------------------------+
|  (i) Sign in with Google                 |
|                                          |
|  Connect your Google account to browse   |
|  and link Drive files.                   |
|                                          |
|              [Cancel]  [Sign in]         |
+------------------------------------------+
```

- `Sign in` button: `dialog-btn-primary` (violet)
- `Cancel` button: `dialog-btn-secondary`
- `closeOnEscape: true`, `closeOnBackdrop: false`

### 4b. Unlink confirmation

Uses `ConfirmDialog` with `danger: true` (AlertTriangle icon, red confirm button).

```
+------------------------------------------+
|  /!\ Remove Drive link                   |
|                                          |
|  Remove link to "Q1 Sales Report"?       |
|  This deletes the .gdrive file but       |
|  does not affect the Google Drive        |
|  document.                               |
|                                          |
|              [Cancel]  [Remove]          |
+------------------------------------------+
```

- `Remove` button: `dialog-btn-danger` (red)
- `confirmLabel: "Remove"`, `cancelLabel: "Cancel"`

### 4c. "Ask about document" input

Uses `PromptDialog` (MessageSquare icon, textarea with validation).

```
+------------------------------------------+
|  [msg] Ask about document                |
|                                          |
|  Ask a question about "Q1 Sales Report"  |
|                                          |
|  Your question:                          |
|  +--------------------------------------+|
|  |                                      ||
|  |                                      ||
|  +--------------------------------------+|
|                                          |
|  (i) Cmd+Enter to submit    [Cancel] [Submit]
+------------------------------------------+
```

- `inputPlaceholder: "What would you like to know about this document?"`
- `minLength: 3`, standard `maxLength`
- Character count shown via `CharacterCount` component

### 4d. Error states

**Offline / network error** -- AlertDialog with `danger: false`:

```
+------------------------------------------+
|  (i) Cannot reach Google Drive           |
|                                          |
|  Check your internet connection and      |
|  try again. Your .gdrive files remain    |
|  accessible for local editing.           |
|                                          |
|                              [OK]        |
+------------------------------------------+
```

**Document deleted or unshared** -- toast notification (not a dialog):
- Type: error
- Message: "Cannot access document -- it may have been deleted or unshared."

**Auth expired and refresh failed** -- AlertDialog prompting re-sign-in:

```
+------------------------------------------+
|  /!\ Google sign-in expired              |
|                                          |
|  Your Google session has expired.        |
|  Sign in again to continue.             |
|                                          |
|              [Cancel]  [Sign in]         |
+------------------------------------------+
```

### Corporate OAuth restriction dialog

**Trigger:** OAuth flow returns `admin_policy_enforced` (403)
**Type:** AlertDialog (requires user acknowledgment)
**Title:** 'Sign-in blocked by your organization'
**Body:** 'Your IT administrator has not approved Erfana for Google Workspace access. You can contact your administrator to request approval, or sign in with a personal Google account.'
**Button:** [OK]
**Style:** Uses `var(--color-warning)` accent

### Dialog vs toast decision matrix

| Scenario | UI element | Rationale |
|----------|-----------|-----------|
| Auth failure (expired, revoked) | AlertDialog | Requires user action (re-sign-in) |
| Corporate OAuth block | AlertDialog | Requires user acknowledgment |
| safeStorage unavailable | AlertDialog | Blocks feature entirely |
| Document inaccessible (403/404) | Toast (error) | Informational, no action needed |
| Metadata refresh success | Toast (success) | Confirmatory |
| Partial refresh failure | Toast (warning) | Informational with details |
| Linking success | Toast (success) | Confirmatory |
| Network offline | Toast (error) | Informational |
| URL protocol invalid | Toast (error) | Blocked action feedback |

---

## 5. Settings overlay section

The "Google Drive" section appears after the existing "Transcription" section. It follows the same layout pattern: section heading, description text, and controls.

### Connected state

```
Google Drive
────────────────────────────────────────────

Account         marcin.obel@qodeca.com
Linked files    4 files in this project

                               [Sign out]
```

- Account email: `var(--color-text-primary)` (#cccccc)
- Linked files count: `var(--color-text-secondary)` (#858585)
- "Sign out" button: `dialog-btn-secondary` style (gray border, no fill)
- Section heading: `var(--text-lg)` (16px), `var(--font-semibold)` (600)
- Labels ("Account", "Linked files"): `var(--text-sm)` (11px), `var(--color-text-secondary)`

### Disconnected state

```
Google Drive
────────────────────────────────────────────

Not connected

                      [Sign in with Google]
```

- "Not connected": `var(--color-text-muted)` (#6e6e6e)
- "Sign in with Google" button: `dialog-btn-primary` style (violet)
- No linked files count shown when disconnected

---

## 6. Toast notifications

All toasts use the existing toast system. Messages use sentence case.

| Trigger | Type | Message |
|---------|------|---------|
| Files linked successfully | success | "Linked {n} file(s) from Google Drive" |
| Metadata refreshed (single) | success | "Metadata refreshed for {name}" |
| Metadata refreshed (bulk) | success | "Refreshed metadata for {n} Drive links" |
| Drive URL copied | info | "Drive URL copied to clipboard" |
| File unlinked | info | "Drive link removed" |
| Document inaccessible | error | "Cannot access document -- it may have been deleted or unshared" |
| Network error on Drive action | error | "Cannot reach Google Drive. Check your connection and try again" |
| Auth refresh failed | error | "Google sign-in expired. Please sign in again" |
| Rate limited (429) | warning | "Google Drive rate limit reached. Retrying..." |
| Content fetch for AI prompt | info | "Fetching document content..." (shown briefly during fetch) |
| `.gdrive` file invalid | error | "Invalid .gdrive file -- missing required fields" |

### Partial metadata refresh

- **Mixed result:** 'Refreshed N of M Drive links (K errors)' – type: warning
- **All failed:** 'Failed to refresh Drive links – check internet connection' – type: error

---

## 7. Interaction patterns

### Loading states

- **Content fetch (AI prompts):** The toast "Fetching document content..." appears while `DriveApiService.fetchContent` runs. On completion, the toast auto-dismisses and the prompt appears in the terminal. No blocking spinner -- the user can continue working.
- **Metadata refresh:** No loading indicator for single-file refresh (fast operation). For bulk "Refresh all Drive links", a toast shows "Refreshing metadata for {n} Drive links..." that updates on completion.
- **Google Picker loading:** The BrowserWindow shows Google's native loading state. No custom spinner needed.

### Click behavior

| Action | Behavior | Rationale |
|--------|----------|-----------|
| Single-click | Opens `.gdrive` in Monaco editor | Consistent with all other file types -- single-click opens in editor |
| Double-click | Opens linked URL in default browser | Natural "open the real thing" gesture; editing the raw file is the secondary use case |

Note: Double-click handling requires intercepting the standard "open in editor" behavior for `.gdrive` files specifically. The first single-click of a double-click sequence will briefly flash the editor open -- this matches macOS Finder behavior for alias files and is acceptable.

**Intentional divergence:** Double-click on `.gdrive` files opens the document in the browser (via `shell.openExternal`), unlike regular files where double-click opens in the editor. This is intentional – `.gdrive` files are references to external documents, and opening in browser is the primary action. The first click of a double-click sequence may briefly flash the editor open before the browser launches; this matches macOS Finder behavior for alias files. Single-click opens the `.gdrive` file in Monaco for editing local notes.

> **Design decision:** This is the only file type in Erfana where double-click does NOT open in the editor. The rationale is that `.gdrive` files are references to external documents – the "primary" action is opening the real document, not editing the reference file. For users who find this confusing, the context menu "Open in browser" provides an explicit, discoverable alternative. Keyboard users press Enter to open in editor (single-click behavior); there is no keyboard shortcut for double-click – context menu is the path (see AC-047, AC-048).

### Keyboard accessibility

- **Context menu:** Arrow keys navigate items, Enter activates, Escape closes (standard `role="menu"` behavior, already implemented)
- **Sign-in dialog:** Tab cycles between Cancel and Sign in buttons; Enter activates the focused button; Escape cancels
- **Unlink dialog:** Same keyboard pattern as existing `ConfirmDialog` -- Enter confirms, Escape cancels
- **Ask about document:** Same keyboard pattern as existing `PromptDialog` -- Cmd/Ctrl+Enter submits, Escape cancels
- **Settings section:** Sign in/Sign out button is focusable and activatable via Enter/Space; focus ring uses `var(--shadow-focus)`
- **Tree node:** `.gdrive` nodes are focusable via arrow keys (existing tree keyboard nav). Enter triggers single-click (open in editor). No dedicated shortcut for double-click behavior -- use context menu "Open in browser" instead.

### ARIA and screen reader support

- **Tree nodes:** `.gdrive` nodes use `aria-label="{displayName}, modified {freshness}, Google Drive link"` for screen reader context. Example: "Q1 Sales Report, modified 2 days ago, Google Drive link"
- **Freshness indicator:** `aria-hidden="true"` – information is conveyed via parent node's `aria-label` (see AC-049, AC-050)
- **Cloud icon:** Decorative, `aria-hidden="true"` – node type is conveyed in the `aria-label` text
- **Context menu:** Uses standard `role="menu"` / `role="menuitem"` (already implemented in existing context menu)
- **Settings section:** Form elements use `aria-label` for Sign in/Sign out buttons; linked file count is a `<span>` with `role="status"`

### Offline behavior

When offline, `.gdrive` files remain fully visible in the project tree with their cached display names and freshness indicators. Single-click still opens the file in Monaco for local note editing. Actions requiring network (Fetch content, Refresh metadata, AI prompts, Open in browser) show the network error toast. The context menu items are not disabled -- the error is shown on activation, keeping the UI simple and avoiding a network check on every right-click.

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test ids of the HTML Preview comments UI (docs/designs/comments/html-preview-comments.md
 * §12.4), spread into `TEST_IDS` in `testids.ts` – import them from there.
 * They live in their own module because `testids.ts` is held to its size by
 * the max-lines ratchet. Every key starts with `COMMENT_`, which is what the
 * section count in `testids.test.ts` filters on. Catalogued in
 * docs/testing/e2e-selectors.md.
 *
 * @example
 * ```tsx
 * import { TEST_IDS } from '../../../../constants/testids'
 *
 * <div data-testid={TEST_IDS.COMMENT_WINDOW}>…</div>
 * ```
 */
export const COMMENT_TEST_IDS = {
  // =========================================================================
  // HTML Preview Comments (76)
  // =========================================================================
  // docs/designs/comments/html-preview-comments.md §12.4. Every key starts with
  // COMMENT_ so the section count test can find them.

  // Toolbar
  /** Comment mode toggle in the preview toolbar */
  COMMENT_TOOL_MODE: 'preview-band-comment-mode',
  /** Comments list button (opens the drawer) in the preview toolbar */
  COMMENT_TOOL_LIST: 'preview-band-comments',
  /** Show comment icons toggle in the preview toolbar */
  COMMENT_TOOL_ICONS: 'preview-band-comment-icons',

  // Element menu and live regions
  /** The element menu (right-click in comment mode) */
  COMMENT_CONTEXT_MENU: 'comment-context-menu',
  /** Element menu: Add comment */
  COMMENT_MENU_ADD: 'comment-menu-add',
  /** The tab's polite live region */
  COMMENT_ANNOUNCE: 'comment-announce',
  /** The tab's assertive live region */
  COMMENT_ALERT: 'comment-alert',

  // Comment window
  /** The comment window (data-view: identity / new / threads) */
  COMMENT_WINDOW: 'comment-window',
  /** The docked window's hidden probe: the box its `position: fixed` resolves against (C-18) */
  COMMENT_WINDOW_FRAME: 'comment-window-frame',
  /** Window title (takes focus in the threads view) */
  COMMENT_WINDOW_TITLE: 'comment-window-title',
  /** Close (x) in the window head */
  COMMENT_WINDOW_CLOSE: 'comment-window-close',
  /** The window's own assertive live region */
  COMMENT_WINDOW_ALERT: 'comment-window-alert',
  /** Couldn't read comments – the list failed */
  COMMENT_WINDOW_READ_ERROR: 'comment-window-read-error',
  /** Try again after a failed list read */
  COMMENT_WINDOW_RETRY: 'comment-window-retry',
  /** Close in the window foot */
  COMMENT_CLOSE: 'comment-close',
  /** Banner for a refused (or still pending) write */
  COMMENT_SAVE_ERROR: 'comment-save-error',

  // Identity
  /** Identity step: name field */
  COMMENT_IDENTITY_NAME: 'comment-identity-name',
  /** Identity step: email field */
  COMMENT_IDENTITY_EMAIL: 'comment-identity-email',
  /** Identity step: Continue */
  COMMENT_IDENTITY_CONTINUE: 'comment-identity-continue',
  /** Identity step: Cancel */
  COMMENT_IDENTITY_CANCEL: 'comment-identity-cancel',
  /** Identity step: always-mounted save-error line */
  COMMENT_IDENTITY_ERROR: 'comment-identity-error',
  /** "Commenting as …" line under the comment field */
  COMMENT_IDENTITY_LINE: 'comment-identity-line',
  /** Change, next to "Commenting as …" */
  COMMENT_IDENTITY_CHANGE: 'comment-identity-change',
  /** Inline identity editor: name field */
  COMMENT_IDENTITY_EDIT_NAME: 'comment-identity-edit-name',
  /** Inline identity editor: email field */
  COMMENT_IDENTITY_EDIT_EMAIL: 'comment-identity-edit-email',

  // New comment
  /** New comment text field */
  COMMENT_NEW_FIELD: 'comment-new-field',
  /** Save the new comment */
  COMMENT_SAVE: 'comment-save',
  /** Cancel the new comment (text kept) */
  COMMENT_CANCEL: 'comment-cancel',
  /** Unsaved-source banner (Save blocked) */
  COMMENT_UNSAVED_BANNER: 'comment-unsaved-banner',
  /** Unsaved-source banner: Save {file} */
  COMMENT_UNSAVED_SAVE: 'comment-unsaved-save',
  /** Unsaved-source banner: Go to tab */
  COMMENT_UNSAVED_GO_TO_TAB: 'comment-unsaved-go-to-tab',
  /** The banner after the source tab became clean */
  COMMENT_UNSAVED_CLEARED: 'comment-unsaved-cleared',

  // Threads
  /** An open thread */
  COMMENT_THREAD: 'comment-thread',
  /** A resolved thread, folded */
  COMMENT_RESOLVED_THREAD: 'comment-resolved-thread',
  /** One message */
  COMMENT_MESSAGE: 'comment-message',
  /** A message's text */
  COMMENT_MESSAGE_TEXT: 'comment-message-text',
  /** A message's … (actions) button */
  COMMENT_MESSAGE_ACTIONS: 'comment-message-actions',
  /** Edit field of a message */
  COMMENT_EDIT_FIELD: 'comment-edit-field',
  /** Save changes to a message */
  COMMENT_EDIT_SAVE: 'comment-edit-save',
  /** Cancel an edit */
  COMMENT_EDIT_CANCEL: 'comment-edit-cancel',
  /** Confirm deleting a comment or thread */
  COMMENT_DELETE_CONFIRM: 'comment-delete-confirm',
  /** Cancel a delete */
  COMMENT_DELETE_CANCEL: 'comment-delete-cancel',
  /** Reply field */
  COMMENT_REPLY_FIELD: 'comment-reply-field',
  /** Reply button */
  COMMENT_REPLY: 'comment-reply',
  /** Resolve a thread */
  COMMENT_RESOLVE: 'comment-resolve',
  /** Re-open a resolved thread */
  COMMENT_REOPEN: 'comment-reopen',
  /** New comment on the pin's element */
  COMMENT_NEW_ON_ELEMENT: 'comment-new-on-element',
  /** Open in source (window foot) */
  COMMENT_OPEN_IN_SOURCE: 'comment-open-in-source',
  /** Read-only file banner */
  COMMENT_READ_ONLY: 'comment-read-only',
  /** Not-visible-now banner */
  COMMENT_NOT_VISIBLE: 'comment-not-visible',
  /** Element-not-found banner */
  COMMENT_NOT_FOUND: 'comment-not-found',
  /** The lost element's stored quote */
  COMMENT_NOT_FOUND_QUOTE: 'comment-not-found-quote',
  /** A damaged block */
  COMMENT_DAMAGED: 'comment-damaged',
  /** A damaged block's raw text */
  COMMENT_DAMAGED_RAW: 'comment-damaged-raw',
  /** Delete block… */
  COMMENT_DELETE_BLOCK: 'comment-delete-block',
  /** Confirm deleting a damaged block */
  COMMENT_DELETE_BLOCK_CONFIRM: 'comment-delete-block-confirm',
  /** A newer-format block */
  COMMENT_NEWER: 'comment-newer',
  /** A visible token for an invisible control character */
  COMMENT_CONTROL_TOKEN: 'comment-control-token',

  // Drawer
  /** The comments drawer */
  COMMENT_DRAWER: 'comment-drawer',
  /** Close the drawer */
  COMMENT_DRAWER_CLOSE: 'comment-drawer-close',
  /** Filter: Open */
  COMMENT_FILTER_OPEN: 'comment-filter-open',
  /** Filter: Resolved */
  COMMENT_FILTER_RESOLVED: 'comment-filter-resolved',
  /** Filter: Needs attention */
  COMMENT_FILTER_ATTENTION: 'comment-filter-attention',
  /** Show comment icons checkbox */
  COMMENT_DRAWER_SHOW_ICONS: 'comment-drawer-show-icons',
  /** The row list */
  COMMENT_DRAWER_LIST: 'comment-drawer-list',
  /** A row */
  COMMENT_DRAWER_ROW: 'comment-drawer-row',
  /** A row's main action (Show in preview / Open in source) */
  COMMENT_DRAWER_ROW_MAIN: 'comment-drawer-row-main',
  /** A row's Open (the comment window) */
  COMMENT_DRAWER_ROW_OPEN: 'comment-drawer-row-open',
  /** A tag on a row */
  COMMENT_DRAWER_TAG: 'comment-drawer-tag',
  /** List read error with Try again */
  COMMENT_DRAWER_ERROR: 'comment-drawer-error',
  /** Note: main left files out of the list (its file count or byte budget) */
  COMMENT_DRAWER_UNREAD: 'comment-drawer-unread',

  // Settings
  /** Settings › Comments section */
  COMMENT_SETTINGS_SECTION: 'settings-section-comments',
  /** Feature flag: Comments in HTML preview */
  COMMENT_SETTINGS_TOGGLE: 'settings-toggle-html-comments',
  /** Your name */
  COMMENT_SETTINGS_NAME: 'settings-comment-name',
  /** Your email */
  COMMENT_SETTINGS_EMAIL: 'settings-comment-email',
  /** Visibility notice */
  COMMENT_SETTINGS_NOTICE: 'settings-comment-notice',
  /** Assertive region for blur-save errors */
  COMMENT_SETTINGS_ALERT: 'settings-comment-alert',
  /** Feature flag: Comments in Markdown preview (spec 024, 024-FR-022) */
  COMMENT_SETTINGS_MD_TOGGLE: 'settings-toggle-md-comments',

  // Renderer-hosted previews (spec 024 commit 13: the Markdown Preview)
  /** A menu item's reason line (Menu card #reason) */
  COMMENT_MENU_REASON: 'context-menu-reason',
  /** Menu item outside comment mode: Comment on {kind} (menu matrix M-11) */
  COMMENT_MENU_COMMENT_ON: 'comment-menu-comment-on',
  /** Menu item on the frontmatter, always disabled (M-18) */
  COMMENT_MENU_FRONTMATTER: 'comment-menu-frontmatter',
  /** The overlay over a renderer-hosted preview (outside the exported content) */
  COMMENT_HOST_OVERLAY: 'comment-host-overlay',
  /** The outline around the outlined or picked target */
  COMMENT_HOST_OUTLINE: 'comment-host-outline',
  /** A comment icon (a real button, outside the Tab order – D-07) */
  COMMENT_HOST_ICON: 'comment-host-icon',
  /** A not-found comment's ghost, at its place between two blocks (a real button – C-05, R-16) */
  COMMENT_HOST_GHOST: 'comment-host-ghost',
  /** The comment-mode tab (A-03) */
  COMMENT_HOST_MODE_TAB: 'comment-host-mode-tab',
  /** The paused band over the Markdown Preview (F-02, F-03) */
  COMMENT_HOST_PAUSED: 'comment-host-paused',
  /** Paused band: Save {file} */
  COMMENT_HOST_PAUSED_SAVE: 'comment-host-paused-save',
  /** Paused band, changed on disk: Go to editor */
  COMMENT_HOST_PAUSED_GO_TO_EDITOR: 'comment-host-paused-go-to-editor',
  // Selection comments (spec 024 commit 14, 024-FR-004)
  /** Menu item with a selection: Comment on selection (M-12, M-14, M-16, M-19, M-21) */
  COMMENT_MENU_SELECTION: 'comment-menu-selection',
  /** Menu item with a selection: Comment on the whole {kind} */
  COMMENT_MENU_WHOLE: 'comment-menu-whole',
  /** The floating Comment button over a selection (C-16) */
  COMMENT_SELECTION_BUTTON: 'comment-selection-button',
  /** New-comment window: the words quote (C-21) */
  COMMENT_WORDS: 'comment-words',
  /** New-comment window: a notice about the words (cut, crossed, tie, blank) */
  COMMENT_WORDS_NOTICE: 'comment-words-notice',
  /** New-comment window: Comment on the whole {kind} after a tie */
  COMMENT_WORDS_WHOLE: 'comment-words-whole',
  /** New-comment window: the Narrow to words disclosure (C-07) */
  COMMENT_NARROW_TOGGLE: 'comment-narrow-toggle',
  /** New-comment window: the read-only text field to select words in */
  COMMENT_NARROW_FIELD: 'comment-narrow-field',
  /** New-comment window: the result line, Comment on: “…” */
  COMMENT_NARROW_RESULT: 'comment-narrow-result',
  /** New-comment window: Whole {kind}, which clears the words */
  COMMENT_NARROW_WHOLE: 'comment-narrow-whole',
  // The drawer and the toolbar after comments-v2 (spec 024 commit 14: C-15, OD-04, OD-06)
  /** Filter: Can't edit (OD-04; replaces Needs attention) */
  COMMENT_FILTER_CANT_EDIT: 'comment-filter-cant-edit',
  /** The drawer's sort menu button (C-15); its items add `-file`, `-changed`, `-latest`, its menu `-menu` */
  COMMENT_DRAWER_SORT: 'comment-drawer-sort',
  /** Drawer note: open comments removed outside Erfana (OD-06) */
  COMMENT_DRAWER_REMOVED: 'comment-drawer-removed',
  /** The note's Show / Hide */
  COMMENT_DRAWER_REMOVED_SHOW: 'comment-drawer-removed-show',
  /** The note's Dismiss */
  COMMENT_DRAWER_REMOVED_DISMISS: 'comment-drawer-removed-dismiss',
  /** A removed comment's Copy text */
  COMMENT_DRAWER_REMOVED_COPY: 'comment-drawer-removed-copy',
  // The comment window after comments-v2 (spec 024 commit 14: C-05, C-06, C-13, C-14, C-18, C-19, OD-05)
  /** C-06: the Changed / Words changed note above a thread */
  COMMENT_CHANGED: 'comment-changed',
  /** C-06: the Was box */
  COMMENT_WAS: 'comment-was',
  /** C-06: the Now box */
  COMMENT_NOW: 'comment-now',
  /** C-05: "The comment itself is on line {n} of {file}." */
  COMMENT_COMMENT_LINE: 'comment-comment-line',
  /** C-13: Reply and resolve */
  COMMENT_REPLY_RESOLVE: 'comment-reply-resolve',
  /** C-13: Resolve and next, in the foot */
  COMMENT_RESOLVE_NEXT: 'comment-resolve-next',
  /** C-13: the stepper group in the head */
  COMMENT_STEPPER: 'comment-stepper',
  /** C-13: Previous comment */
  COMMENT_STEP_PREVIOUS: 'comment-step-previous',
  /** C-13: Next comment */
  COMMENT_STEP_NEXT: 'comment-step-next',
  /** C-13: the head's More actions (…) button */
  COMMENT_MORE_ACTIONS: 'comment-more-actions',
  /** W-11: All open comments are resolved */
  COMMENT_ALL_DONE: 'comment-all-done',
  /** W-02: Your text from the last comment is here. */
  COMMENT_CARRIED: 'comment-carried',
  /** W-01: Pick again, in the foot */
  COMMENT_PICK_AGAIN: 'comment-pick-again',
  /** W-03: Updated from {file} just now */
  COMMENT_UPDATED: 'comment-updated',
  /** W-03: the New since you opened divider */
  COMMENT_NEW_SINCE: 'comment-new-since',
  /** W-04: removed outside Erfana while open */
  COMMENT_REMOVED: 'comment-removed',
  /** W-04: Copy text */
  COMMENT_COPY_TEXT: 'comment-copy-text',
  /** W-07: Comment on the whole {parent} */
  COMMENT_RETARGET: 'comment-retarget',
  /** 024-FR-004: saved on the whole target – the words were not kept */
  COMMENT_WORDS_DROPPED: 'comment-words-dropped',
  /** C-18: the docked window's edge tab */
  COMMENT_EDGE_TAB: 'comment-edge-tab',
  /** The window's polite live region (a step's announcement) */
  COMMENT_WINDOW_POLITE: 'comment-window-polite',
  /** OD-05: Rebuild from data… */
  COMMENT_REBUILD: 'comment-rebuild',
  /** OD-05: the rebuild confirmation */
  COMMENT_REBUILD_CONFIRM: 'comment-rebuild-confirm',
  /** OD-05: Rebuild comment */
  COMMENT_REBUILD_RUN: 'comment-rebuild-run',
  /** OD-05: Keep open (only the status line differs) */
  COMMENT_REBUILD_KEEP_OPEN: 'comment-rebuild-keep-open',
  /** OD-05: Mark resolved (only the status line differs) */
  COMMENT_REBUILD_MARK_RESOLVED: 'comment-rebuild-mark-resolved',
  /** 024-AC-004 (g): the selected words are not in the file – the window says the comment is on the whole target */
  COMMENT_WORDS_MISSING: 'comment-words-missing',
  /** C-19.5: the text field's polite region – the counter's crossings */
  COMMENT_COUNTER_LIVE: 'comment-counter-live',
  /** C-13: the Markdown Preview's polite region – where a step key from the preview landed */
  COMMENT_STEP_LIVE: 'comment-step-live'
} as const

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Constants of the preview page's comment overlay
 * (docs/designs/html-preview-comments.md §5.8, §8).
 *
 * INLINED, not imported: a preload entry must stay self-contained (#73, the
 * guard in `electron.vite.config.ts`), so the channel names and limits main
 * uses are repeated here. `contract.test.ts` (this folder) pins every
 * copy to its main-side source, so a drift fails a unit test instead of
 * silently breaking comments.
 */

/**
 * The renderer argument main adds (`additionalArguments`) when a view is built
 * with `htmlPreview.comments.enabled`: without it the overlay is not installed
 * at all (`PREVIEW_COMMENTS_ARGUMENT` in `previewSessionPolicy.ts`).
 */
export const COMMENTS_ARGUMENT = '--erfana-hpc'

/** Main → frame: the comment state. The preload's ONE receive channel (§8). */
export const COMMENT_STATE_CHANNEL = 'preview-page:commentState'
/** Page → main: "this document is ready", sent at `DOMContentLoaded`. */
export const COMMENT_HELLO_CHANNEL = 'preview-page:commentHello'
/** Page → main: a pick (menu, open, pin click, keyboard parent step, exit). */
export const COMMENT_PICK_CHANNEL = 'preview-page:commentPick'
/** Page → main: which pins' elements are rendered now, and overlay loss. */
export const COMMENT_ANCHORS_CHANNEL = 'preview-page:commentAnchors'

/** The attribute the served copy marks every eligible element with (`instrument.ts`). */
export const TOKEN_ATTRIBUTE = 'data-erfana-el'
/** A served element token: 12 lower-case base32 characters (`instrument.ts`). */
export const TOKEN_PATTERN = /^[a-z2-7]{12}$/
/** Tokens one document may register (`PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT`). */
export const MAX_TOKENS_PER_DOCUMENT = 100_000

/** Picks one frame admits per second (`PREVIEW_LIMITS.COMMENT_PICKS_PER_SECOND`). */
export const PICKS_PER_SECOND = 5
/**
 * `exit` (Esc) and `parent` (Alt+↑ out of a frame) picks one frame admits per
 * second, each kind on its own budget – so a burst of clicks never drops Esc.
 */
export const CONTROL_PICKS_PER_SECOND = 3
/** UTF-8 bytes of a JS-built element's snapshot (`PREVIEW_LIMITS.COMMENT_SNAPSHOT_MAX_BYTES`). */
export const SNAPSHOT_MAX_BYTES = 256 * 1024
/** Characters of a runtime path (`PREVIEW_LIMITS.COMMENT_RUNTIME_PATH_MAX_CHARS`). */
export const RUNTIME_PATH_MAX_CHARS = 1_024
/** Characters of a quote's exact part (`PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS`). */
export const QUOTE_MAX_CHARS = 200
/** Characters of a quote's prefix and suffix (`QUOTE_CONTEXT_CHARS` in `anchor.ts`). */
export const QUOTE_CONTEXT_CHARS = 32
/** Characters of the `#hash` sent with a pick (`PREVIEW_LIMITS.COMMENT_VIEW_HASH_MAX_CHARS`). */
export const VIEW_HASH_MAX_CHARS = 512
/** Characters of a tag name (`TAG_MAX_CHARS` in `format.ts` is larger; §8 caps the pick at 32). */
export const PICK_TAG_MAX_CHARS = 32
/** Characters of the tokened element's own tag name in a pick (`TAG_MAX_CHARS` in `format.ts`). */
export const TAG_MAX_CHARS = 128
/** A tag name main accepts in a pick (`preview-comment-schema.ts`); any other is left out. */
export const PICK_TAG_PATTERN = /^[A-Za-z][\w.:-]*$/
/** Largest CSS-pixel coordinate a pick's box carries (`preview-comment-schema.ts`). */
export const PICK_BOX_MAX_PX = 10_000_000
/** Keys in each list of one anchors report (§8). */
export const ANCHOR_KEYS_MAX = 500
/** Characters of a pin key (§8). */
export const PIN_KEY_MAX_CHARS = 40
/** Pins one state may carry (one per key; §8 caps the anchors lists at 500). */
export const MAX_ICONS = ANCHOR_KEYS_MAX

/** Overlay repairs (re-attach, re-show, restyle) one page may force per second (§9.1 S25). */
export const OVERLAY_REPAIRS_PER_SECOND = 3
/** Fastest visibility re-check after a DOM or size change (§6 status). */
export const ANCHOR_CHECK_MIN_MS = 250
/** A render that `requestAnimationFrame` has not run by then runs on a timer (hidden views). */
export const RENDER_FALLBACK_MS = 250
/** Longest frame-scroll restore loop (§7.5 step 6). */
export const RESTORE_BUDGET_MS = 1_000
/** How long a revealed element stays highlighted (§10.8 reduced motion: static, 1.5 s). */
export const REVEAL_FLASH_MS = 1_500
/** Fastest repeat of a `commentHello` asking main for the frame list again (§19 R3-4). */
export const HELLO_REPEAT_MIN_MS = 1_000
/** Repeated hellos one document may send. */
export const HELLO_REPEAT_MAX = 20

/** An Erfana comment block's header (`BLOCK_HEADER` in `anchor.ts`). */
export const BLOCK_HEADER = /^\s*erfana:comment\s+v\d+\b/

/** The speech-bubble pin's outline, exactly (decision 33, §10.5, J-014). */
export const PIN_PATH = 'M2 2H22V17H7L2 22Z'
/**
 * Where the count and the `!` are centred in the bubble: halfway down its body,
 * which runs from y 2 to y 17 in {@link PIN_PATH} (the tail hangs below it).
 */
export const PIN_BODY_MIDDLE_Y = 9.5
/** The pin's box: a 24 × 24 hit target (WCAG 2.5.8) whose tail tip is at (2, 22). */
export const PIN_BOX_PX = 24
/** Where the tail tip sits inside the pin's box. */
export const PIN_TIP = { x: 2, y: 22 } as const
/** The tail tip's offset outward from the element's top-right corner (§10.5). */
export const PIN_TIP_OFFSET_PX = 4
/** How far an overlapping pin moves left along the top edge (§10.5). */
export const PIN_STEP_PX = 22
/** Steps an overlapping pin may take before it stays put, overlapping (bounds the search). */
export const PIN_MAX_STEPS = 8
/** An element smaller than this gets its ring pushed out (§10.2 "Tiny"). */
export const TINY_ELEMENT_PX = 8
/** How far a tiny element's ring is pushed out. */
export const TINY_RING_OUTSET_PX = 2
/** Pointer distance from the top edge that moves the mode tab to the bottom (§10.1). */
export const MODE_TAB_AVOID_PX = 48
/** Longest overlay label (§10.2). */
export const LABEL_MAX_CHARS = 40
/** Classes a label shows before `…` (§10.2). */
export const LABEL_MAX_CLASSES = 2

# Design – HTML Preview comments (v1)

> Status: shipped in v0.23.1 (2026-10-28; v0.23.0 carried it but was tagged and never published). Planned 2026-10-25 as the implementation plan for comments on elements in the HTML Preview.
> **Superseded in part (2026-10-28):** [comments-v2.md](comments-v2.md) holds the enhanced design from a six-specialist UX/UI review and the owner's decisions OD-01…OD-08. Where the two disagree, comments-v2.md wins.
> Branch: `feature/html-preview-comments` (off `develop`). No GitHub issue yet.
> Inputs: owner interview (grill-me, depth full, 35 locked decisions), an online survey of 20+ commenting tools, and four specialist designs (architecture, UX, security, test strategy). Conflicts between those designs are resolved in §3.
> Revision 2 (2026-10-25): folds in three plan reviews – correctness against the code, coverage of the decisions, and risk/sequencing. Their blockers are fixed in place; §18 lists what changed.
> Revision 3 (2026-10-26): folds in the P0 spike results ([docs/spikes/html-preview-comments.md](../../spikes/html-preview-comments.md)). **§19 is authoritative where it conflicts with earlier sections.**

## 1. Summary

A reviewer turns on **comment mode** in an HTML Preview tab, hovers elements (DevTools-style outline + tag label), right-clicks one and picks **Add comment**, types into an Erfana-drawn comment window and saves. Erfana writes an `<!-- erfana:comment v1 … -->` block into the HTML file immediately before the element's start tag, reloads the page, restores scroll and `#hash`, and shows a **speech-bubble** pin at the element's top-right corner. Clicking the pin reopens the thread to read, reply, edit, resolve or delete. A side drawer lists every comment (open, resolved, needs attention). Coding agents read the comments straight from the file; humans share them through git.

No surveyed tool stores comments inside the source file – Figma, Claude Design, Vercel, BugHerd, Hypothesis and Webflow use a server, and Agentation / reviewable-html-workbench use local or sidecar storage. Erfana's inline format is new, so the format is treated as a one-way door: a public spec, a `v1` tag, golden tests and an agent-readability check before it is locked.

The one deep change: same-project iframes (decision 15) require the preview preload to run in sub-frames and to receive exactly one message type from main. This is the first page-to-file feature, so it is owned deliberately in `docs/security.md` and in the preload contract test.

## 2. Locked decisions

| # | Decision |
|---|---|
| 1 | Comments serve both coding agents and humans (collaboration, review). |
| 2 | Shared through git. Comments carry author, time, replies (threads), resolve/re-open. |
| 3 | Author name (required) + email (optional) come from an app-level Erfana setting. If unset, a one-time prompt explains both are written into the file, stay in git history if pushed, and are visible in page source. |
| 4 | Erfana's own chrome draws the context menu and comment window; the page freezes to a still image while they are open. Hover outline and pins are drawn inside the page (isolated world). |
| 5 | Static and JS-built HTML both supported. JS-built elements anchor to the nearest in-file ancestor. After save, scroll and `#hash` are restored. |
| 6 | Storage is inline in the HTML file, immediately before the target's start tag. |
| 7 | No "remove all comments" guard in v1; the first-run prompt warns that comments are visible in page source. |
| 8 | Comment list (drawer): open / resolved / needs attention (orphaned + damaged), "not visible now" tag; click scrolls to the element. Resolved threads hide their pin. |
| 9 | No "Send to agent" button; agents read the file only. |
| 10 | Agents do not reply or change status in v1; `role` field reserved for later. |
| 11 | Format: readable text + one `@data {json}` line; sequences that would end the HTML comment are escaped. |
| 12 | A block Erfana cannot read is "damaged": read-only, never overwritten; the user can delete it or fix it in source. |
| 13 | If the same file is open via "Open as source" with unsaved changes, commenting is blocked until it is saved. |
| 14 | Out of v1: Markdown Preview comments; area / text-selection comments; live sync; agent replies/status; "Send to agent"; menu items other than "Add comment". *Follow-ups (proposed, 2026-10-28): Markdown Preview comments – [markdown-preview-comments.md](markdown-preview-comments.md); text-selection comments in both previews – [selection-comments.md](selection-comments.md).* |
| 15 | Same-project iframes are in v1; the comment is written into the frame's own file. Remote and `srcdoc` frames are not commentable inside. |
| 16–17 | Full `outerHTML` snapshot only for JS-built elements; in-file elements get no copy. Snapshot = state at comment time, never updated, nested erfana blocks stripped. |
| 18 | Priorities: 1) easy flow, 2) file safety, 3) polish. Decisions 12 and 13 stay safety-first. |
| 19 | Hover outlines; right-click opens the menu at once; left-click opens the comment window; Alt+↑/↓ parent/child; Esc leaves the mode. Clicks do not reach the page in comment mode. |
| 20 | Pins always visible (also outside comment mode), with a toolbar toggle to hide them. Several threads on one element = one numbered pin. Clicking a pin opens the window in any mode. |
| 21 | If an agent removes comment blocks, Erfana does nothing special (git keeps history). |
| 22 | Public format spec; every block tagged `v1`; future versions must read v1; Erfana never rewrites a block it did not change. |
| 23 | Done = owner judgement on own files, plus #24. |
| 24 | Automatic tests prove add/edit/delete changes only that comment block – every other byte identical, line endings, BOM and encoding preserved. |
| 25 | Ships in one release. |
| 26 | All reviewers use Erfana; only Erfana writes comments. |
| 27 | Before release, commented files are tested with Claude Code and Codex given only "apply the review comments"; the format is adjusted before the v1 lock if misread. |
| 28 | Save → pin visible in under 1 s; scroll + `#hash` restored; tested on a JS slide deck. |
| 29 | Scope stays flexible during the work. |
| 30 | A target that is not rendered right now (hidden slide/tab) shows as "not visible now", not orphaned; its pin appears when it appears. |
| 31 | Anyone may edit or delete any comment or reply. |
| 32 | Erfana does not resolve git merge conflicts; blocks containing conflict markers are damaged. |
| 33 | The pin is a speech bubble. |
| 34 | JS-built snapshots are capped at 256 KB; larger ones are cut and flagged `truncated`. |
| 35 | Commenting follows the preview's own serving rules: any page the preview shows is commentable, gitignored pages shown inside frames included. Never-served paths (`node_modules`, `dist`, `out`, `coverage`, `.git`, dot-folders) are not. Read-only with a visible reason: non-UTF-8 files, symlinks/hard links, `srcdoc` frames, a file with an unresolved conflict hunk, files over 25 MB or 640,000 elements (§19 Rev 4; was 4 MB). Drawer filters Open / Resolved / Needs attention. |

## 3. Resolved conflicts and technical calls

| Topic | Inputs | Resolution |
|---|---|---|
| Hand-edited readable text disagrees with `@data` | Tests: `@data` wins. Architecture: damaged. | **Damaged (`readable-mismatch`)**, per decision 12. Re-checked during the decision-27 agent test (§15 U2). |
| HTML file that is itself a symlink | Tests: write through. Security: refuse. | **Refuse** (`COMMENT_WRITE_REFUSED_LINK`); also refuse hard links (`nlink > 1`). |
| Message length | Security 8 KB; UX 4,000 chars | **4,000 characters** per message (UI counter from 3,600). Byte limits are measured **after** serialisation and escaping (§5.8). |
| Snapshot size | Security 16 KB; owner "full" | **256 KB of raw `outerHTML`** (decision 34). Block cap **2 MB serialised**; a write that would exceed it is refused before writing (`COMMENT_LIMIT`), so Erfana never writes a block it would read back as damaged. |
| Non-UTF-8 files | – | UTF-16 and legacy encodings → read-only (`COMMENT_ENCODING_UNSUPPORTED`). UTF-8 ± BOM only, with a byte-identical decode → encode round trip. |
| Placement and whitespace | Architecture: same line; risk review: `git diff` then always touches the target line | **Hybrid** (§5.2): when the target's start tag is the first non-whitespace on its line, the block takes its own lines – `-->` + the line's EOL + the line's indent – so the target line itself is unchanged in `git diff` and concurrent edits to it do not conflict with the block. When the target is mid-line (inline flow), no whitespace is added. The inserted text (block + its trailing EOL/indent) is the "block" for decision 24; delete removes exactly it. Spike S7 checks rendering (`white-space: pre*` set by CSS on a non-`pre` element is the residual risk; E-019 covers it). |
| Conflict markers outside any block | Coverage review: a lone `=======` is common | The whole file is read-only only when a **complete hunk** exists (`<<<<<<< ` … `=======` … `>>>>>>> ` at line starts, in order). A lone marker-like line is ignored. |
| `srcdoc` frames | – | Not commentable inside (source lives in an attribute). |
| Remote frames | Correctness review: `frame-src` names only the page's own token (`docs/security.md:762`), so they never load | The `<iframe>` element itself is commentable in the parent file; its label reads `iframe · refused frame`. |
| Gitignored pages | Owner (decision 35) | Commentable wherever the preview shows them (frames). A gitignored page opened in a tab still opens as source, as today (`PreviewEligibilityService.ts:102-106`). |
| Keyboard picker keys | Correctness review: `previewInputForward.ts:162-167` `preventDefault`s every forwarded key, so forwarded keys never reach the preload | Main forwards **only the toggle shortcut** (Ctrl+Alt+M / Cmd+Option+M). The preload handles Tab, Shift+Tab, Alt+↑/↓, Enter, Shift+F10, ContextMenu and Esc itself, in a capture-phase `keydown` listener, `isTrusted` only, while comment mode is on. |
| Raw vs instrumented bytes | Correctness + risk reviews: the request-kind ledger is diagnostic-only (`PreviewRequestKindLedger.ts:21-23`) | Instrument only when the ledger note is exactly a document/sub-frame load; otherwise serve raw. **Security never depends on the ledger** (§6): a token is accepted only once, only from parser-inserted nodes before `DOMContentLoaded`, and an instrumented load is bound to exactly one frame at its first `commentHello`. A missed note shows "Comments unavailable for this page" with a logged reason. The ledger's header contract is changed on purpose and documented. |
| Feature flag | Risk review | New global setting `htmlPreview.comments.enabled` (default on). Off = today's exact session policy (`nodeIntegrationInSubFrames: false`), no instrumentation, no comment UI. The freeze test pins both variants. Instrumentation also runs only when comment mode is on or the file contains `erfana:comment`. |
| Pins toggle scope | Coverage review: per tab vs app-wide | **Per tab, not persisted**, default on. `showIcons` is not stored in settings. |
| Privacy notice | Coverage review: could be skipped by setting the name first | Shown once to everyone (`identityNoticeSeen`), even when the name is already set; the same warning appears in the Settings section. |
| Agent-readability timing | Risk review: the format is a one-way door but X-001 ran last | **X-001 runs at the P1 exit** on hand-made `agent-review/` files produced by the P1 serializer, and again at P8 as confirmation. U1 (frameworks vs comment nodes) becomes spike S7 in P0. |
| Editing existing comments | Correctness review: no session binding for edits | `fileKey` and `threadKey` in `commentList` results are **main-minted, opaque, bound** to window `webContents.id`, panel and project session, like draft tokens. |
| `fast-check` | – | Add as a **devDependency** (MIT, pure JS); check that the `License compliance` job accepts it. |
| Stale still image under popups | UX finding | In comment mode: paint the selected outline → wait one animation frame → `capturePage` → mount the popup. Spike S6. |
| Pin glyph | UX finding | Custom square-cornered bubble SVG for the pin (the registry's `message-circle` stays for chat). Toolbar uses lucide `message-square-plus`, `messages-square`, `message-square` / `message-square-off`. |

## 4. Architecture

### 4.1 Process boundaries

```
 [Untrusted page JS – main world]  (opaque origin; top frame + same-token iframes)
        |  shared DOM
 [Preload isolated world – every frame]  overlay in a closed shadow root; token WeakMap
        |  B1  ipcRenderer.send  preview-page:comment{Hello,Pick,Anchors}   (webContents.ipc, senderFrame)
        |  B1' WebFrameMain.send preview-page:commentState                    (the ONE receive channel)
 [Main – PreviewCommentService]  frameFileMap, ElementTokenTable, drafts
        |  B2  preview:commentDraftOpened → trusted renderer
 [Renderer – React chrome]  menu, comment window, drawer, identity prompt  ← user types, presses Save
        |  B3  preview:commentSave (registerHandle + isTrustedPreviewSender + single-use draft token)
 [Main – CommentWriter]  re-read → parse5 → splice → verify → byte write
        |  B4  filesystem (realpath-confined, no links)
 [HTML files]  ← also written by agents and collaborators (git)
        |  B5  parsed blocks → React (text only) and counts → overlay (no text, no emails)
```

Rules that follow from the diagram:
- **Nothing on B1 writes.** A page signal can only open a draft. A write needs Save in Erfana's own React window (B3).
- **No comment text or email crosses B1'.** The overlay gets `{key, token, count, status}` only.
- **The file is always re-read at Save.** Erfana never writes a copy it read earlier.

### 4.2 Module map

**Shared – `src/shared/htmlComments/`** (pure; no Electron, no `fs`; parse5 allowed). Not imported by the preload (preloads must be self-contained, `electron.vite.config.ts:22-45`).

| File | Responsibility |
|---|---|
| `format.ts` | v1 types, zod `CommentDataSchema`, limits, `serializeBlock(data, {indent, eol})`, `renderReadable(data)`, escaping |
| `parse.ts` | `parseCommentBlocks(text)` – walks parse5 comment nodes (no whole-file regex); returns `ParsedBlock[]` + `FileCommentState` |
| `anchor.ts` | Builds backup anchors from a parse5 element; `resolveBlockTarget` (position → id → path → quote → orphaned) |
| `splice.ts` | `planInsert / planReplace / planDelete`, EOL and indent detection, `verifySplice(old, new, plan)` |
| `instrument.ts` | `instrumentHtml(text, mintToken)` – adds `data-erfana-el="<token>"` after each eligible start-tag name; returns the token table |
| `encoding.ts` | `decodeLossless(bytes)` – strict UTF-8 keeping the BOM; byte-identical round-trip check |
| `conflictMarkers.ts` | Line-start scan for `<<<<<<< `, `=======`, `>>>>>>> `, `|||||||` |

**Main**

| File | Responsibility |
|---|---|
| `services/preview/PreviewProtocolHandler.ts` (changed) | After `resolveConfined` (`:330`), only when the feature flag is on, the ledger note is exactly a document/sub-frame load, the extension is `.html`/`.htm`, the file is ≤ 25 MB (§19 Rev 4), and comment mode is on or the bytes contain `erfana:comment`: decode losslessly → **one shared parse** → `instrumentHtml` + `parseCommentBlocks` + block → token resolution from the **bytes actually served** → serve instrumented bytes. Otherwise serve raw bytes, with a recorded "unavailable" reason when comments were expected. If the source already contains `data-erfana-el`, serve raw. |
| `services/preview/previewPathResolve.ts` (changed) | `resolveConfined` today returns only `{ body, ext }` (`:45-47`); it also returns the confined `realPath` so the token table can key on it |
| `services/preview/comments/ElementTokenTable.ts` | Token → `{realPath, loadId, fileHash, startOffset, tagName}`, **keyed per load**; a load is bound to one frame at its first `commentHello` and evicted when that frame navigates away or is destroyed (so one file shown twice keeps both tables); ≤ 50k tokens per document |
| `services/preview/comments/frameFileMap.ts` | `frameTreeNodeId` → confined real path, set on `did-frame-navigate`; in-page navigation (`pushState`, hash) ignored |
| `services/preview/comments/PreviewCommentService.ts` | Thin per-view façade hung on the live-view lifecycle (suspend, evict, resume, destroy). Delegates to the four modules below; each stays under 500 lines like other preview modules (`previewViewLifecycle.ts:7`) |
| `services/preview/comments/commentDraftStore.ts` | Drafts and main-minted `fileKey`/`threadKey`s: single use (drafts), 10-min TTL, bound to window `webContents.id` + panel + project session; dropped on view destroy and project switch |
| `services/preview/comments/commentFrameBroadcaster.ts` | Sends `commentState` to frames: full state to commentable frames, **mode-only state to every other frame** (srcdoc, about:blank, refused) so clicks are swallowed everywhere in comment mode |
| `services/preview/comments/commentPickHandler.ts` | Validates page signals (frame, load binding, token, rate limit), re-reads disk, opens drafts |
| `services/preview/comments/commentReloadCoordinator.ts` | Captures scroll/hash, attaches the restore to the next load of that page, fallback reload, own-write echo handling (§7.5) |
| `services/preview/comments/CommentWriter.ts` | The only page-driven disk write path (§7.6); per-file async lock |
| `src/main/utils/atomicWrite.ts` (changed) | Extract a **strict, no-fallback variant** `atomicWriteBytesStrict` for comment writes: reuses the `.erfana-tmp-` temp prefix (ignored by `DirectoryWatcherCore.ts:110`, `FileService.ts:213`, `atomicTempSweep.ts:42`), `renameWithRetry`, the owner/read-only/on-disk-spelling checks (`atomicWrite.ts:173-208`, `:278`); adds: refuse symlink and `nlink > 1`, `O_NOFOLLOW` + dev/ino (pattern `previewPathResolve.ts:236-255`), bytes in / bytes out (no re-encode), re-hash before rename, never write in place. `EXDEV`/`ENOTSUP` (network drives) → `COMMENT_WRITE_UNSUPPORTED_FS`. The existing `atomicWriteText` behaviour is unchanged. |
| `services/preview/previewSessionPolicy.ts` (changed) | `nodeIntegrationInSubFrames: true` when the feature flag is on (was `false`, `:43`); `sandbox: true` unchanged; the frozen-literal test pins both variants |
| `services/preview/previewViewLifecycle.ts` (changed) | Wires the new `wc.ipc` channels. New **and existing** link/CSP channels now fail closed when `senderFrame` is `undefined` (today `:198-201` treats `undefined` as the main frame – safe only while frames had no preload; `null` is already rejected) |
| `services/preview/previewInputForward.ts` (changed) | Adds only the toggle shortcut (typed key `m` + Ctrl+Alt / Cmd+Option; AltGr not captured). `docs/security.md:699` "six enumerated keystrokes" becomes seven |
| `shared/ipc/global-settings-schema.ts` (changed) | `htmlPreview.comments.enabled` (default `true`) next to `htmlPreview.enabled` (`:61`); new lenient `comments` identity section (§7.9) |
| `services/preview/PreviewExportController.ts` (changed) | Hides the overlay (pins, outline) around PDF export (`:146` prints the live page) |
| `ipc/preview/commentHandlers.ts` | `registerHandle` bundle; `isTrustedPreviewSender` first, then zod |

**Preload**

| File | Responsibility |
|---|---|
| `src/preload/previewPage.ts` (changed) | Existing link and CSP listeners gated to the main frame with `window === window.top` (primary check – `process.isMainFrame` is not in Electron's sandboxed `process` list), so frames do not double-report alongside `previewFrameCspConsole.ts`. Imports `./previewPageComments` (the bundling guard `electron.vite.config.ts:32-62` allows a relative import from a single entry). |
| `src/preload/previewPageComments.ts` | Runs in every frame: at document start records tokens (parser-inserted nodes before `DOMContentLoaded` only, each accepted once) into a `WeakMap` and strips the attribute; draws outline, label and pins in a closed shadow root (top layer via the Popover API; re-attach on removal with a budget of 3 per second, then "comments unavailable"); blocks pointer events and handles the picker keys in comment mode (capture phase, `isTrusted` only); sends picks and anchor visibility; listens on `preview-page:commentState` only |
| `src/preload/previewPage.contract.test.ts` (changed) | Reads **both** preload files. The import rule (`:119-124`) allows exactly `ipcRenderer` from `electron` plus the one relative `./previewPageComments` import; the `.on(` rule (`:89-95`) allows only the literal comment-state channel; `preventDefault` only inside the comment-mode handlers |

**Renderer** (under `src/renderer/src/`)

| File | Responsibility |
|---|---|
| `stores/usePreviewCommentStore.ts` | Per panel: mode, pins toggle, thread list, statuses, generation check against stale responses |
| `components/Panels/HtmlPreviewPanel/comments/CommentModeToggle.tsx`, `CommentListToggle.tsx`, `ShowPinsToggle.tsx` | Toolbar tools in `PreviewToolbarTools` |
| `…/comments/CommentContextMenu.tsx` | Shared `ContextMenu` (already `useOccluder('menu', true)`, `ContextMenu.tsx:153`); one item "Add comment" |
| `…/comments/CommentWindow.tsx` + `.css` | Thread view + editor; portal, `useOccluder('overlay', open)`, `erf-comment-*` classes |
| `…/comments/CommentDrawer.tsx` + `.css` | Side drawer, flow sibling of `.html-preview-page-area` (no occluder). As a full-width sheet it hides its own page through a panel gate: `…/comments/useDrawerSheet.ts` → `stores/usePreviewCoveredStore.ts` (§19 Rev 4) |
| `…/comments/IdentityStep.tsx` | First-run identity, shown as step 1 inside the comment window |
| `components/Settings/…` (changed) | New "Comments" section in `SettingsOverlay` (name, optional email) |
| `services/preview/commentGateway.ts` | The only reader of `window.api.previewComments` |
| `hooks/useCommentDirtyGuard.ts` | Reuses the dirty / conflict / save / autosave-hold handling of `previewTabMove.ts` (incl. its conflict variant that offers no Save, `:205-206`); matches tabs with `findEditorTabsShowing` (`openFileInPanel.ts:261`, which takes the **project-space** path – main returns it alongside the real path) + `useProjectStore.dirtyPanelIds` |
| `services/editorSaveRegistry.ts` (changed) | Public `whenSaveSettled(id)` (today only on a registry entry, `:64`) |
| `utils/iconRegistry.tsx` (changed) | Adds `message-square-plus`, `messages-square`, `message-square`, `message-square-off` |

**Shared IPC**: `src/shared/ipc/preview-comment-channels.ts`, `src/shared/ipc/preview-comment-schema.ts`, `global-settings-schema.ts` (new lenient `comments` section), new `ErrorCode`s (§8).

## 5. Format v1

### 5.1 Example

```html
    <!-- erfana:comment v1 id=c-k3j9q2m8x7p4d1za
    status: open
    target: <button class="cta">
    comment by Marcin Obel <m@example.com> at 2026-10-25T14:03:00Z:
      Make this button blue and bigger.
    reply by Anna Nowak at 2026-10-26T09:12:00Z:
      Agreed, also fix the padding.
    @data {"v":1,"id":"c-k3j9q2m8x7p4d1za","status":"open",…}
    -->
    <button class="cta">Buy now</button>
```

(The target starts its own line, so the block takes its own lines and the `<button>` line is unchanged. For a mid-line target such as `<p>Text <em>here</em></p>`, `-->` is directly followed by `<em>`.)

### 5.2 Grammar

```
block      = "<!--" SP "erfana:comment" SP "v1" SP "id=" cid EOL
             ind "status: " ( "open" | "resolved by " who " at " ts ) EOL
             ind "target: " tagsum [ " (built by script; anchored to this element)" ] EOL
             1*message
             ind "@data" SP json EOL
             ind "-->"
message    = ind ( "comment" | "reply" ) " by " who " at " ts ":" EOL
             1*( ind "  " rtext EOL )
who        = name [ " <" email ">" ]
ts         = YYYY "-" MM "-" DD "T" hh ":" mm ":" ss "Z"          ; UTC
cid        = "c-" 16base32lower ; message ids "m-" 16base32lower, crypto random
tagsum     = "<" tag [ " id=" q ] [ " class=" q ] ">"             ; display only
EOL        = the target line's own CRLF | LF | CR (else the file's first EOL, else LF)
ind        = the target line's leading whitespace
```

**Placement** (hybrid, §3):
- **Line-start target** (only whitespace before the start tag on its line): insert `<!-- … -->` + EOL + indent at the start tag's offset. The original indent stays before the block, so the block is indented like the target and the target line is byte-identical.
- **Mid-line target**: insert `<!-- … -->` only; `-->` is directly followed by the target's `<`.
- The inserted text is the block's byte range for edit and delete, so `delete(add(f)) === f` in both cases. Several threads on one element are consecutive blocks; a new block goes directly before the start tag (after any existing blocks).

### 5.3 `@data` – the single source of truth

```
{ "v":1, "id":cid, "status":"open"|"resolved",
  "resolved"?:{ "by":Author, "at":ts },
  "anchor":{ "tag", "id"?, "cls"?:[≤8], "path":cssPath,
             "quote"?:{ "exact","prefix","suffix" }            (≤200 chars each),
             "runtime"?:{ "path","tag","quote"?,
                          "snapshot"?:string ≤256 KB, "truncated"?:true,
                          "snapshotSource":"page" } },
  "view":{ "w","h","dpr","x","y","hash"? },
  "msgs":[{ "id":mid, "by":Author, "at":ts, "text", "edited"?:ts }] }
Author = { "name" ≤100, "email"? ≤254, "role":"human" }    ; "agent" reserved (decision 10)
```

- `runtime` exists only for JS-built targets. Its snapshot is `outerHTML` with nested `erfana:comment` nodes and `data-erfana-el` attributes removed, taken once, never updated.
- Unknown fields are preserved through edits (forward compatibility).

### 5.4 Escaping

- **`@data`**: `JSON.stringify`, then `<` → `\u003c`, `>` → `\u003e`, `-` → `\u002d`, `&` → `\u0026`, U+2028/2029 and bidi/control characters → `\uXXXX`. `--`, `-->`, `--!>`, `<!--` and a trailing `<!-` become impossible; `JSON.parse` reverses everything. The reviver drops `__proto__`, `constructor`, `prototype`; depth ≤ 6.
- **Readable text** (display only, never parsed for data): `--` → `-\-` (repeatedly); a line starting with `@`, `<<<<<<<`, `=======`, `>>>>>>>` or `\` gets a leading `\`; bidi and control characters shown as `\uXXXX`. The spec states "`-\-` reads as `--`".
- **Author name / email**: bidi and control characters are refused on write.
- **Character sets (P2 security review, F5)**: "bidi and control characters" means the Unicode property set `\p{Cc} \p{Cf} \p{Cs} \p{Co} \p{Cn} \p{Zl} \p{Zp} \p{Default_Ignorable_Code_Point}`. Author name and email refuse the whole set. The readable-text escaper escapes the same set except unassigned code points (`\p{Cn}`, so an engine upgrade never turns old text into a mismatch) and four joiners kept raw: ZWNJ, ZWJ, VS15, VS16. Code points above U+FFFF are escaped as both surrogate halves.

### 5.5 Finding blocks

Parse with parse5 (`sourceCodeLocationInfo: true`), visit comment nodes (including `<template>` content, so a block there is flagged `in-template`). A block is a comment whose data matches the anchored `^\s*erfana:comment\s+v(\d+)\b`. `v > 1` → kind `newer` (read-only, not damaged).

### 5.6 Insertion rules

The target needs a `startTag` location (implied `html`/`head`/`body`/`tbody` have none) and must not be `html`, `head`, inside `head`, or inside template content. Raw-text elements (`script`, `style`, `textarea`, `title`, `xmp`, `noscript`, `noembed`, `noframes`, `plaintext`) cannot contain real start tags, and a start tag's `<` is never inside an attribute. If an **in-file** target is not eligible (for example an implied `tbody`), climb to the nearest eligible ancestor and store the clicked element's backup anchors (path relative to the ancestor, tag, quote) as `runtime` **without a snapshot** – decisions 16–17 give snapshots only to JS-built elements, and main drops any page-sent snapshot whose token's element exists in the file. If no eligible ancestor exists, the menu item is disabled ("Can't comment here"). Never insert before the BOM or push `<meta charset>` past byte 1,024.

### 5.7 Parse result

```ts
type ParsedBlock =
  | { kind: 'ok'; range: [number, number]; rawHash: string; data: CommentData; target: TargetResolution }
  | { kind: 'damaged'; range: [number, number]; rawHash: string; reason:
      'no-data' | 'bad-json' | 'schema' | 'limits' | 'readable-mismatch' | 'conflict-marker'
      | 'duplicate-id' | 'in-template' | 'id-mismatch' | 'unterminated' }
  | { kind: 'newer'; range: [number, number]; version: number }
type TargetResolution =
  | { state: 'attached'; startOffset: number; via: 'position' | 'id' | 'path' | 'quote' }
  | { state: 'orphaned' }
interface FileCommentState {
  blocks: ParsedBlock[]; writable: boolean
  readOnlyReason?: 'encoding' | 'conflict-markers' | 'too-large' | 'too-many-blocks'
}
```

### 5.8 Limits (`PREVIEW_LIMITS.COMMENT_*` in `src/shared/preview-limits.ts`)

| Limit | Value |
|---|---|
| Text per message | 4,000 characters |
| Replies per thread | 200 |
| Blocks per file | 500 |
| Bytes per block, **serialised** (readable + `@data`, after escaping; checked before `JSON.parse` on read and before writing) | 2 MB – a write that would exceed it is refused with `COMMENT_LIMIT`, so every written block parses as `ok` (property P-007) |
| Snapshot | 256 KB of raw `outerHTML` (cut on a code-point boundary, never leaving `--`) |
| JSON depth | 6 |
| Author name / email | 100 / 254 characters |
| Pick signals | 5 per second per view |
| Tokens per document | 640,000, counted as start tags before any parse; over it the page is served raw, "page too large" (§19 Rev 4; R3-13 had 100,000) |
| File size | 25 MB (`COMMENT_FILE_MAX_BYTES`, equal to `PREVIEW.MAX_ASSET_BYTES`, the largest file the preview serves; §19 Rev 4 – was 4 MB). A file that grew past it after its load is read-only for comments with the reason "file too large" |
| Bytes per list | 64 MB for every file of one list together, and at most 64 files (`COMMENT_LIST_MAX_BYTES`, §19 Rev 4); the files left out are counted and the drawer says so |
| Parse budget per load | The parse runs in the worker (R3-12); main-thread time ≤ 10 ms at 1 MB, ≤ 30 ms at 4 MB and at 25 MB (F-002, §19 Rev 4) |

### 5.9 Re-attach order (cheapest first)

1. **Position** – the next start tag in the source after the block (R3-10), skipping whitespace and other erfana blocks, has the stored tag **and corroborates the anchor** (§19 Rev 4): the same `id`; or, with no `id` on either side, a matching quote (exact, or prefix and suffix) or the same CSS path; an anchor with no `id`, path or quote needs the tag only. Never an element with another `id`, or one whose text begins the stored suffix – the element that followed a removed target and slid into its place (and its `:nth-of-type` path). Decision table: `src/shared/htmlComments/anchorEvidence.ts`.
2. Unique `id` + tag.
3. Unique CSS path – not an element with another `id`, nor one that slid in (step 1).
4. Unique text-quote match (exact, then prefix/suffix; whitespace collapsed, NFC) – not an element with another `id`.
5. Otherwise **orphaned**. A block is never moved or deleted automatically (decision 21). Two equal candidates → orphaned, never a guess.

Work budget (added after P3): steps 2–4 use lookup tables built once per parse (`anchorLookup.ts`), and all quote reads in one parse share a budget of 40 million characters (a dense 4 MB page needs 12–19 million). Past the budget, the remaining blocks that still need step 4 are orphaned, with no error. This keeps a hostile page from stalling the parse worker (450 orphaned blocks on 4 MB: 6.9 s → about 0.3 s).

## 6. Element → source mapping

| Option | Verdict |
|---|---|
| DOM child-index path matched against main's parse5 tree | Rejected – drifts as soon as scripts insert nodes |
| Byte offsets in the served copy | Rejected – exposes positions and invites forgery |
| **Opaque per-load tokens in the served copy, stripped at document start** | **Chosen** |

- The protocol handler serves an instrumented **copy**; the file on disk never changes. CSP is unaffected (attributes only). Non-document requests (e.g. `fetch()` of the page's own HTML) get raw bytes – best effort, because the request kind comes from the diagnostic ledger. Leaking a token to a `fetch` is harmless: tokens are only accepted from parser-inserted nodes, once, and only from the frame the load is bound to.
- The preload's `MutationObserver` starts at script-context creation, reads `[data-erfana-el]` on every added subtree, stores `token ↔ element` in isolated-world maps (`WeakRef`), and removes the attribute before page scripts can see it. Spike S1 checks inline, `defer` and module scripts, custom-element `connectedCallback` and a page `MutationObserver` with `attributeOldValue` (residual: such an observer may read tokens; harmless for the same reason).
- **JS-built elements**: the pick walks up to the nearest tokened ancestor and records `runtime = {path relative to it, tag, quote, snapshot}`. Main validates the ancestor token against a fresh disk parse.
- **On every load**: block → token resolution happens in the **same pass** as instrumentation, from the bytes actually served (no second disk read that an agent write could race). Main sends pins by token; the preload resolves token → element → runtime path.
- **Frames**: the parent preload maps each child frame to its `<iframe>` element (Alt+↑ from the frame's `<body>`, pin offsets, reveal). How the two are matched (`window.frames` order vs `WebFrameMain.frames`) is spike S8.
- **Status**: not found in the file → orphaned (main decides). Found but not rendered (no client rects, `visibility:hidden`, `checkVisibility()` false, runtime path not matching yet) → not visible now. Re-checked on `MutationObserver` + `ResizeObserver`, throttled to one animation frame and at most every 250 ms, reported via `commentAnchors`.

## 7. Data flows

### 7.1 Enter comment mode
1. Toggle or Ctrl+Alt+M (macOS Cmd+Option+M) → `preview:commentSetMode {panelId, on: true}`.
2. Main sends `commentState {mode, showIcons, icons}` to each frame whose file maps via `frameFileMap`, and a mode-only state to every other frame.
3. Each preload attaches capture-phase `pointerdown/mousedown/mouseup/click/auxclick/dblclick/contextmenu/dragstart/submit` listeners on `window` (registered before any page script). For `isTrusted` events: `stopImmediatePropagation()`, plus `preventDefault()` except for `contextmenu`. Wheel and inner scrollers keep working.
4. The preload's capture-phase `keydown` handles the picker keys (§3). Only the toggle shortcut is forwarded by main.

### 7.2 Hover
Entirely in the frame: `pointermove` → `elementFromPoint` → outline + label in the shadow root. No IPC per move.

### 7.3 Right-click → menu
1. Preload sends `commentPick {kind: 'menu', token, runtime?, view}` (`isTrusted`, rate-limited).
2. Main checks `senderFrame` present, its file via `frameFileMap` by `frameTreeNodeId`, token belongs to that file and generation.
3. Main re-reads the file, resolves the offset, builds an excerpt **from disk**, mints a draft `{draftToken, realPath, offset, fileHash, anchors}`.
4. Main captures a fresh still image with the selected outline painted (§3), through the **existing** still-frame cache (`previewStillFrameFreshness.ts`, its `shouldKeep` check), then emits `preview:commentDraftOpened {point, tagLabel, excerpt, displayPath, filePath, projectPath, runtime}`. For a pointer pick the point is `screen.getCursorScreenPoint()` minus the window content origin, divided by host zoom, clamped to the panel (spike S4). For a keyboard pick (Shift+F10 / Menu key) the point is the element's top-left + 4 px, sent by the preload. Budget: right-click → menu visible ≤ 150 ms including the capture (spike S6, F-003).
5. Renderer opens `CommentContextMenu`.

### 7.4 Add comment
"Add comment" (or a left-click pick of kind `open`) opens `CommentWindow`. If identity is unset → `IdentityStep` first. Dirty guard (§7.8). Save → `preview:commentSave {draftToken, op: 'add', text}`.

### 7.5 Save
1. `isTrustedPreviewSender`, then zod. Draft must be single-use, unexpired, same window/panel/project session.
2. Main reads the author from its own global settings; the renderer never sends it.
3. Main captures `{x, y, hash}` from the top frame via `executeJavaScriptInIsolatedWorld(996, …)` (new world; 997–999 are taken).
4. `CommentWriter.add` (§7.6).
5. **No direct reload.** `commentReloadCoordinator` attaches the restore to the next load of that page in that view, and lets the normal watcher path reload it (`previewEntryWatch.ts` for the page, the frame watch pool for frames). If no watcher-triggered load starts within 300 ms, it calls `pipeline.reload(false)` as a fallback (respecting the pending-navigation deferral, `previewLivePipeline.ts:193-202`). This gives exactly one reload per write, per view, and every other preview of the same file refreshes through its own watcher as usual. If the panel's page is no longer the draft's page (Back was pressed while the window was open), the restore is dropped and the window closes keeping the text.
6. On `did-finish-load` (world 996): set `location.hash` if it differs, then a `requestAnimationFrame` loop `scrollTo(x, y)` for up to 1 s, until the page is tall enough or the user scrolls. Frames: the frame's own scroll is restored by its preload from the captured `view` (best effort, spike S3).
7. Pins: the preload sends `commentHello` at `DOMContentLoaded`; main replies with `commentState` (avoids the 750 ms pipeline rate limit, `constants.ts:701`). The new pin flashes once (static highlight under reduced motion).

### 7.6 CommentWriter (one lock per real path)
1. `confinePath(realRoot, path)` (`previewPathResolve.ts:93`) without `allowBuildDirs`; extension `.html`/`.htm`; no NTFS alternate data stream name (`src/main/services/browserLaunch/BrowserLaunchService.ts:59`); the protocol layer's exclusion rules (`isInExcludedDirectory`, `hasDotSegment`, 8.3 check – `previewExclusion.ts`). Gitignore is **not** a write rule (decision 35): a page the preview serves is commentable.
2. `lstat`: refuse symlink and `nlink > 1`.
3. Open with `O_NOFOLLOW` + dev/ino match; bounded read; hash.
4. `decodeLossless` – UTF-8 ± BOM only, byte-identical round trip; else `COMMENT_ENCODING_UNSUPPORTED`.
5. Conflict scan – a complete hunk at line starts → `COMMENT_FILE_CONFLICTED`.
6. Parse. **Add**: if the hash equals `draft.fileHash`, use the draft offset; else re-anchor with the draft's backup anchors, require exactly one match, else `COMMENT_TARGET_MOVED`. **Edit/delete**: find the block by id; its `rawHash` must equal what the window opened (else `COMMENT_BLOCK_CHANGED`); damaged and newer blocks refused (except "Delete block" on a terminated damaged block whose bytes still match).
7. Splice on the decoded string, encode.
8. Verify: `new == old[0:s] + insert + old[e:]` byte for byte; re-parse – comment-node delta is exactly +1 / 0 / −1 and the block's `@data` round-trips. Else fail closed.
9. `atomicWriteBytesStrict`: `.erfana-tmp-` temp file in the same directory → fsync → re-read and re-hash the target (must equal step 3) → `renameWithRetry` (Windows `EPERM`/`EBUSY` backoff; never fall back to an in-place write) → keep mode and on-disk spelling. `EXDEV`/`ENOTSUP` → `COMMENT_WRITE_UNSUPPORTED_FS`.
10. Logs: `redactPath`, `stablePathDigest`, error codes only. No author, email or text.

### 7.7 Pin, edit, reply, resolve, delete
- A pin click (any mode) sends `commentPick {kind: 'icon', key}`; main maps the key to thread ids and emits `draftOpened {threadIds}`.
  *Rev 3 note (P5):* the icon event also carries `blockKeys` and, when the pin's element can take a comment now, a `draftToken` with its `draftKey` and `target` – the window's **New comment** on the same element (no `unsavedSource`: §19 "Draft event fields"). The draft is built from disk as a menu's is, on the element the pin stands on (its stored runtime path, never one the page describes), and minted like any draft: single use, 10 minutes, bound to window + panel + session (§19 "Rev 3 notes").
- The renderer fetches thread content through `preview:commentList`. Text and emails never enter the page.
- Ops: `reply | editMessage | deleteMessage | setStatus | deleteThread`. Deleting the first message deletes the thread. Anyone may do anything (decision 31). Each op is a §7.6 replace or delete.

### 7.8 Unsaved editor guard (decision 13)
Before enabling Save: `findEditorTabsShowing(api, projectPath)` with the **project-space** path main returned; if any id is in `dirtyPanelIds`, show the "Save your edits first" banner with **Go to tab** and **Save {file}** (`editorSaveRegistry.save`). If the tab is in the "changed on disk" conflict state, the banner offers **Go to tab** only (no Save – saving would overwrite the outside edit), following `previewTabMove.ts:205-206`. During the write: `editorSaveRegistry.holdAutosave(id)` + `editorSaveRegistry.whenSaveSettled(id)` (new public method), released afterwards; the clean editor reloads via `useFileWatcher` with no conflict banner. Limitation: a tab in another window is not seen; the disk re-hash still prevents a stale overwrite. The same guard applies to a frame's own file.
*Rev 3 note (P5, L2):* main accepts a reported dirty path only when it is fully qualified, lexically inside the open project and free of a Win32 device prefix (`\\?\`, `\\.\`, `\??\`); anything else is dropped before main resolves it. A UNC path is resolved only when the project itself is on that share. Dropping is safe: comments never write outside the project.

### 7.9 Identity
`GlobalSettingsSchema.comments = { authorName?, authorEmail?, identityNoticeSeen }`, lenient `.catch` (pattern `global-settings-schema.ts:80-84`). App-level `~/.erfana/settings.json` only – never project `.erfana/` (a cloned repo must not preset identity). The identity step shows on the first comment whenever `identityNoticeSeen` is false – also when the name was already set in Settings (then the fields are pre-filled and the notice is the point). Prompt copy in §10.7. No migration is needed: the new section is lenient and absent in older settings files.
*Rev 3 note (P5, L6):* one identity rule for every place that checks one, `src/shared/htmlComments/identity.ts`: a name or email may not carry a control, format (bidi marks, overrides, isolates, zero-width), surrogate, private-use, unassigned, line/paragraph-separator or default-ignorable code point. The writer refuses such an author; reading the settings file treats such a value as unset (lenient); a **write** through `setSetting` is checked strictly and refused with `GLOBAL_SETTINGS_VALIDATION_FAILED` and a message naming the field.

### 7.10 Drawer "Show on page"
`preview:commentCommand {panelId, command: 'reveal', threadId}` → main sends `commentState {reveal: key}` to the owning frame → `scrollIntoView({block: 'center'})` + flash. Frame-in-parent scrolling is spike S3.

## 8. IPC

**Page → main** (`wc.ipc`; `senderFrame` required; frame must map via `frameFileMap`; strict zod; rate-limited; `event.isTrusted` checked in the preload)

| Channel | Payload |
|---|---|
| `preview-page:commentHello` | `{}` |
| `preview-page:commentPick` | `{kind: 'menu' \| 'open' \| 'icon', via: 'pointer' \| 'keyboard', token?: base32(12), key?: string≤40, point?: {x, y} (keyboard picks), runtime?: {path≤1KB, tag≤32, quote?: {exact, prefix, suffix ≤200}, snapshot?≤256KB, truncated?}, view: {w, h, dpr, x, y, hash≤512}}` |
| `preview-page:commentAnchors` | `{visible: key[]≤500, hidden: key[]≤500}` |

**Main → frame** (`WebFrameMain.send`; the preload's only `ipcRenderer.on`)

| Channel | Payload |
|---|---|
| `preview-page:commentState` | `{mode, commentable: boolean, showIcons, icons: [{key, token, runtime?: {path, tag}, count, status: 'open' \| 'damaged'}], reveal?: key, restore?: {x, y}, theme: ResolvedOverlayTokens}` – non-commentable frames get `{mode, commentable: false}` only |

**Renderer ↔ main** (`registerHandle` + `isTrustedPreviewSender`; names in `PreviewCommentChannels`)

| Channel | Payload |
|---|---|
| `preview:commentSetMode` | `{panelId, on, showIcons}` (both sent; `showIcons` is per tab, §3) |
| `preview:commentList` | `{panelId}` → `{files: [{fileKey, displayPath, filePath, projectPath, writable, readOnlyReason?, threads: ThreadView[] (each with a `threadKey`), damaged: [{blockKey, reason, line, raw}], newer: [{blockKey, version, line}]}], unavailable?: reason}` |
| `preview:commentCommand` | `{panelId, command: 'reveal', threadKey}` |
| `preview:commentSave` | `{draftToken, op: 'add', text}` or `{fileKey, threadKey \| blockKey, rawHash, op, messageId?, text?, status?}` → `{ok: true, threadKey}` \| `{ok: false, code}`. `fileKey`, `threadKey`, `blockKey` are main-minted opaque keys bound to window + panel + project session (§3); an unknown or foreign key is refused. |

**Events** (`PreviewCommentEvents`): `preview:commentDraftOpened`, `preview:commentsChanged {panelId, counts}`, `preview:commentAnchorStatus {panelId, notVisible: threadId[]}`.

**New `ErrorCode`s**: `COMMENT_TARGET_MOVED`, `COMMENT_BLOCK_CHANGED`, `COMMENT_ENCODING_UNSUPPORTED`, `COMMENT_FILE_CONFLICTED`, `COMMENT_DRAFT_EXPIRED`, `COMMENT_KEY_INVALID`, `COMMENT_IDENTITY_REQUIRED`, `COMMENT_LIMIT`, `COMMENT_FILE_TOO_LARGE`, `COMMENT_WRITE_REFUSED_LINK`, `COMMENT_WRITE_UNSUPPORTED_FS`, `COMMENT_UNSAVED_SOURCE`, `COMMENT_FILE_GONE`. (`NOT_SESSION_OWNER` is a confinement-layer code, `shared/ipc/confinement.ts:23`, not an `ErrorCode`; key binding uses `COMMENT_KEY_INVALID`.)

*Rev 3 note (P5):* also `COMMENT_PATH_REFUSED`, `COMMENT_FILE_READ_ONLY`, `COMMENT_WRITE_FAILED` and **`COMMENT_SAVE_PENDING`**: a save that outlasts its 15 s answer limit is answered `COMMENT_SAVE_PENDING` – still being written, not failed; the draft stays held so no second write starts, and if the write lands later main reloads the view and sends `preview:commentsChanged` even with unchanged counts, so the window re-lists (wording in §10.10). Payload additions: a `ThreadView` may carry `quote` – the stored element text for "It was attached to:", at most 200 characters, one line, invisible and bidi characters as visible `\uXXXX` (`visibleInline`, refused raw by the schema); the `icon` draft event may carry `draftToken`, `draftKey` and `target` (§7.7; §19 "Draft event fields"). Every `ErrorCode` fallback sentence in `errors.ts` is §10.10's, `{file}` included, pinned by `errors.comments.test.ts`.

**Drawer mapping of block kinds**: `newer` (v2+) blocks go under "Needs attention" with the tag "Newer format – read-only"; a resolved thread whose element is not found stays under "Resolved" with the "Element not found" tag. "Show on page" on a not-visible row scrolls to the in-file ancestor and says "This element isn't on screen right now"; on an orphaned or damaged row it is replaced by "Open in source" (jumps to the block's line).

## 9. Security

### 9.1 Threats (STRIDE) and required controls

| # | Threat | Control |
|---|---|---|
| S1 | Page rewrites token attributes or moves nodes so the comment lands elsewhere | Opaque per-load tokens; preload strips them at document start; main re-locates from disk at Save; popup excerpt comes from disk |
| S2 | Page forges clicks with `dispatchEvent` / `.click()` | `event.isTrusted`; signals only open a draft |
| S3 | Compromised renderer sends arbitrary IPC | Nothing on B1 writes; frame check; rate limit |
| S4 | Page fakes outlines, pins or a comment window; clickjacking | Closed shadow root, inline `!important` host styles, re-attach on removal; typing happens only in Erfana chrome over a frozen page (accepted residual, risk 8) |
| S5 | Page reads comment text from the overlay | No text or emails cross B1' |
| S6 | Page `fetch`es its own HTML and exfiltrates names and emails | **Cannot be closed.** Disclosed in the first-run prompt and docs; email optional |
| S7 | Message flooding, oversized payloads | Hover never crosses to main; token bucket; strict schemas; counted drops |
| S8 | Path traversal via frame, `../`, 8.3 names, ADS | File comes only from main's record of the frame's last full navigation; confinement chain (§7.6 step 1) |
| S9 | Frame `pushState`s so its URL names another file | `frameFileMap` by `frameTreeNodeId` on `did-frame-navigate`; never read `frame.url` at Save |
| S10 | TOCTOU – the file changes between parse and write | Re-read at Save; hash before splice and before rename; per-file lock; dirty-editor block |
| S11 | Symlink / hard link redirects the write | `lstat` refusal, `nlink === 1`, `O_NOFOLLOW` + dev/ino; never `atomicWriteText` |
| S12 | Writes into excluded, dot-folder or out-of-project files | Same rules the protocol layer uses to serve (decision 35): never-served paths are never written. Gitignored pages shown in frames are commentable; the residual (a malicious repo can gitignore a page and frame it) is no worse than risk 17 today, because the write still needs the user's Save |
| S13 | `-->` breakout plants live HTML/script in the user's file (**critical**) | §5.4 escaping + §7.6 step 8 post-write verification; fail closed |
| S14 | Page-supplied snapshot carries breakout or prompt-injection text to agents | Snapshot captured by the preload, capped, nested blocks stripped, escaped, labelled `snapshotSource: "page"` and "captured from the page" in readable text; popup shows its size and first line |
| S15 | XSS from a hostile block into React or the overlay | React text nodes only; ESLint `no-restricted-syntax` bans `dangerouslySetInnerHTML` under `comments/`; overlay receives numbers only |
| S16 | Prototype pollution / huge JSON in `@data` | Size cap before parse; reviver; strict zod with depth/count caps; zod ≥ 4.6.7 |
| S17 | ReDoS in the parser | parse5 tokenizer (linear); anchored header regexes on capped strings |
| S18 | Bidi / zero-width spoofing of authors or text | Refuse in author/email; `\uXXXX` in text; render with `<bdi>` / `unicode-bidi: isolate`; visible `⟨U+202E⟩` tokens in the UI |
| S19 | Forged authorship | UI never implies the author is verified; git history is the audit trail |
| S20 | Cloned repo presets reviewer identity | Identity in app-level settings only |
| S21 | PII in logs | Codes and digests only; `redactUserInput` if a message must carry user text |
| S22 | Encoding damage | §7.6 step 4 |
| S23 | Stale draft, stale key, or second window saves into another project | Draft tokens **and** `fileKey`/`threadKey`/`blockKey` are bound to window `webContents.id`, panel and project session; anything else → `COMMENT_KEY_INVALID` |
| S24 | Request-kind ledger drift serves tokens to a `fetch` or raw bytes to the page | Security does not depend on the ledger (§6); a missed instrumentation is visible ("Comments unavailable") and logged through `dropReporter` |
| S25 | Overlay re-attach fights a framework that rebuilds `<body>` | Re-attach budget (3 per second, shared by the host's watch and each render), then "comments unavailable" for that page. A `document.open()` (which erases every listener, the preload's included) puts the listeners back and reports "comments unavailable" for that load |

### 9.2 Preload contract change (deliberate)

- `previewPage.contract.test.ts`: read both preload files (today it reads only `previewPage.ts`, `:20`). `:89-95,114-117` – replace "no `ipcRenderer.on`" with "the only `.on(` is the literal `preview-page:commentState`". `:119-124` – the import rule allows `ipcRenderer` from `electron` plus exactly the `./previewPageComments` relative import. Keep banning `invoke`, `sendSync`, `postMessage`, `contextBridge`, `webFrame`. `preventDefault` appears only inside the comment-mode handlers. Drift tests for the new channel names (pattern `:43-62`).
- Policy freeze test: flag on → `nodeIntegrationInSubFrames: true`, every other key unchanged; flag off → today's exact literal. A frame's preload registers no link or CSP listener.
- Existing link/CSP channels fail closed on `senderFrame === undefined` (P4), reviewed by security-auditor.
- `PreviewRequestKindLedger.ts:21-23` header: "the kind only ever picks a diagnostic" becomes "… and whether comment instrumentation is attempted; security never depends on it".
- These ship in the same change as the `docs/security.md` rewrite, and are called out in review.

### 9.3 `docs/security.md` updates

Rewrite `:699` ("no file-write path" → "no write path from the page; one user-gesture write path from Erfana's own Save"; "six enumerated keystrokes" → seven), `:701-705` (send plus one main-to-frame state receive; preloads run in frames; `:704` "exactly two message shapes"), `:727` ("three send-only channels"), `:762` (`nodeIntegrationInSubFrames`, now behind `htmlPreview.comments.enabled`). Amend risk 17: gitignored pages shown in frames are now also commentable (decision 35). Add assets A7 (HTML bytes), A8 (reviewer identity), A9 (comment meaning that agents act on); attacker T5 (hostile comment author); control-table rows (draft-token Save gate, write confinement, escaping + verification, limits, overlay without text, logging, comment-mode key forwarding); amend risks 6, 8, 17; add risks 20 (comments readable/exfiltrable by the page), 21 (unauthenticated authorship), 22 (comment text and page snapshots as an injection channel to agents), 23 (parse-to-rename race narrowed, not closed). New subsection "HTML preview comments" with §4.1's diagram.

## 10. UX specification

### 10.1 Toolbar and mode

```
[Back][Links] [Find] [Comment][Comments 3][Pins]  ·spacer·  2 blocked ▸ | [Browser][PDF]
```

| Control | Pattern | Icon | Accessible name |
|---|---|---|---|
| Comment mode | Toggle, `aria-pressed`, `erf-band__tool--toggle` | `message-square-plus` | "Comment mode" (never changes) |
| Comments list | Disclosure, `aria-expanded` + `aria-controls` | `messages-square` + count | "Comments, 3 open" |
| Pins | Toggle, `aria-pressed`, default on, per tab, not persisted | `message-square` / `message-square-off` | "Show comment icons" |

- Shortcut Ctrl+Alt+M / Cmd+Option+M. Match the **typed key** `m` with modifiers, never the physical key (AltGr+M types µ on German layouts). Verify Cmd+Option+M is not "Minimize All" on macOS.
  - *Rev 3 note:* the shortcut has three routes – main's forwarder (focus in the page), the panel root's `onKeyDown` (focus in the chrome) and `usePreviewGroupKeys` (focus on dockview's group element, where `group.focus()` leaves it after a tab switch; the panel renders in the overlay layer, outside that element). The third route acts only for the active tab and skips keys the root already saw; it also carries Back/Forward. Without it the toggle did nothing right after a preview tab became active (found on macOS).
- Leave with Esc, the toggle or the shortcut. Esc order with focus in the page: open window → comment mode → existing "return to chip".
- Mode indicators: pressed toggle; 2 px accent frame inside the page edge; top-centre tab "Comment mode – Esc to leave" (moves to the bottom when the pointer comes within 48 px). The band height never changes.
- Cursor: system `crosshair`.
- The mode belongs to the tab; it survives the save reload and same-tab navigation. Keyboard activation (`event.detail === 0`) moves focus into the page with the picker started.
- The permission band card and `nav.css` narrow tiers are re-measured; at the minimal tier the Pins toggle leaves the row (it stays reachable in the drawer).

### 10.2 Outline and label

- Border box only, two-tone: 2 px accent ring with 1 px ink line on both sides. Selected: same ring + 12% accent fill.
- Label `button#buy.cta.primary 120×40`, system monospace 11 px; ≤ 2 classes then `…`, ≤ 40 characters; tag in accent, rest paper, size grey; `dir="ltr"`. Suffixes ` · script`, ` · frame other.html`, ` · 2 comments`, `iframe · remote content`.
- Above the element's top-left; flips below at the viewport top; clamped sideways.
- Alt+↑ parent (stops at `<body>`, announces "Top of page"); Alt+↓ back down the path, else first child; the level holds while the pointer stays inside that box. Instant, no tween.
- Same-project frame: its own elements; Alt+↑ from the frame's `<body>` moves to the `<iframe>` element in the parent (spike S8). Refused, `srcdoc` and about:blank frames: the `<iframe>` element itself, label `iframe · refused frame` / `iframe · inline frame`.
- PDF export: the overlay is hidden while printing, so pins never land in the PDF. Find in page: overlay text lives in a closed shadow root and is excluded from find counts (test R-021 / E-022). *Rev 3 note (P7):* a closed shadow root does **not** hide text from Find in page – Chromium searches it. Every word the overlay draws (the label, the mode tab, a pin's number) is CSS generated content (`::before { content: attr(data-text) }`), which Find never counts, and the page holds no live region (§10.8).
- Tiny (< 8 px): ring pushed out 2 px. Huge: clipped to the viewport, label sticks to the visible top-left. Fixed/sticky and scrolling: `getBoundingClientRect` per animation frame, drawn in the **top layer** (Popover API), snapped to device pixels.
- Isolation: one host element, closed shadow root, `all: initial`, inline `!important` positioning, re-attached by `MutationObserver`. Values arrive resolved in `commentState.theme`, never as `var()`. `forced-colors` → `Highlight` / `HighlightText`. Styles via constructable stylesheets (spike S5).

### 10.3 Context menu

One item "Add comment" (`message-square-plus`), menu label "Element", shared `ContextMenu` (decided Menu card: focus first item, roving tabindex, typeahead, Esc/Tab close). Opened by right-click in comment mode (at the pointer, flipped at edges) or Shift+F10 / Menu key on the picked element (at its top-left + 4 px). Closing returns **native** focus to the page. Outside comment mode the page owns its right-click.

### 10.4 Comment window

Dialog via the dialog stack, `role="dialog"`, `aria-modal="true"`, real focus trap. Inline size 360 px (min 320, max `min(480px, page area − 16px)`), block size ≤ `min(560px, page area − 16px)`; body scrolls, title and action rows fixed. Placement: right of element → left → below → above; under 400 px page width it becomes a sheet over the page area. `--color-bg-elevated`, 1 px `--color-border-subtle`, `--shadow-dialog`, radius 0.

```
New comment                                   [x]
button.cta · index.html, line 42
Added by a script – saved before <section id="pricing">.
Comment
┌──────────────────────────────────────────────┐
│ What should change here?                     │
└──────────────────────────────────────────────┘
Plain text. Saved inside index.html.   12 / 4000
Commenting as Marcin Obel  [Change]
                              [Cancel]  [Save]
```

```
Comments on button.cta                        [x]
Marcin Obel · Today, 14:32                    [...]
Make this say "Start free trial".
   Anna K. · Yesterday, 09:10 · edited        [...]
   Agreed – and move it above the fold.
Reply [________________________________] [Reply]
[Resolve]
──────────────────────────────────────────────
Resolved by Anna K. · 25 Oct     [Re-open] [v]
──────────────────────────────────────────────
                                 [New comment]
```

- Threads stacked in file order; a resolved thread folds to one line; replies one level deep.
- Author name shown; email in `title` and accessible description, shown in full only when two authors share a name.
- Time: absolute local via `Intl.DateTimeFormat` in `<time datetime>` ("Today, 14:32", "Yesterday, 09:10", "25 Oct, 14:32", year when not this year). Never counts up live.
- Body is **plain text**: `white-space: pre-wrap`, `overflow-wrap: anywhere`, `dir="auto"`; 4,000 characters, counter from 3,600; trimmed; NUL/control characters stripped; bidi controls shown as visible tokens; `-->` escapes hidden from the user.
- Cmd/Ctrl+Enter saves the focused field; Esc closes; a typed draft is kept in memory per element for the session ("Draft restored").
- Focus: new comment → text field; thread → window title (`tabindex="-1"`); delete confirmation → Cancel; close → back to the opener (list row, or native focus to the page with the picker on the same element).
- Saving: "Saving…" (`aria-disabled`) → write → reload → restore → pin within 1 s with one flash → announce "Comment saved to index.html."
- `[...]` per message: Edit (in place), Delete… (inline danger confirmation, destructive button right, focus on Cancel).
- Damaged: warning banner, raw block in a read-only monospace box, [Copy raw text] [Open in source] [Delete block…]; conflict markers get their own wording.
- Unsaved source: warning banner with [Go to tab] [Save {file}]; draft stays editable; clears itself if autosave gets there first.
- Not found / not visible: banner, stored quote struck through, Delete and Open in source.

### 10.5 Pin (speech bubble, decision 33)

Self-drawn inline SVG in the shadow root, sharp corners (viewBox path `M2 2H22V17H7L2 22Z`), body 20×16, hit target 24×24 (WCAG 2.5.8). The tail tip sits on the element's top-right corner, offset 4 px outward, clamped to the visible part of the element and the viewport.

| Content | Shown |
|---|---|
| 1 open thread | Two short ink "text lines" |
| 2–9 | The number, 11 px bold mono |
| ≥ 10 | `9+` |

| State | Look (never colour alone) |
|---|---|
| Open | Accent fill, 1.5 px ink stroke |
| Hover | `--color-brand-violet-hover` fill, pointer, `title` "2 comments – click to open"; in comment mode also outlines its element |
| Selected (window open or list row active) | Inverted: ink fill, 2 px accent stroke, accent content |
| Focus | 2 px accent ring offset 2 px + ink halo |
| Damaged | `--color-warning` fill, ink `!` |
| All resolved, not visible now, not found, pins hidden | Not drawn |

*Rev 3 note (P5):* the number and `!` are centred on the body's middle, `y="9.5"`, not on the 24-unit box (*P7:* they are now an HTML span in a `foreignObject` over the body, x 2, y 2, 20×15, drawn as generated content so Find in page cannot count them – §10.2); hover recolours an open pin only (never a selected or damaged one, and not in forced colours); a selected damaged pin keeps its warning fill and an ink `!` (accent on it is about 1.05:1); in forced colours a selected pin inverts – `Canvas` body, `Highlight` stroke and content.

Only open threads are counted. Clicking opens the window in any mode; the click never reaches the page. Overlapping pins move left along the top edge in 22 px steps (the ancestor keeps the corner). Drawn only for elements passing `checkVisibility({opacityProperty, visibilityProperty})` and in the viewport. Scales with page zoom. Never animated. `role="button"`, `tabindex="-1"`.

*Rev 4 note (owner test):* "the viewport" is the frame's **visible** viewport – scrollbars excluded – and a pin clamped to one of its edges keeps its box 4 px inside it, so a full-width element's pin is never drawn under the page's scrollbar (§19 "Rev 4 – owner test: pins at the right edge").

### 10.6 Comment drawer

Flow sibling at the inline end of `.html-preview-page-area` (never absolute), 320 px (min 280), opens instantly. Under a 640 px panel it takes the full width and "Show on page" closes it first. Filter "Show": **Open (n) · Resolved (n) · Needs attention (n)** (radio group). File order; "Not visible now" is an inline tag.

*Rev 4 note (owner bug):* as a full-width sheet the drawer hides **its own** page only – through the panel gate `covered`, never the window's occluder – and a tab dockview has hidden is not measured, so it keeps its last real width (§19 "Rev 4 – tab switch with the drawer open").

```
Comments                                    [x]
Show (Open 3) (Resolved 5) (Needs attention 1)
[x] Show comment icons
───────────────────────────────────────────────
button.cta                        2 replies  [Open]
Make this say "Start free trial"…
Marcin Obel · Today, 14:32
section#pricing      [Not visible now]       [Open]
```

Rows card contract (one Tab stop, ↑ ↓ Home End); Enter or click = Show on page (focus stays in the list); the active row's **Open** is the second Tab stop. Toolbar badge = open count, plus `· !1` when something needs attention. States: loading, empty per filter, read error with "Try again". Rows virtualised above ~200 items.

### 10.7 First-run identity

Step 1 inside the comment window on the first comment (nothing is lost, no stacked dialog):

```
Before your first comment
Erfana writes your name – and your email, if you add one – into the
HTML file next to each comment. Anyone who can open the file can read
them: in Erfana, in the page source, and in git history once the file
is committed and pushed. Scripts in pages previewed in this project
can read them too. Deleting a comment later does not remove it from
git history.
Name             [__________]  Shown next to your comments.
Email (optional) [__________]  Leave empty to keep your email out of the file.
                                         [Cancel]  [Continue]
```

Form card errors (`aria-invalid`, `aria-describedby`, icon + text). Settings gets a "Comments" section with the same fields (saved on blur; affects new comments only). "Commenting as … [Change]" edits inline.

### 10.8 Accessibility

- Keyboard-only path: shortcut or toggle → picker starts on the hovered element, else the element at the viewport centre → Tab / Shift+Tab next/previous at the same level (then the parent's next sibling), Alt+↑/↓ level, each move scrolls into view → Enter opens the window, Shift+F10 the menu. Arrow keys keep scrolling.
- Always-mounted polite live region in the shadow root ("button, Buy now, 2 comments."); mode and save results also go to `.erf-band__announce`; an assertive region for errors. Verify with NVDA, VoiceOver and Orca. *Rev 3 note (P7):* the page holds **no** live region – Find in page counts its text (E-022). The keyboard picker sends each move to main as a `step` pick (what it reached, as an element token – §19 "Picker words"), main passes it on as `commentModeChanged` with reason `picker`, and the comment chrome's polite region (`useLiveText`) says the §10.10 "Announce" sentence. Mode on and off are said there too.
- The drawer is the guaranteed keyboard route to every thread.
- Reduced motion: no transitions; flash = static highlight for 1.5 s; instant scrolling; nothing loops.

### 10.9 Tokens

| Tier | Names |
|---|---|
| New component tokens (`design-tokens.css`) | `--comments-window-width` 360px, `--comments-window-max-width` 480px, `--comments-drawer-width` 320px |
| Resolved into the page (`commentState.theme`) | `accent` ← `--color-accent-primary`, `accentHover` ← `--color-brand-violet-hover`, `ink` ← `--color-brand-black`, `paper` ← `--color-brand-white`, `muted` ← `--color-text-primary`, `warning` ← `--color-warning`, `font` ← `--font-mono`, `size` ← `--text-sm`, `ring` ← `--border-width-thick`, `pinTarget` ← `--btn-height-sm`; *rev 3 (P5):* `hairline` ← `--border-width`, `space1` ← `--space-1`, `space2` ← `--space-2`, `space4` ← `--space-4`, `leading` ← `--leading-snug` (the line height was a typed 1.4). A unit test checks the mapping against `design-tokens.css` (lint cannot see CSS inside a TS string). |
| Chrome | Existing `--space-*`, `--text-*`, `--color-bg-elevated`, `--color-border-subtle`, `--shadow-dialog`, `--color-text-tertiary` |

Contrast numbers quoted in design-system cards go into `docs/design-system/claims.json`, never typed.

### 10.10 Microcopy

| Where | String |
|---|---|
| Toggle tooltip | "Comment mode (Ctrl+Alt+M) – off" / "Comment mode (Ctrl+Alt+M) – on: click an element to comment, Esc to leave" (macOS: Cmd+Option+M); not ready: "Comment mode – available once the page has loaded" |
| List button | "Comments, {n} open" · "Comments, {n} open, {k} need attention" · "Comments, {n} open, 1 needs attention" (a count of 1 takes the singular verb) · "Comments, none yet" · "Comments, none open" (nothing open, but resolved threads exist) |
| Pins tooltip | "Show comment icons – on" / "Show comment icons – off: icons hidden on this page" |
| Mode tab | "Comment mode – Esc to leave" |
| Announce | "Comment mode on. Click an element, or press Tab to pick one. Esc to leave." · "Comment mode off." · "Top of page – no parent to select." · "No child elements." · "Showing {tag}, line {line}." · "Showing an element added by a script, inside {tag} on line {line}." |
| Menu | "Add comment" · disabled "Can't comment here" |
| Window titles | "New comment" · "Comment on {label}" · "Comments on {label}" · "Damaged comment" |
| Context line | "{label} · {file}, line {n}" · "Added by a script – saved before <{ancestor}>." · "Saved in {frame file}." |
| Field | label "Comment", placeholder "What should change here?", hint "Plain text. Saved inside {file}.", counter "{n} / 4000" |
| Identity line | "Commenting as {name}" · "Change" |
| Buttons | "Cancel" · "Save" (tooltip "Save (Ctrl+Enter)") · "Saving…" · "Reply" · "Resolve" · "Re-open" · "New comment" · "Edit" · "Delete…" · "Save changes" · "Close" · "Open" · "Show on page" · "Try again" |
| Meta | "{name} · {time}" · "· edited" · "Resolved by {name} · {time}" · "{n} replies" · "Draft restored" |
| Save errors | "Write a comment first." · "Comments can be up to 4,000 characters. This one is {n}." · "Couldn't save: {file} is read-only. Your text is still here." · "This element changed in the file since you picked it. Close and pick it again – your text will be restored." · "{file} no longer exists. Copy your text before closing." · "Couldn't save the comment. Your text is still here – try again." · "Erfana can only add comments to UTF-8 files." · "{file} has unresolved git conflicts. Resolve them first." · "{file} is a link to another file, so Erfana won't write to it." |
| Save pending (rev 3, P5) | "Still saving to {file}. Your comment appears here once it is written – no need to save again." |
| Saved | "Comment saved to {file}." |
| Unsaved source | "Save your edits first" / "{file} has unsaved changes in another tab. Save them first so your edits and this comment don't overwrite each other." · "Go to tab" · "Save {file}" · "Saved. You can add your comment now." · conflict variant (the tab also changed on disk; Go to tab only, no Save): "{file} has unsaved changes in another tab, and the file changed on disk too. Go to the tab and decide which version to keep, then add your comment." · the tab became clean without a save Erfana made: "The other tab has no unsaved changes now. You can add your comment." |
| Delete | "Delete this comment? It is removed from {file}. Git history keeps earlier versions." → "Delete comment" · "Delete this thread and its {n} replies?" → "Delete thread" |
| Damaged | "Erfana can't read this comment block, so it won't change it. Fix it in the source, or delete it." · "This block contains git conflict markers. Resolve the conflict in the source." · "Raw text (read-only)" · "Copy raw text" · "Open in source" · "Delete block…" · "Delete this damaged block? Erfana removes exactly the text shown above from {file}." → "Delete block" · "This block changed on disk. Reopen it and try again." |
| Not found / not visible | "Erfana can't find this element any more. The comment stays in {file}, line {n}." · "It was attached to:" · "This element isn't on screen right now – it may be on another slide or tab. Its icon comes back when it does." |
| Drawer | "Comments" · "Close comments" · "Show" · "Open {n}" · "Resolved {n}" · "Needs attention {n}" · "Show comment icons" · tags "Not visible now", "Element not found", "Damaged", "Resolved", "In frame: {file}" · "Reading comments…" · "No comments in this file yet. Turn on comment mode and click an element." · "No open comments." · "No resolved comments." · "Nothing needs attention." · "Couldn't read comments from {file}." |
| Pin | name "{n} comment(s) on {label}. Open." · damaged "Damaged comment on {label}. Open." · tooltip "{n} comments – click to open" |
| Identity | §10.7 · "Enter a name to continue." · "That doesn't look like an email address." |
| Settings | "Comments" · "Your name" – "Saved into HTML files next to each comment you write. Changing it affects new comments only." · "Your email (optional)" – "Also saved into the file. Leave empty to keep it out." · notice "Both are visible to anyone who can open the file – in the page source and in git history once pushed." · "Enter a name to add comments. Existing comments keep the name they were saved with." · feature flag "Comments in HTML preview" – "Lets you add comments to elements of a previewed page." · a settings write that failed: "Couldn't save this setting. Your text is still here – try again." |
| Unavailable | toolbar tooltip "Comments are unavailable for this page: {reason}" · reasons "file too large" (over 25 MB, §19 Rev 4), "not a UTF-8 file", "file is a link", "inline frame (srcdoc)", "unresolved git conflict", "the page keeps removing Erfana's overlay", "couldn't prepare the page" |
| File gone / draft expired | "{file} no longer exists. Copy your text before closing." · "This comment window was open too long. Pick the element again – your text is kept." → "Pick again" |
| Write refused | "Erfana can't write to {file} on this drive." |
| File limits (rev 4) | save error: "Erfana adds comments only to files of up to 25 MB and 640,000 elements." · read-only reason: "Erfana adds comments only to files of up to 25 MB and 640,000 elements. {file} is larger, so its comments are read-only." |
| List left files out (rev 4) | drawer note: "Comments from {n} files in this page aren't listed: one list reads at most 64 files and 64 MB. Open a frame's file in its own tab to see its comments." ("1 file" for one) |
| Fallbacks and raw text | the file name when none is known yet (a read error before the first list): "this file" · the clipboard refused the raw text: "Couldn't copy the raw text." · after "Copy raw text": "Raw text copied." |

### 10.11 Design-system cards (change cards before code that departs from them)

| Card (status) | Change |
|---|---|
| `docs/designs/comments/html-comments/` screens (decided) | The whole journey and every state of §10 on a fake page |
| Permission band (decided) | Three new tools after Find; re-measure `nav.css` tier thresholds |
| Focus (decided) | Exceptions: in-page ring uses passed-in colours; close returns native focus to the page; pins focusable but not in the Tab order |
| Menu (decided) | Exception: the opener is page content, so no `aria-haspopup` |
| Rows (decided) | Exception: the active row's Open button is a second Tab stop |
| Form (decided) | New textarea entry: multi-line, counter, Cmd/Ctrl+Enter |
| Colours, Layering, Motion, Icons, Buttons, Feedback (proposed) | In-page literals resolved from tokens; top-layer rung + dialog rung; one-shot flash; bubble pin + three lucide glyphs; inline destructive confirmation; banners inside the window |

Each code site that deviates carries `/* deviates: docs/design-system/<card>.html – why */` plus a row in that card's `#exceptions` section.

## 11. Cross-OS

| # | Risk | Mitigation |
|---|---|---|
| R1 | CRLF / LF / CR / mixed endings, git `autocrlf` | Target line's own EOL; nothing written outside the block; goldens for every EOL family; fixtures marked `-text` in `.gitattributes` |
| R2 | BOM, non-UTF-8 | Lossless decode; anything else read-only with a reason |
| R3 | Case-insensitive file systems (Windows, macOS) | Lock and `frameFileMap` keys = realpath; `pathsEqual` for editor matching; rename onto the real on-disk spelling |
| R4 | Windows `EPERM`/`EBUSY` on rename (antivirus, indexer) | Bounded retry with backoff; then refuse – never write in place |
| R5 | Watcher latency (FSEvents vs ReadDirectoryChangesW), double events | Direct reload + hash-checked echo filter; tests wait on the e2e hook's `ready`, never on time |
| R6 | Option vs Alt, Cmd vs Ctrl, AltGr layouts | Match `input.code` + `alt` for Alt+↑/↓; typed key for the toggle; per-OS modifier glyphs |
| R7 | HiDPI, mixed-DPI monitors, host zoom | Clamp popups to the panel; spike S4; integer coordinates in e2e |
| R8 | No `O_NOFOLLOW` on Windows (`previewPathResolve.ts:55`) | `lstat` refusal + dev/ino check + re-confine the real path |
| R9 | Path separators, `/var` vs `/private/var`, 8.3 names, NFD names on macOS | Native paths from main; `fileUtils` in the renderer; `realpath` / `realpathSync.native` in tests |
| R10 | Same file open in a second window | v1 limitation; disk re-hash prevents a stale overwrite |
| R11 | macOS first `capturePage` empty | Existing freeze handling (`HtmlPreviewPanel/CLAUDE.md`) |
| R12 | Windows occlusion stops painting covered windows | Reuse `E2E_CHROMIUM_ARGS` on any new launch site |
| R13 | Time zones | Injected clock; UTC in the file; TZ matrix test |
| R14 | Linux Wayland: `screen.getCursorScreenPoint()` may not return the real pointer position (inferred) | Spike S4 on X11 and Wayland; fallback to the point the preload sends with the pick (element-relative) |
| R15 | Linux desktops bind Ctrl+Alt+M or other Ctrl+Alt chords | Toolbar toggle always works; the shortcut is documented as "may be taken by your desktop"; manual Linux check |
| R16 | Case-sensitive file systems (Linux) | `Index.html` and `index.html` are different files – unit test that keys never merge them; case-insensitive merge only on Windows/macOS |
| R17 | Electron upgrades change sub-frame preload behaviour | Add "sub-frame preload + `commentState` receive + token strip timing" to the Electron upgrade checklist; SEC-22 and the P4 e2e exit test catch regressions |

## 12. Test strategy

About 330 tests in six layers; e2e ≈ 8%. The heaviest coverage goes to decision 24 (byte identity) and to the first page-driven write path. Each phase also has **one real-Chromium e2e exit test** (§13), so preload behaviour does not first meet Chromium at P7.

### 12.1 Pyramid

| Layer | Scope | Tooling / location | ≈ count |
|---|---|---|---|
| L1 unit | format, parse, escape, locate, splice, damage, conflict markers, anchor | vitest `main` project; `src/shared/htmlComments/*.test.ts` | 95 |
| L1p property | round trip, escaping, splice byte identity over generated HTML | `fast-check`; `htmlComments.property.test.ts`; `numRuns` 200 in CI (env override), seed printed, failing seeds pinned, 20 s per case | 6 |
| L1g golden | v1 serializer output, backward-compat corpus, lock manifest, spec-doc examples | `src/shared/htmlComments/__fixtures__/v1/`, `v1-compat/` (append-only forever) | 5 |
| L2 main service | re-read/re-locate, compare-and-swap write, confinement, concurrency, watcher/reload, instrumentation | vitest `main`; fake fs seam + real `mkdtemp` disk tests; split per hoisted-mock policy | 42 |
| L2i IPC schema | requests, events, caps, page signals | `src/shared/ipc/preview-comment-schema.test.ts` (per-file floor 98) | 12 |
| L2s security | forged/oversized/wrong-frame signals, pollution, sender gates, preload contract, policy freeze | vitest `main` + `preload`; part repeated in e2e | 41 |
| L3 injected | hover model, keys, capture-phase swallowing, pin model, visibility | jsdom per file under `src/preload/`; geometry, `elementFromPoint`, `checkVisibility`, Popover API and `adoptedStyleSheets` injected as test doubles | 30 |
| L4 React | toolbar, menu, window, thread, drawer, identity, settings, store | vitest `renderer`, Testing Library + user-event | 45 |
| L5 e2e | journeys on the real native view | Playwright `electron`; `e2e/html-preview-comments{,.frames,.safety,.perf}.e2e.ts` | 21 |
| L6 manual | agent readability, macOS trackpad/VoiceOver, real git merge | §16 | 6 |

### 12.2 Test cases

IDs: `HPC-U` unit, `HPC-P` property, `HPC-G` golden, `HPC-M` main, `HPC-I` IPC, `HPC-SEC` security, `HPC-J` injected, `HPC-R` React, `HPC-E` e2e, `HPC-F` performance, `HPC-X` manual.

**`format.test.ts`**
- U-001 minimal comment → exact golden bytes. U-002 thread with replies, resolved, author without email. U-003 `parse(serialize(x))` deep-equals `x`.
- U-004 missing `v1` → not a block; `v2` → `newer`, never rewritten.
- U-005 every WHATWG comment-text rule escaped (contains `-->`, `--!>`, `<!--`; starts with `>` or `->`; ends with `<!-` or `-`). U-006 the escape sequence itself round-trips.
- U-007 emoji, ZWJ, combining marks, CJK, RTL, bidi controls round-trip in `@data`; readable text shows them escaped. U-008 NUL, C0, lone surrogates handled per spec.
- U-009 CR/LF/CRLF inside text: readable block uses the file's EOL, `@data` keeps exact text.
- U-010 readable text disagreeing with `@data` → damaged `readable-mismatch`.
- U-011 invalid JSON → `bad-json`. U-012 schema violation → `schema`. U-013 `__proto__`/`constructor.prototype` → no pollution. U-014 > 2 MB → damaged without `JSON.parse`; depth 10,000 → damaged, no stack overflow. U-015 duplicate keys → damaged.
- U-016 unknown fields preserved through edit. U-017 reserved `role: "agent"` parses. U-018 timestamps UTC; identical output under `TZ=Asia/Kathmandu` and `Pacific/Kiritimati` (injected clock and id generator).
- U-019 snapshot > 256 KB → cut, `truncated: true`; cut never splits a surrogate pair or leaves `--`.
- U-020 worst-case block (256 KB markup-heavy snapshot, 200 replies × 4,000 characters of `<->&`) → either ≤ 2 MB and parses `ok`, or the serializer refuses with `COMMENT_LIMIT` before any write.
- U-021 a reply that pushes an existing block over 2 MB → `COMMENT_LIMIT`, file unchanged.

**`parse.test.ts` / `locate.test.ts`**
- U-030 finds every block with exact byte ranges. U-031 ordinary comments, SPDX headers and look-alikes without `v1` ignored.
- U-032 block-shaped text inside `script` (incl. JS strings), `style`, `textarea`, `title`, `template`, attribute values, outer comments, SVG CDATA, `xmp`, `noscript`, `iframe srcdoc` not reported (`template` → flagged `in-template`).
- U-033 insert point exactly before the start tag; target inside `<template>` content refused.
- U-034 uppercase tags, `>` inside quoted attributes, unquoted attributes, newline inside a tag, void elements, self-closing SVG; implied `tbody/html/head/body` → nearest located ancestor.
- U-035 UTF-16 offset → byte offset mapping after BOM, emoji, 3-byte CJK and CRLF. U-036 malformed HTML keeps exact offsets. U-037 BOM stays at bytes 0–2.
- U-038 `<html>` / `<body>` targets; `<meta charset>` never pushed past byte 1,024. U-039 several blocks on one element – new block directly before the start tag, order kept.
- U-040 line-start target → block on its own lines, target line byte-identical; mid-line target → no added whitespace; EOL per §5.2; minified one-line file (mid-line path). U-041 parse5 DOM before/after equal ignoring comment nodes and whitespace-only text nodes outside `pre`/`textarea`/`listing`; inside them no new text at all. U-042 line-start target inside `<pre>` → treated as mid-line (no added whitespace).

**`splice.test.ts`** (works on `Buffer`)
- U-050 add = `input[0..o] + block + input[o..]`. U-051 edit replaces only the block range. U-052 `delete(add(f)) === f`. U-053 add → edit → reply → resolve → reopen → delete returns the original bytes. U-054 editing one of two blocks leaves the other identical.
- U-055 LF, CRLF, mixed, CR-only, no trailing newline, trailing whitespace. U-056 BOM kept; a file without BOM never gains one.
- U-057 UTF-8 with stray invalid bytes → read-only (lossless round trip fails), bytes untouched. U-058 UTF-16 LE/BE, windows-1252 → refused, untouched.
- U-059 editing next to a damaged block leaves its bytes identical. U-060 an unchanged non-canonical block is never re-serialized. U-061 hash precondition mismatch → `stale`, no output.

**`conflictMarkers.test.ts` / damage**
- U-070 `<<<<<<<`, `=======`, `>>>>>>>`, `|||||||` inside a block → damaged `conflict-marker`. U-071 a hunk splitting a block → both halves damaged; no write range overlaps the hunk. U-072 unterminated block → damaged `unterminated`; whole file write-locked. U-073 user text with marker-like lines is escaped on write and not mis-detected on read. U-074 a complete hunk outside blocks → file `readOnlyReason: 'conflict-markers'`. U-075 reason codes complete. U-076 a lone `=======` or `|||||||` line (e.g. ASCII art in `<pre>`) → file stays writable.

**`anchor.test.ts`**
- U-080 block directly before the element → attached by position. U-081 whitespace between block and element still attaches; other content between → backups.
- U-082 each tier alone and in priority order (id → path → quote exact → quote prefix/suffix). U-083 two equal candidates → orphaned. U-084 no match → orphaned; loading never writes (bytes and mtime unchanged).
- U-085 JS-built → nearest tokened ancestor + snapshot; in-file element → no snapshot. U-086 snapshot strips nested blocks and `data-erfana-el`, frozen across later edits. U-087 resolved but hidden/zero-size → not visible, not orphaned. U-088 whitespace collapse, NFC vs NFD.
- U-089 (`anchorEvidence.test.ts`, §19 Rev 4) a position match must be corroborated: the first of three sibling cards removed (with and without ids, and on the X-001 page itself) → its comment orphaned, the others unchanged; a same-tag replacement with another `id` → orphaned; text edits (same `id`, same path, same context) and attribute changes → still attached; each row of the decision table.

**`instrument.test.ts` / `encoding.test.ts`**
- U-090 one token per eligible start tag; raw-text and template content untouched. U-091 source already containing `data-erfana-el` → raw served. U-092 instrumented copy differs from the original only by inserted attributes (strip them → identical). U-093 tokens are unguessable (crypto random, 12 base32). U-094 `decodeLossless` table: UTF-8, UTF-8+BOM, UTF-16 LE/BE, invalid bytes, overlong sequences.

**Property tests (`htmlComments.property.test.ts`)**
- P-001 any comment (arbitrary unicode incl. hostile sequences): `parse(serialize(c))` equals `c`.
- P-002 serialized block holds no forbidden sequence; parse5 reading `<div>` + block + `</div>` yields exactly one comment node with the expected data.
- P-003 any generated document (grammar generator: elements, tricky attributes, raw-text elements with fake blocks, existing comments, EOL style, BOM flag) and any eligible element: bytes outside the inserted range identical; `delete(add)` is the identity. **This is the proof of decision 24.**
- P-004 the locator never picks an offset where the parse5 tokenizer is outside the data state.
- P-005 `scan(add(f))` = `scan(f)` + the new block, other ranges shifted by exactly the block length.
- P-006 random mutation (byte flips, truncation, inserted conflict markers) never throws and never yields a write range touching a damaged range.
- P-007 every block the serializer accepts is ≤ the 2 MB cap and parses back as `ok` with equal data.
- P-008 (§19 Rev 4) any generated document and any anchor before any element: a block never attaches to an element that carries another `id` than the stored one, and stays by position on the element after it when that element's `id` agrees.

**Golden (`htmlComments.golden.test.ts`)**
- G-001 ten canonical serializations equal committed files byte for byte. G-002 every `v1-compat/` file parses to its `.expected.json` (append-only). G-003 `v1.lock.json` SHA-256 manifest – any change fails until the manifest is edited on purpose. G-004 examples in `docs/html-comments/format-v1.md` are extracted and parsed. G-005 a v1 block inside Markdown renders nothing in the app's Markdown pipeline.

**Main service (`PreviewCommentService*.test.ts`, `CommentWriter*.test.ts`, `atomicWriteBytesStrict*.test.ts`)**
- M-001 add: re-read, re-locate, write, return thread id. M-002 agent edited the file meanwhile, element still found → written at the new offset, agent bytes kept. M-003 element gone → `COMMENT_TARGET_MOVED`, draft kept. M-004 change between read and rename → detected, one re-read retry, then a clean failure.
- M-005 temp + rename; failure mid-write leaves the original intact and removes the temp. M-006 Windows `EPERM`/`EBUSY` → bounded retry (fake timers), final failure reported, original intact. M-007 mode bits preserved; read-only file → error, no write. M-008 file is a symlink → refused, link untouched.
- M-009 confinement: outside path, `..`, symlink escape, 8.3 name, UNC → refused; a case variant of a real project file on Windows/macOS is accepted and written under its real on-disk spelling; on Linux it is a different (missing) file. M-010 remote, `srcdoc`, `data:`, `blob:` frames → refused main-side. M-011 dirty source tab → `COMMENT_UNSAVED_SOURCE`; clean tab → allowed, editor reloads without conflict banner. M-012 two saves on one file at once → serialised, both blocks present.
- M-013 one write → exactly one reload, echo filtered. M-014 loading comments never writes. M-015 over-limit file → graceful refusal. M-016 `main.log` holds no comment text, author, email or raw filename. M-017 no author → `COMMENT_IDENTITY_REQUIRED`. M-018 anyone may edit/delete any comment. M-019 block changed since load → `COMMENT_BLOCK_CHANGED`, list reloads. M-020 deleting a terminated damaged block removes exactly its range; unterminated → refused.
- M-030 served copy carries tokens; disk bytes and mtime unchanged. M-031 tokens map to original offsets. M-032 token table keeps 2 generations, evicts older. M-033 forged or unknown token → no draft.
- M-040 scroll + hash captured before reload and restored after; a hash-routed deck lands on the same slide. M-041 restore retries while the document is shorter than the target, within 1 s. M-042 page navigated between save and reload → no restore onto the other page.
- M-050 `frameFileMap` follows `did-frame-navigate`, ignores `pushState`/hash. M-051 draft token: single use, 10-min TTL, bound to window/panel/session. M-052 only the toggle shortcut is forwarded (typed `m`); AltGr+M not captured; no other key added to the forward list.
- M-053 `fileKey`/`threadKey`/`blockKey` from another window, panel or project session → `COMMENT_KEY_INVALID`.
- M-054 page-sent snapshot for a target whose token's element exists in the file → dropped (decisions 16–17).
- M-055 gitignored page in a frame → commentable (decision 35); a file under `dist/` or a dot-folder → never served, never written.
- M-056 file deleted while the window is open → `COMMENT_FILE_GONE`, text kept. M-057 draft expired → `COMMENT_DRAFT_EXPIRED`, text kept.
- M-058 reload coordinator: exactly one reload per write per view; watcher-triggered load gets the restore; fallback reload after 300 ms; a second preview of the same file refreshes through its own watcher.
- M-059 token tables per load: the same file shown as page and frame keeps two live tables; navigating one frame away evicts only its table.
- M-060 instrumentation gates: flag off → raw bytes and `nodeIntegrationInSubFrames: false`; ledger note not a document load → raw; > 25 MB → raw with reason (§19 Rev 4, was 4 MB; the preview's own 25 MB read cap refuses such a file first, so the gate is a second line); no `erfana:comment` and mode off → raw.
- M-061 `atomicWriteBytesStrict`: `.erfana-tmp-` prefix, temp removed on failure, `EXDEV` → `COMMENT_WRITE_UNSUPPORTED_FS`, `atomicWriteText` behaviour unchanged (existing tests stay green).
- M-062 dirty guard uses the project-space path (project reached through a symlinked folder still finds the dirty tab).
- M-063 Linux case-sensitivity: `Index.html` and `index.html` keep separate locks, tables and keys.
- M-064 PDF export hides the overlay and restores it afterwards.

**IPC (`preview-comment-schema.test.ts`)**
- I-001 valid requests parse. I-002 strict objects; caps on text, author, email, ids. I-003 page-signal schema: enums and bounded finite numbers only (NaN, Infinity, negatives, `1e308`, long strings rejected). I-004 event schemas. I-005 channel names unique against `preview-channels.ts`; `docs/ipc-patterns.md` lists them.

**Security (`HPC-SEC-*`)**
- SEC-01 contract: the only `ipcRenderer.on` is the comment-state literal; no `invoke`, `sendSync`, `contextBridge`, `webFrame`, `postMessage`.
- SEC-02 `preventDefault` only in the comment-mode handler; link listeners unchanged and main-frame only.
- SEC-03 untrusted `click`/`contextmenu`/pin events (`dispatchEvent`, `.click()`) send nothing.
- SEC-04 page rewrites or forges `data-erfana-el` after load → unknown/stale token → no draft.
- SEC-05 pick payloads with a path, an offset, extra keys or oversized values rejected.
- SEC-06 1,000 picks/s → ≤ 5 accepted, one drop log line.
- SEC-07 `commentSave` from the preview webContents, a sub-frame or a forged origin refused before parsing.
- SEC-08 reused, expired, other-window or pre-project-switch draft tokens refused.
- SEC-09 frame `pushState`s to another path → comment still targets its navigated file, or is refused. *Rev 3 note (P5):* in real Chromium a `pushState` to another path throws `SecurityError`; after a same-document step (query, hash) a click still opens a draft on the file the load named (service e2e).
- SEC-10 symlink (in/out), hard link, ADS name, `node_modules`, dot-folder, `.html`→`.sh`, `srcdoc`/remote frame → refused, every byte unchanged; a gitignored page the preview serves stays commentable (decision 35, M-055).
- SEC-11 file changed or swapped just before rename → refused or re-located; never a stale write.
- SEC-12 text and snapshot fuzz (`-->`, `--!>`, `<!--`, `--->`, `<!-->`, `</script>`, backslash escape, NUL, lone surrogates) round-trips; parse5 sees no new elements.
- SEC-13 insertion refused inside `script`, `style`, `textarea`, `title`, `template`, `noscript`, `iframe`, attributes, before the BOM.
- SEC-14 byte identity on CRLF, LF, mixed, BOM, no-BOM; non-UTF-8 refused.
- SEC-15 hostile `@data` (`__proto__`, depth 10,000, 10 MB, 100k replies) → damaged, `({}).polluted === undefined`, bounded time.
- SEC-16 ReDoS corpus (long `-` runs, nested `<!--`, 4 MB of blocks) parses in < 200 ms; > 500 blocks capped. P5 note: on the emulated Windows host a plain 4 MB parse takes about 316 ms (220 ms in parse5; 1.37 s under coverage), so the time gate passes when the corpus parses in < 200 ms **or** within 4× a non-hostile page of the same size. A backtracking regex is thousands of times slower, so the gate still catches ReDoS. SEC-15's bounded-time check uses the same rule.
- SEC-17 damaged and conflicted blocks never rewritten by a nearby edit.
- SEC-18 bidi/control characters in author or email refused on write; rendered isolated and flagged on read.
- SEC-19 React XSS: `<img src=x onerror=…>` in text renders as text; the `commentState` payload has no text field.
- SEC-20 log scan after add/edit/delete with marker strings: no author, email, text or absolute path in `~/.erfana/logs`. *Rev 3 note (P5):* every line of every log file (main, renderer, combined, rotated), every spelling of the project path (as given, resolved, `/`-separated, JSON-escaped, `file:` URL), and no comment line carries the path-derived panel id; nine non-comment lines name the project path on purpose and are allow-listed by their fixed text (carried to P8, §19).
- SEC-21 overlay host removed or restyled by the page → re-attached; `host.shadowRoot === null` from the main world.
- SEC-22 policy freeze: `nodeIntegrationInSubFrames: true`, every other key unchanged; a frame's preload registers no link or CSP listener.
- SEC-23 (e2e) a page `fetch(location.href)` reads its own blocks – documents residual S6 (expected to pass).
- SEC-24 page with CSP `script-src 'none'` is still commentable (preload world unaffected).
- SEC-25 ESLint rule rejects `dangerouslySetInnerHTML` under `comments/`.
- SEC-26 a token is accepted once only, only from a parser-inserted node before `DOMContentLoaded`, only from the frame its load is bound to; a token copied into a `fetch` response or a script-created node is ignored.
- SEC-27 existing link and CSP channels refuse `senderFrame === undefined` (behaviour change, P4).
- SEC-28 overlay re-attach budget: a page removing the host in a loop → stops after 3 per second, "comments unavailable", no CPU spin.
- SEC-29 picker keys handled in the preload only for `isTrusted` events; synthetic `keydown` from the page does nothing.

**Injected model (`previewPageComments*.test.ts`, jsdom)**
- J-001 hover target and label text (classes cut, size, suffixes). J-002 Alt+↑ parent, Alt+↓ remembered child; stops at `body` and at a leaf. J-003 Esc leaves the mode; mode off keeps the listeners registered but inert (re-adding them later would put them behind the page's), and `dispose()` removes them.
- J-004 in mode: `click/mousedown/pointerdown/auxclick/dblclick/contextmenu/dragstart/submit` stopped in capture; out of mode page handlers run.
- J-005 pin at top-right, one numbered pin per element, `9+`, resolved hidden, toggle, collision stepping. J-006 element becomes visible → pin appears; hidden → `commentAnchors` reports it.
- J-007 JS-built detection, runtime path, snapshot stripping and 256 KB cut. J-008 only enums, tokens and numbers leave the isolated world. J-009 hovered element removed mid-hover; 10,000-element page keeps the hover handler constant-time.
- J-010 keyboard picker: Tab/Shift+Tab order, start element, Enter/Shift+F10/Menu signals (`via: 'keyboard'`, element point). J-011 token capture and strip before a later inline script runs (jsdom approximation; real check in the P4 e2e exit test).
- J-012 left-click in comment mode sends `kind: 'open'` (window directly, no menu) – decision 19. J-013 pin click inside comment mode sends `kind: 'icon'`, not `open`. J-014 the pin SVG path is exactly `M2 2H22V17H7L2 22Z` (decision 33). J-015 mode-only state in a non-commentable frame still swallows clicks. J-016 frame scroll restored from `commentState.restore`.

**React (`comments/*.test.tsx`)**
- R-001 menu holds only "Add comment"; arrows, Enter, Esc; disabled "Can't comment here". R-002 occluder registered on open, released on close and unmount.
- R-003 window: Save disabled for empty/whitespace; Ctrl/Cmd+Enter saves; Esc closes and keeps the draft; "Draft restored"; busy `aria-disabled`; every error keeps the text.
- R-004 thread order, reply, resolve/re-open, edit/delete any message, delete confirmations (comment, thread). R-005 damaged view read-only with reason, Copy raw text, Open in source, Delete block (conflict wording). R-006 not found / not visible views.
- R-007 unsaved-source banner with Go to tab and Save; clears when saved. R-008 identity step only when the name is unset; name required; email validated; copy matches §10.7; Cancel aborts.
- R-009 drawer filters and counts, file order, Not visible tag, Show on page, Open as second Tab stop, empty/loading/error states, virtualisation at 1,000 rows, narrow full-width mode.
- R-010 toolbar toggles (`aria-pressed`/`aria-expanded`), badge with `· !n`, disabled before load and for remote pages. R-011 no "Send to agent" control anywhere.
- R-012 tokens test (like `HtmlPreviewPanel.tokens.test.ts`) + overlay theme mapping matches `design-tokens.css`. R-013 dialog role, focus trap, focus targets, focus return, live-region "Comment saved". R-014 Settings "Comments" section persists, saved on blur, shows the visibility notice; feature-flag switch. R-015 store ignores stale responses. R-016 time formatting (today, yesterday, this year, other year) with injected clock and locale. R-017 bidi tokens visible in rendered text; `dir="auto"`.
- R-018 an `open` draft event opens the comment window directly with no menu (decision 19). R-019 identity step: name preset in Settings → notice still shown once (pre-filled), never again. R-020 drawer tags: "Element not found", "Damaged", "Newer format – read-only" separately; Show on page vs Open in source per row kind. R-021 unavailable state: toolbar tooltip with each reason. R-022 file gone and draft expired ("Pick again") keep the text. R-023 comment mode survives the save reload and same-tab navigation. R-024 dirty guard conflict variant offers Go to tab only.

**E2E (`e2e/html-preview-comments*.e2e.ts`)**

| ID | P | Journey |
|---|---|---|
| E-001 | P0 | Hover → right-click → Add comment → identity step → Save → pin visible; disk diff = exactly one block before the target |
| E-001b | P0 | Left-click in comment mode opens the comment window directly (no menu) → Save → pin visible |
| E-002 | P0 | Pin opens the window outside comment mode; reply, resolve (pin hidden, drawer "Resolved"), re-open |
| E-003 | P0 | Edit, then delete → file bytes equal the original |
| E-004 | P0 | Full cycle on a CRLF + BOM file; byte identity on disk |
| E-005 | P1 | JS deck at `#3`: comment a JS-built element → same slide and scroll after reload; slide 1 → "Not visible now"; back → pin returns |
| E-006 | P1 | Same-project iframe → child file written, parent untouched; pins drawn inside the frame; nested frame (frame in frame); gitignored framed page commentable; refused and `srcdoc` frames: clicks swallowed, only the `<iframe>` element commentable; dirty source tab of the frame's file blocks |
| E-007 | P1 | Comment mode swallows clicks (page counter stays 0); Alt+↑/↓ changes the label; Esc exits |
| E-008 | P1 | Dirty source tab blocks commenting; saving it unblocks |
| E-009 | P1 | Test writes an "agent edit" while the window is open → correct placement, agent edit kept |
| E-010 | P1 | Damaged/conflicted fixture: listed, read-only, delete only where allowed, nothing else changes |
| E-011 | P1 | Menu or window open → fresh still frame (shows the selected outline), native view hidden |
| E-012 | P1 | Outside edit removes the target → "Element not found"; block still in the file; also when the next element has the same tag (§19 Rev 4) |
| E-013 | P2 | 200 comments: drawer, pins, Show on page |
| E-014 | P2 | Pins toggle |
| E-015 | P2 | Hostile page: no window opened, mtime unchanged |
| E-016 | P2 | Keyboard-only path: shortcut → Tab picker → Enter → type → Cmd/Ctrl+Enter |
| E-016c | P1 | A left-click pick made while the page holds native focus: the new-comment window opens with native focus on the host and DOM focus in the field; typing needs no click, Cmd/Ctrl+Enter saves, the block is on disk (§19 Rev 4 "comment window focus and save key") |
| E-017 | P2 | Same file in two previews: comment appears in both after reload |
| E-018 | P2 | Focus in and out of the window and drawer |
| E-019 | P2 | Element rectangles and `innerText` equal before/after adding comments (pre/inline fixture) |
| E-020 | P3 | Markdown Preview has no comment entry |
| E-021 | P2 | Settings "Comments" section changes the author of new comments only |
| E-022 | P2 | PDF export of a commented page contains no pins; Find in page does not count overlay text |
| E-023 | P1 | Feature flag off → no comment UI, page served raw, frames run without preload (today's behaviour) |
| E-024 | P2 | `git diff` after add/edit/delete on a line-start target shows only added/removed block lines (target line unchanged) |
| E-026 | P1 | Two preview tabs; the drawer open and comment mode on in one; switch to the other: it is live (view shown, no still frame, clicks reach the page) with its own drawer, count and mode; back again, the first tab's drawer is still open. Run with the drawer as a full-width sheet and again as a side panel (§19 Rev 4) |
| E-027 | P1 | A paragraph inside a `<details>` the reader opened: the section stays open through comment mode's reload and the save's reload, and the pin is drawn; folded again it is "Not visible now", and the drawer row's Open unfolds it behind the window – the pin is back once the window closes (§19 Rev 4 "folded sections") |
| E-028 | P1 | A pin's thread window: every text button is a Dialog.css button; a reply typed, then **Open in source** – the window is gone and the editor shows the element's line; back on the preview the pin's window restores the reply; with the window open, switching to the editor tab hides it and switching back shows it again (§19 Rev 4 "open in source and button sizes") |
| E-029 | P1 | The drawer open as a side panel beside a page whose commented `div.doc` spans its width: along the pin's row the overlay takes the hit over a whole 24 px box ending 4 px inside the page's visible width (`clientWidth`, not under the scrollbar), the pin's fill shows there in the view's capture, and a click there opens its thread (§19 Rev 4 "pins at the right edge") |
| F-001 | P1 | Save → pin visible on the `slide-deck/` fixture: 20 samples, P95 < 1,000 ms. **Gate on macOS and Linux**; on the emulated Windows box record only (`known-flakes.md:62-76`) |
| F-002 | P1 | Shared parse + instrumentation per load: 0.5 / 1 / 4 MB files, a ~25 MB file (§19 Rev 4) and a 10-frame page within the §5.8 budget (recorded per OS) |
| F-003 | P2 | Right-click → menu visible ≤ 150 ms including the still capture; 200 pins keep hover at 60 fps (no long task > 50 ms) |

### 12.3 Fixtures

- Unit: `src/shared/htmlComments/__fixtures__/{v1,v1-compat,contexts}/`.
- E2E: `e2e/fixtures/html-preview-corpus/comments/` – `static-design/`, `slide-deck/` (`index.html`, `deck.js`, hash routing `#1`–`#5`, hidden slides, inner scroller), `iframe-host/` (+ `child.html`, a `srcdoc` frame, a remote frame on `localServer`), `raw-text/`, `damaged/` (bad JSON, schema, `v2`, unterminated, real conflict hunks), `hostile/` (forged events, prototype overrides, hide-all CSS, fake pin, node-deleting observer, CSP `'none'`), `agent-review/` (3–5 realistic commented pages + rubric).
- Generated at test time as `Buffer`s, never committed: CRLF+BOM, mixed EOL, CR-only, no trailing newline, 5 MB and over-limit files, 200-comment file, UTF-16 / windows-1252 / invalid UTF-8.
- `.gitattributes`: `src/shared/htmlComments/__fixtures__/** -text` and `e2e/fixtures/html-preview-corpus/comments/** -text` (the repo uses `* text=auto`).
- `REUSE.toml`: annotate the fixture folders; keep one SPDX-headed fixture to prove ordinary comments are ignored.

### 12.4 Driving the native view in e2e

- Hover/right-click via `webContents.sendInputEvent` from `app.evaluate` (rect × `wc.getZoomFactor()`, plus frame offset for frames), as `clickLink` does. macOS also covers Ctrl+left-click.
- Keys via the existing `pressKeyInPage` with modifiers.
- State via a main-side hook `__erfanaE2eComments.state(panelId)` behind `ERFANA_E2E_TEST_HOOKS=1` → `{mode, hovered: {tag, token}, icons: [{count, rect, visible}], ready}`, so tests never depend on closed shadow-root markup (the `/^executeJavaScript/` lint ban stays).
- Erfana chrome via ordinary locators; new ids in `testids.ts` and `e2e-selectors.md`.
- Independent disk oracle `expectSingleBlockDiff(before, after)` – common prefix/suffix, middle must be one `<!-- erfana:comment v1 … -->` block; never imports `splice.ts`.
- New `e2e/pages/html-preview.comments.ts` (functions: `hoverElement`, `rightClickElement`, `commentState`, `waitForPin`, `waitForPinGone`, `waitForCommentsReady`, `diskBytes`, `expectSingleBlockDiff`) and a `HtmlPreviewCommentsPage` class for chrome locators. Reuse `scrollState()`, `dismissAllToasts`, `stillFrame()`.
- Identity pre-seeded in the worker's `~/.erfana`; identity specs use their own home (as `settings-persistence.e2e.ts`).
- Condition-based waits only – never `waitForTimeout`.

### 12.5 Coverage

- Project floors unchanged (main 89/88/81/88, renderer 84/85/78/84). Tests land with the code so new files never count at 0%.
- New per-file floors, pinned ~2 points under the measured value when they land: ≥ 97/97/94/97 for `format`, `parse`, `splice`, `anchor`, `conflictMarkers`, `encoding`, `instrument`; 98 for `preview-comment-schema.ts`; ≥ 92/92/88/92 for the comment services, `CommentWriter`, `atomicWriteBytesStrict`, `ElementTokenTable`, `frameFileMap`; React comment components ≥ 90.
- **Preload**: `previewPageComments*` must meet the preload project's floors – 97/97/97/98 (`vitest.preload.config.ts:35`), a required `Coverage` gate. Its tests live under `src/preload/`.
- Only the injected bootstrap glue may be excluded, with an in-file reason.

## 13. Implementation phases

Each phase ends green on `npm run lint && npm run lint:css && npm run design -- --check && npm run typecheck && npm run test:cov && npx electron-vite build`, plus the e2e specs it adds. Critical path: P0 → P1 → (P2 ∥ P3) → P4 → P5 → P6 → P7 → P8.

| Phase | Work | Exit criteria | Size | Agent |
|---|---|---|---|---|
| P0 Spikes | S1–S9 (§15) on Windows (S4 also on Linux X11/Wayland via Docker/xvfb where possible), results recorded in `docs/spikes/html-preview-comments.md`; macOS confirmation of S1/S4/S6 deferred to handoff | Every blocking spike answered; any plan change written back into this doc before P1 | S–M | software-developer (Electron) |
| P1 Format core | `src/shared/htmlComments/*` (full schema incl. `runtime`, `view`, `role`), `fast-check` devDependency (check `License compliance`), fixtures, `.gitattributes`, `REUSE.toml`; hand-made `agent-review/` files from the P1 serializer | U-*, P-*, G-* green; public spec draft `docs/html-comments/format-v1.md`; **X-001 run on the P1 files** and any format change applied before P2 | M | software-developer + test-writer |
| P2 Writer | `atomicWriteBytesStrict` (extracted from `atomicWrite.ts`), `CommentWriter`, error codes | M-001–020, M-056/061/063, SEC-10/11/14/17 green; existing `atomicWrite` tests unchanged | M | software-developer; security-auditor review |
| P3 Instrumentation | Feature flag, `resolveConfined` returns `realPath`, protocol-handler gated instrumentation with the shared parse, per-load `ElementTokenTable`, ledger contract note | M-030–033, M-059/060, U-090–094, F-002 green; existing preview corpus e2e unchanged; **e2e exit**: a pre-seeded block's token reaches the right element (via the e2e hook) | M | software-developer |
| P4 Preload | Sub-frame preload, token strip, overlay (outline, label, pins, live region, re-attach budget), mode, picks, keyboard picker in the preload, frame ↔ `<iframe>` mapping; policy flip behind the flag; existing channels fail closed; contract tests over both files | J-*, SEC-01–06/21/22/24/26–29 green; preload floors met; ADR in `docs/adrs/` for "sub-frame preload with one receive channel"; **e2e exit**: tokens stripped before inline/defer/module scripts and a pin drawn for a pre-seeded block | L | software-developer (Electron); security-auditor review |
| P5 Service + IPC | Façade + draft store, frame broadcaster, pick handler, reload coordinator; `frameFileMap`; channels + schemas; toggle-key forwarding; fresh still capture; scroll/hash restore; PDF-export overlay hide; e2e hook | M-040–058, M-062/064, I-*, SEC-07–09/12/13/15/16/20/23 green; **e2e exit**: save → reload → restore through the e2e hook | L | software-developer |
| P6 Renderer | Store, toolbar tools, menu, window, drawer, identity step, Settings section, dirty guard, icons, unavailable state; design-system cards updated **first** | R-*, SEC-18/19/25 green; `npm run design -- --check` green; **e2e exit**: E-001 | L | react-developer; ui-reviewer + ux-reviewer |
| P7 E2E + performance | All `HPC-E`/`HPC-F` specs, POMs, fixtures; full `npm run test:e2e` on Windows; `npm run test:e2e:linux` | E-001–024 green on Windows and Linux; F-001 recorded on Windows (gated on macOS/Linux at handoff), F-002/F-003 recorded | M | e2e-test-writer; e2e-test-reviewer |
| P8 Docs + agent check | `docs/security.md`, `docs/ipc-patterns.md`, `docs/html-preview/README.md`, `HtmlPreviewPanel/CLAUDE.md`, `docs/html-comments/format-v1.md` final, Electron upgrade checklist entry, `docs/testing/e2e-testing.md`, `docs/CHANGELOG.md`; X-001 confirmation run on real Erfana-written files | Docs updated in the branch; X-001 confirmed; format locked (G-003 manifest committed) | S | project-documenter; code-reviewer + security-auditor final review |

After P8: hand off to macOS (§16).

## 14. Docs to update

- `docs/security.md` – §9.3.
- `docs/ipc-patterns.md` – § Current IPC Channels.
- `docs/html-preview/README.md` – user flow, statuses, limitations (encodings, links, other windows, frame scroll).
- `src/renderer/src/components/Panels/HtmlPreviewPanel/CLAUDE.md` – comment window is an occluder; pins and outline are drawn in the page; comment-mode keys.
- New `docs/html-comments/format-v1.md` – the public format spec (grammar, `@data` schema, escaping, placement, how agents and tools should read and leave blocks alone).
- New ADR in `docs/adrs/` – sub-frame preload with one receive channel.
- `docs/design-system/` cards – §10.11.
- `docs/testing/e2e-testing.md` – new POM and helpers.
- `docs/CHANGELOG.md`; root `CLAUDE.md` version line at release.

## 15. Spikes and open risks

| ID | Question | Blocking for |
|---|---|---|
| S1 | With `sandbox: true` + `nodeIntegrationInSubFrames: true` in Electron 44, does the preload run in CSP-sandboxed opaque-origin `erfana-preview:` sub-frames (incl. gitignored framed pages)? Does `window === window.top` gate correctly? Does the `MutationObserver` strip land before the first inline, `defer` and module scripts, and before custom-element `connectedCallback`? Can a page `MutationObserver` with `attributeOldValue` read stripped tokens? Is the request-kind ledger reliable on Electron 44 for first load, reload, history navigation and frames, and what happens when a concurrent `fetch(location.href)` races the document load? | P3, P4 |
| S2 | Does `wc.reload()` keep `#hash`; how much of the 1 s budget do watcher-triggered reload + restore use; is the 300 ms fallback needed in practice? | P5 |
| S3 | Does `scrollIntoView` inside an opaque-origin frame scroll the parent? If not, a parent-preload reveal step is needed. Does the frame's own scroll restore work? | P5 |
| S4 | `screen.getCursorScreenPoint()` vs renderer CSS pixels with host zoom – Windows (single 200% monitor here; mixed-DPI moves to the macOS/second-monitor handoff), Linux X11 and Wayland | P5 |
| S5 | Constructable stylesheets / `adoptedStyleSheets` in a closed shadow root under the preview CSP | P4 |
| S6 | Fresh still capture with the selected outline painted, through the existing still-frame cache, before the popup mounts – within the "hide synchronously" rule and the 150 ms budget | P5 |
| S7 | (was U1) Do page frameworks break when a comment node and, for line-start targets, an extra whitespace text node appear before an element (childNodes indexes, hydration, `white-space: pre*` set by CSS)? Run on the corpus plus a React/Vue/Svelte-built static page; decide the hybrid placement rule finally. | P1 |
| S8 | Frame ↔ owner `<iframe>` mapping without `webFrame`/`postMessage` (`window.frames` order vs `WebFrameMain.frames`); which preload receives pointer events over a frame | P4 |
| S9 | Main-thread cost of the shared parse + instrumentation at 0.5 / 1 / 4 MB and on a 10-frame page; worker needed? | P3 |
| U2 | `readable-mismatch` as damaged vs tolerated – revisit after X-001. | P8 |
| U3 | 10-minute draft TTL vs long write-ups – on expiry the window keeps the text and offers "Pick again". | P6 |
| U4 | Screen readers announcing a live region in the page document (NVDA, VoiceOver, Orca). | P7 / handoff |
| U5 | Cmd+Option+M vs macOS "Minimize All". | handoff |

## 16. Handoff to macOS

**Automated (from the repo root)**
1. `npm run lint && npm run lint:css && npm run design -- --check && npm run typecheck && npm run test:cov && npx electron-vite build`
2. `npm run test:e2e -- e2e/html-preview-comments.e2e.ts e2e/html-preview-comments.frames.e2e.ts e2e/html-preview-comments.safety.e2e.ts`, then again with `--repeat-each=3`
3. `npm run test:e2e:no-build -- e2e/html-preview-comments.perf.e2e.ts` (record F-001 P95)
4. Full `npm run test:e2e` (no regressions in other preview specs)
5. `npm run test:e2e:linux -- e2e/html-preview-comments*.e2e.ts` (Docker)

**Manual on macOS**
- Two-finger trackpad click and Ctrl+click both open the menu; Option+↑/↓ moves the outline without typing; Cmd+Enter saves; Cmd+Option+M toggles (and is not "Minimize All").
- Retina: pin at the element's top-right, outline aligned.
- VoiceOver reads the window, the drawer and "Comment saved".
- LF file from a git checkout, a file in a folder with an accented (NFD) name, a project reached through a symlinked folder.
- Real `git merge` with a conflict inside a block → damaged; after resolving in source → normal.
- With the window open, edit the file from the terminal, then Save.
- JS deck: slide and scroll restored; hidden-slide comment shows "Not visible now".
- `git diff` after add/edit/delete on a line-start target shows only block lines (a mid-line target also shows its own line, by design).
- Spikes S1, S4 (incl. a second monitor at a different scale) and S6 re-confirmed on macOS; F-001 gated here (P95 < 1 s).

**Manual on Linux** (Docker/xvfb for automated; a real desktop when available)
- Ctrl+Alt+M on GNOME and KDE (may be taken by the desktop – the toolbar toggle must still work).
- Right-click and pointer position on X11 and Wayland (spike S4).
- Orca reads the window, the drawer and "Comment saved".
- `Index.html` vs `index.html` in one folder stay separate.

**HPC-X-001 agent readability (decision 27, before the v1 lock)**
Copy each `agent-review/` file into a temp git repo; run `claude -p "apply the review comments"` and `codex exec "apply the review comments"`, three runs each. Score: every open comment acted on at its target; resolved and damaged comments not acted on; no edits inside other blocks; no file corrupted; no misreading of `@data` or escapes. Any misreading → adjust the format, re-run G-001–G-003. Record in `docs/spikes/`.

**HPC-X-002** owner sign-off on own files (decision 23).

## 17. Definition of done (Windows side)

1. Every phase P0–P8 exit criterion met.
2. The full local check chain (§13) green, plus `npm run test:e2e` for all `html-preview-comments*` specs and the existing preview specs on Windows.
3. Every locked decision traceable to at least one passing test (traceability below), except process decisions 18, 25, 29.
4. `docs/security.md`, the format spec, the ADR and the design-system cards updated.
5. X-001 run at P1 and confirmed at P8; format locked.
6. Branch pushed only when the owner asks; macOS handoff checklist ready.

## 18. Operations, rollback and scope risk

- **Feature flag**: `htmlPreview.comments.enabled` (Settings, default on). Off restores today's preview exactly – session policy, raw serving, no comment UI (E-023, SEC-22).
- **Rollback**: rolling back the app is safe – blocks are inert HTML comments. The format must be read forever (decision 22); a later version that drops comments must still leave v1 blocks untouched.
- **Migration**: none. The settings section is lenient; files without blocks are unaffected.
- **Logging**: instrumentation time, "unavailable" reasons, rate-limit drops and write refusals go through `src/shared/dropReporter.ts` and the main logger as codes and path digests only (no author, email, text).
- **Electron upgrades**: the sub-frame preload, the `commentState` receive and the token-strip timing join the upgrade checklist (R17).
- **Size**: about 40 files and ~330 tests across three L phases, a security-posture change and seven design cards – several weeks of work (estimate). Decisions 15 (frames) and 25 (one release) stand. If the work must be cut, cut in this order without touching the format lock (P1 and P2 stay whole, the full schema is golden-tested): (1) same-project frames – removes the policy flip, `frameFileMap`, S3, S8; (2) polish – drawer virtualisation, pin collision stepping, mode-tab pointer avoidance; (3) the Settings section (inline "Change" remains); (4) the Tab picker (keeps Alt+↑/↓ and Enter; costs accessibility). Any cut is the owner's decision.

### Changes in revision 2

| From review | Change |
|---|---|
| Correctness B1 | Picker keys handled in the preload; main forwards only the toggle (§3, §4.2, §7.1, M-052, SEC-29) |
| Correctness B2 / risk B2 | Instrumentation gated on the ledger, security independent of it, visible "unavailable" (§3, §4.2, §6, S24, M-060, SEC-26) |
| Correctness B3 / risk M6 | Contract test scans both preload files; preload coverage floors (§4.2, §9.2, §12.5) |
| Coverage critical 1 / correctness M1 | Limits measured after serialisation, 2 MB block cap, refuse before write (§3, §5.8, U-020/021, P-007) |
| Coverage critical 2 / correctness M2 | §5.4 escape codes restored |
| Risk B1 | X-001 at P1 exit, S7 placement/framework spike in P0, hybrid placement (§3, §5.2, §13, §15) |
| Correctness M3–M6 | `resolveConfined` returns `realPath`; 4 MB vs 25 MB; main-minted keys for edits; project-space path in the dirty guard |
| Risk M1–M5, M7–M10 | Parse budget + F-002; per-load token tables; feature flag; frame mapping spike S8 and mode-only state; per-phase e2e exit tests; reload coordinator; strict writer extracted from `atomicWrite.ts`; conflict-state guard; existing channels fail closed |
| Risk minor | Façade split into four modules; PDF export hides pins; navigation during a draft; re-attach budget; F-001 gated on macOS/Linux; upgrade checklist |
| Coverage high/medium | Left-click tests (J-012, R-018, E-001b); privacy notice for everyone (R-019); in-file snapshot rule (§5.6, M-054); Linux spikes, risks and checklist; full-hunk conflict rule (U-076); drawer mapping of block kinds; error-path tests (M-056/057, R-022/023); case-variant rule (M-009, M-063); pins toggle per tab |
| Owner (decision 35) | Gitignored framed pages commentable; S12 rewritten; risk 17 amended |

## 19. Revision 3 – P0 spike results (authoritative)

Evidence: [docs/spikes/html-preview-comments.md](../../spikes/html-preview-comments.md). Each item overrides the cited sections.

| # | Change | Overrides | Tests added / changed |
|---|---|---|---|
| R3-1 | **Request-kind ledger fix** (S1e). The ledger drops a note when its request fails (`webRequest.onErrorOccurred`) and matches a note only to a request of the same class: document / sub-frame loads arrive **without** a `user-agent` header, fetches and subresources always carry one, and a page cannot remove it. Instrumentation needs both a document-class note and a header-less request. Also fixes today's badge misfires. Add "document loads carry no `user-agent`" to the Electron upgrade checklist (R17). | §3 raw vs instrumented, §4.2 protocol handler, §6, S24, §9.2 | M-065 ledger stress (page fetching its own URL during 30 reloads → 30/30 correct); M-066 failed request drops its note; existing ledger tests stay green |
| R3-2 | **Token rule** (S1c, S1d): a token is valid on its **first sighting before the preload's own `DOMContentLoaded` listener**; a token seen twice in one load is void. The preload cannot tell parser from script nodes. Known residuals: an already-defined custom element's callbacks and a page `MutationObserver` with `attributeOldValue` can read tokens – harmless, because tokens are not authoritative (main re-validates from disk at Save). | §4.2 preload row, §6, SEC-26 | SEC-26 reworded; SEC-30 duplicated token in one load → void |
| R3-3 | **Non-commentable frames** (S1a): `about:blank` and `javascript:` frames get no preload, so a mode-only state cannot reach them. In comment mode the **parent** draws a transparent click-shield over every non-commentable `<iframe>` (refused, `srcdoc`, `about:blank`, `javascript:`); a click there selects the `<iframe>` element itself (§10.2). `srcdoc` and refused-frame error pages do get the preload; they still use the shield (not commentable inside). | §4.2 broadcaster, §7.1 step 2, J-015 | J-015 → shield swallows clicks; E-006 extended with an `about:blank` frame |
| R3-4 | **Frame mapping** (S8): main sends the parent its child frames as opaque keys in `WebFrameMain.frames` order; the parent matches each to `window[i]`, then to its `<iframe>` by `contentWindow` identity, and asks again when counts differ. Never use frame `name`. Pointer events over a frame reach only the child preload. | §6 Frames, §8 `commentState` (adds `childFrames: key[]`) | J-017 mapping with a script-added and a reordered iframe |
| R3-5 | **Menu point** (S4): use the trusted event's `screenX/screenY`, sent with the pick, converted with the window content origin and host zoom – not `screen.getCursorScreenPoint()` (≤ 0.5 px for real input, 129–210 px off for synthetic input). E2e helpers pass `globalX/globalY` to `sendInputEvent`. | §7.3 step 4, §8 `commentPick` (adds `screen: {x, y}`), §12.4, R14 | M-067 point math at zoom 1.0/1.25 and inside frames |
| R3-6 | **Fresh still** (S6): wait **two** animation frames after painting the selected outline, capture, check the outline's pixels and retry once if missing. P5 adds a dedicated "fresh capture" path – the existing cache skips a capture while one runs and the right-click marks the frame stale (read from code, not run). Measured p95 50–69 ms, inside the 150 ms budget. | §3 stale still, §7.3 step 4, S6 | E-011 asserts the outline is in the still; F-003 unchanged |
| R3-7 | **Overlay styling** (S5): style only through constructable stylesheets and `el.style` (never `setAttribute('style')` or a `<style>` element, which a page CSP can block). Re-show the top-layer host on its `toggle` close event, within the re-attach budget; the preload's window-capture guards keep the host's `beforetoggle` and `toggle` from the page, so a page listener cannot cancel the show (a show that still did not take is retried on the same budget). Documented limit: a page `<dialog>` or popover shown later sits above the overlay in the top layer, and a page modal makes pins unclickable until it closes. Visibility = `checkVisibility({opacityProperty, visibilityProperty})` **plus** a non-zero-size check (a 0×0 element passes `checkVisibility`). | §10.2 isolation, §6 status, SEC-21/28 | SEC-31 page `hidePopover()` → overlay back; J-006 adds 0×0 case |
| R3-8 | **Placement final rule** (S7): own-lines placement only when all hold – the start tag is the first non-whitespace on its line; no `pre`/`textarea`/`listing`/`plaintext` ancestor; the pick reports the parent's computed `white-space-collapse` as `collapse`. Otherwise, or when the value is missing (e.g. edit/delete without a pick), mid-line placement. Rendering changes: 12/67 → 0/67. The pick carries `ws: string`. | §3 placement row, §5.2, §8 `commentPick` | U-042 extended; U-043 `ws` ≠ `collapse` → mid-line; E-019 extended to CSS `white-space: pre` and SVG text |
| R3-9 | **Git claim corrected** (S7): own-lines keeps the target line out of `git diff`, but a concurrent edit to the target line or the line above still conflicts with the block (62/62 with a real `git merge`). The gain is only for edits to the line below. | §3 placement row, §16 | E-024 wording |
| R3-10 | **Position re-attach uses source order** (S7): "next non-whitespace sibling" fails for auto-closed or implied structures (7/9: first `<tr>`, unclosed `<p>`/`<li>`). Position = the next start tag in the **source text** after the block (skipping other erfana blocks and whitespace). | §5.9 step 1 | U-080 extended with table, unclosed `<p>`, `<li>` cases |
| R3-11 | **Framework pages** (S7, orchestrator call while the owner was away – listed for owner review): when the page carries Vue, Svelte or Angular hydration markers (Vue `data-v-ssr`/`<!--[-->`, Svelte `<!--[-->`/`data-svelte-h`, Angular `ngh`/`ng-version`), the block is placed **before the app's root container** and the clicked element is stored as a `runtime` path inside it – the same mechanism as §5.6, so the format does not change. React skips unknown comments; normal placement applies. Page scripts that walk `childNodes` can still see blocks anywhere – documented user limitation (§14 html-preview README). | §5.6, §6 | U-044 marker detection per framework; E-025 Vue-style hydrated fixture keeps the pin on the clicked element |
| R3-12 | **Parse in a worker** (S9): main-thread parse is 92 ms at 1 MB and 382 ms at 4 MB (budget 50/200). One persistent `worker_threads` worker (pattern `src/main/services/GitStatusWorkerAdapter.ts`), warmed when the first HTML preview opens, does the shared parse, instrumentation, block parse, and the Save / list re-parses. The §5.8 budget becomes **main-thread time** ≤ 10 ms at 1 MB and ≤ 30 ms at 4 MB (measured 7–28 ms); token tables cross as plain arrays. | §4.2 (new `services/preview/comments/commentParseWorker.ts` + adapter), §5.8, F-002 | M-068 worker crash → restart once, then "comments unavailable" (now poison and back-off: §19 "Worker deaths"); F-002 measures main-thread time |
| R3-13 | **Token cap** (S9): 100,000 tokens per document (the 4 MB test file had 64,187 elements). Over the cap: the file is served raw and comments are unavailable with the reason "page too large". | §5.8, §4.2 token table | M-069 over-cap → raw + reason |
| R3-14 | Small corrections: `process.isMainFrame` **is** available (either check works; keep `window === window.top`); `scrollIntoView` in a frame already scrolls the parent – no reveal step (§7.10, S3 closed); the `#hash` anchor jump may show for one frame before the scroll restore (§7.5); `frameFileMap` ignores non-`erfana-preview:` URLs – a refused frame reports the refused address and emits no `did-frame-navigate`. | §4.2, §7.5, §7.10, §15 | – |

### Rev 3 notes – P5 service and IPC, after the security review

Each note amends the cited sections; the rows above stand where a note does not say otherwise.

| Note | Change | Amends | Tests |
|---|---|---|---|
| R3-12 jobs | **Every comment file job runs in the worker.** Besides instrumentation, the worker runs four jobs on bytes main read: `draft` (a pick's anchor, placement and excerpt), `pin-blocks` (the damaged and newer blocks on a pin's element; now `pin`, §19 "Pin job"), `list` (one file's threads, damaged and newer blocks) and `write` (plan, splice and the verifying re-parse of a save). Main reads with the confined no-follow read, builds the new file from **its own** bytes and the worker's splice (a splice outside them is refused), and writes; it never parses. A list reads at most **64 files**, one at a time. The worker's document cache is keyed by the **content hash** (8 MB, 16 documents), not `(realPath, file hash)`: the worker never sees a path. | §4.2, §7.5, §7.6, R3-12 | `commentFileJobs.test.ts`, `commentFileJobs.perf.test.ts` |
| R3-12 gate | **Main-thread time per call**: a list and a pick ≤ 10 ms at 1 MB and ≤ 30 ms at 4 MB; a save ≤ 30 ms at **both** sizes – its main share is file-system work that does not shrink with the file (two confinements, the lock, the read, a temp file, fsync, a byte compare, a rename). Gated on the **fastest of seven runs**, not the median (F-002 keeps its median): busy time counts every moment the thread waits for a core, so contention only adds to it – the whole suite under coverage tripled the list's median – while a regression (parsing on main costs 92 ms at 1 MB) raises every run. Measured on the emulated x64 Windows box, fastest run inside the full coverage suite: list 3.3 / 6.3 ms, pick 2.3 / 4.0 ms, save 7.8 / 9.4 ms (1 / 4 MB). A list of eight framed 3.9 MB files must stall the event loop ≤ 60 ms (28–39 ms measured; 1,570 ms before). | §5.8, F-002 | `commentFileJobs.perf.test.ts` |
| Save pending (L3) | A save past its 15 s limit answers `COMMENT_SAVE_PENDING`; a late landing reloads the view and re-sends the counts. | §7.5, §8, §10.10 | `commentSaveFlow.test.ts`, `PreviewCommentService.test.ts` |
| Limits (L5) | On top of the per-frame limits, per view: 64 hellos and 128 anchor reports a second. The key store never evicts a draft whose save is in flight, keeps at most 64 drafts, and keeps keys by list generation – 8,192 soft (older generations go first), 65,536 hard. | §8, §9.1 S3/S7 | `commentPickHandler.test.ts`, `commentKeyStore.test.ts` |
| Identity (L6) | One rule in `src/shared/htmlComments/identity.ts` for the writer and the settings (§7.9 note). | §7.9, S18 | `global-settings-schema.test.ts`, `GlobalSettingsService.test.ts`, `CommentWriter.test.ts` |
| Share paths (L2) | Reported dirty paths: fully qualified, inside the project, no device prefix; UNC only on the project's own share (§7.8 note). | §7.8 | `commentUnsavedSources.test.ts` |
| SEC-20 wider | The log scan covers every line of every log file and every spelling of the project path (§12.2 note). | §12.2 | `html-preview-comments-service.e2e.ts` |
| SEC-09 | Proven in real Chromium (§12.2 note). | §12.2 | `html-preview-comments-service.e2e.ts` |
| Window data | `ThreadView.quote` for "It was attached to:"; the icon event's draft for "New comment" (§7.7, §8 notes). | §7.7, §8, §10.4 | `preview-comment-schema.test.ts`, `commentListBuilder.test.ts`, `commentDraftOpener.test.ts`, `PreviewCommentService.test.ts` |
| Overlay | Pin text centred at `y="9.5"`, hover, damaged-selected and forced-colour rules (§10.5 note); theme carries the hairline, spaces and line height (§10.9). | §10.5, §10.9 | `overlayStyles.test.ts`, `pins.test.ts`, `state.test.ts` |
| Carried to P8 | Nine existing non-comment log lines name the project folder by its absolute path – the git polling and git watcher start lines, the directory watcher's start, ready and "Directory changed" lines, and the renderer's project switch, git-status (two) and "Opened new panel" lines. SEC-20 allow-lists them by text; P8 decides whether they become digests. Not changed in P5. | §9.1 S21, P8 | – |

### Rev 3 notes – P7 bug round

Found by the P7 end-to-end specs; each note amends the cited sections.

| Note | Cause and change | Amends | Tests |
|---|---|---|---|
| E-022 Find | Find in page counted the overlay's words: Chromium searches closed shadow roots. Every overlay word is now CSS generated content (`data-text` + `::before`), the pin's number included, and the page's polite and assertive live regions are gone. The keyboard picker's sentences travel as a `step` pick (at most 10 a second from a frame, 12 a second per view in main, dropped when the mode is off) and `commentModeChanged` reason `picker` (`say`: `showing` / `top` / `no-child`); the renderer words them. The page's label is gone from both: §19 "Picker words". | §8, §10.2, §10.5, §10.8 | `overlayView.test.ts`, `overlayStyles.test.ts`, `pins.test.ts`, `picks.test.ts`, `picker.test.ts`, `commentPickHandler.test.ts`, `commentPickerStep.test.ts`, `PreviewCommentService.test.ts`, `preview-comment-schema.test.ts`, `usePreviewComments.test.tsx`; E-022 |
| E-011 still | The load's `ready` step (the post-load pipeline, asynchronous and rate-limited) for the comment-mode reload could run after the reader's right-click: it threw away the fresh still, and the capture that replaced it landed after the menu had hidden the view, where nothing showed it. The still-frame cache now orders capture starts and load marks: `ready` drops only what was captured before the load finished, and a capture that lands after a hide is shown. | R3-6, §3 stale still | `PreviewStillFrameCache.fresh.test.ts`, `previewLivePipeline.test.ts`, `previewStillFrameFreshness.test.ts`; E-011 |
| E-005 not visible | A list read while a pin's element was hidden kept "Not visible now" after the page reported it visible again: the drawer combined the list's per-thread flag with the anchor status, and nothing re-read the list. The list reads every flag after its last file, and each anchor status rewrites the stored list's flags – the newest report wins. | decision 30, §10.6 | `commentListBuilder.test.ts`, `usePreviewComments.test.tsx`; E-005 |
| SEC-20 list | Between a reload's commit and the new document's hello a frame has no file, so a list read then was empty ("thread not listed"). The list falls back to the frame-to-file map, which knows the file from the commit. | §7.6 | `commentPanelStatus.test.ts`; SEC-20 |
| F-003 | Not reproduced. On the emulated x64 Windows box, with the machine idle and again under a 10-core CPU load, right-click → menu P95 was 39–46 ms on both the pre-fix build and this one (instrumented main path, pick → draft sent: 25–60 ms; the 200-pin hover in comment mode: frame-gap P95 9.0 ms, as with the mode off). The 772–956 ms and 185 ms gap records were not explained by main's draft path. The SEC-06 limit (5 picks a second per frame) drops a sixth right-click within one second; a timing loop must pace itself to it. | F-003 | – |

### Rev 4 – owner raised the comment file limit to 25 MB

Owner decision (2026-10-26): comments work fully – pins, add, reply, edit, delete and the list – on every HTML file the preview serves, up to 25 MB (`PREVIEW.MAX_ASSET_BYTES`), instead of 4 MB. This amends decision 35 and §5.8; each note overrides the cited sections. Figures are from the emulated x64 Windows box, the slowest machine measured; the perf suites record them per OS.

| Note | Change | Amends | Tests |
|---|---|---|---|
| One limit | `PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES` (25 MB) replaces every 4 MB cap in the comment pipeline: the protocol handler's gate, the confined read, the writer (a write that would grow the file past it is refused, `COMMENT_LIMIT`) and the strict write's re-read. It equals `PREVIEW.MAX_ASSET_BYTES` (pinned by `format.test.ts`), so every page the preview serves can take comments; a file that grew past it after its load is read-only with the reason "file too large". `PREVIEW.MAX_ENTRY_HTML_BYTES` (4 MB) bounds only the preview's link discovery and has nothing to do with comments. | decision 35, §4.2, §5.8, §10.10 | 25 MB exactly → commentable, one byte more → "file too large": `commentFileAccess.test.ts`, `commentParseCore.test.ts`, `parse.test.ts`, `commentInstrumentation.test.ts`, `commentListBuilder.test.ts`, `atomicWriteBytesStrict.test.ts` |
| Element cap | 640,000 tokens per document (R3-13 had 100,000): the densest real pages measured, generated API docs at about 51 bytes per element, hold about 518,000 elements at 25 MB. The elements are counted as start tags (`<` and an ASCII letter) in the bytes **before any parse** (`hasMoreStartTagsThan`), in the protocol handler's job and in every file job, so a page past the cap is refused in 50–185 ms without a tree being built – a page of 1.5 million elements used to crash the worker at its heap ceiling. The count is an upper bound (a `<p` inside a script counts too), so it never lets a page through that the token table would refuse. Over the cap: served raw, "page too large"; the file is read-only with the sentence naming both limits (§10.10). *Security review S-M:* the start-tag count bounds a well-formed page, not a hostile one. The tree builder makes elements of its own – each new paragraph re-opens every formatting element left open (17 KB built 2 million elements), and a stray `</p>` in a body builds a `<p>` – and rescans its open-element stack for every tag (100,000 unclosed `<div>` took minutes, 20,000 unclosed distinct `<b a=N>` 11 s). So every parse also counts elements as they are **created** (cap: the token cap plus 65,536, `PARSE_ELEMENT_SLACK`) and its tree-adapter calls (1 million plus 16 per character; real pages measured about 1 a character, a page nested 512 deep 12). And since the tokenizer checks each attribute against the tag's earlier ones (40,000 on one tag took 6.5 s), a byte scan before the parse refuses a tag with more than 1,024 attributes (`COMMENT_MAX_ATTRIBUTES_PER_TAG`), or tags whose checks add up past 1 million plus 4 per byte. Past any of these: "page too large", as over the cap, each refused in under a second (`parseBounds.ts`). | §5.8, R3-13 | `htmlIndex.test.ts`, `commentParseCore.test.ts`, `parse.test.ts`, `parseBounds.test.ts` |
| Worker | Heap ceiling 2,048 MB (`WORKER_HEAP_MB`): a dense 25 MB page of 456,000 elements runs every job with 1,280 MB and crashes with 1,024; 650,000 elements need 1,536 MB. Bytes of 64 KB or more are **lent** to the worker as a transferable, not copied, and come back with the answer (`raw`); bytes lost to a timeout or a crash are read from disk again by the protocol handler. A request's answer limit is 10 s plus 1 s per megabyte queued, its own included (35 s for a lone 25 MB file). The document cache (8 MB) does not hold a 25 MB page, so every pick, pin and list on one parses it again. A spread of an element's children in `frameworkMarkers.ts` overflowed the stack on an element with 325,000 children; it is now a loop. | §4.2, R3-12 | `CommentParseWorkerAdapter.test.ts`, `commentParseWorker.test.ts`, `PreviewProtocolHandler.comments.test.ts`, `frameworkMarkers.test.ts` |
| List budget | A list reads at most 64 files (as before) and 64 MB in all (`PREVIEW_LIMITS.COMMENT_LIST_MAX_BYTES`): 64 MB of dense pages is about 14 s of worker time, while 64 files of 25 MB would take minutes. The page's own file always fits. Files left out by either limit are counted in the result's `unread`, and the drawer says so (§10.10). | §7, §8, §10.10 | `commentListBuilder.test.ts`, `PreviewCommentService.test.ts`, `preview-comment-schema.test.ts`, `usePreviewCommentStore.test.ts`, `CommentDrawer.test.tsx` |
| Save time | A 25 MB save took 8.7–9.7 s, all but 60–90 ms of it in the worker (the plan's parse and the verifying re-parse): inside the 15 s answer limit. A save queued behind a page load or a list can pass that limit; it then answers `COMMENT_SAVE_PENDING` as designed – the write keeps its per-file lock, which has no timeout of its own, and lands later (§8 Rev 3 note). | §7.5, §8 | `commentFileJobs.perf.test.ts` |
| Main-thread gates | Fastest of seven runs, the R3-12 gate rule; each budget is at least twice the fastest run measured inside the full coverage suite. Fastest run alone / inside that suite: a load 8.5 / 10.4 ms (≤ 30 ms), a list 6.8 / 18.4 ms (≤ 45 ms), a pick 11.7 / 14.1 ms (≤ 30 ms), a save 23.7 / 29.6 ms (≤ 60 ms) – a save's main share grows with the file: the spliced file is assembled, written and compared byte for byte. A parse back on main takes seconds at 25 MB and fails every one. Worker time, recorded and not gated (alone): a load 4.9 s median (4.8 s cold), a list 4.2 s, a pick 4.3 s, a save 9.2 s; inside the coverage suite a save took about 21 s. | §5.8, R3-12 gate, F-002 | `commentParse.perf.test.ts`, `commentFileJobs.perf.test.ts`, F-002 e2e record (a ~25 MB page) |
| Kept | The quote-read budget stays at 40 million characters: on the dense 25 MB page the largest one-tag table is 10.3 million (all tags together 61 million); a position match spends one element's quote read on it to corroborate the anchor (the next subsection), and only a block that position, `id` and path all failed to place spends a table's worth. The token table holds twice the cap (1.28 million tokens), so a page at the cap keeps its tokens while its frames load. | §5.9, §4.2 token table | `ElementTokenTable.test.ts` |

### Rev 4 – position match must be corroborated (owner, X-001 finding)

Owner decision (2026-10-26, "fix now"): the X-001 confirmation ([spike doc](../../spikes/html-preview-comments.md), "X-001 confirmation") found that removing a commented element handed its open comment to the next element with the same tag – §5.9 step 1 checked the tag only – so a second agent pass could act on the wrong element. Resolution only: the v1 format is unchanged (G-001–G-004 and `v1.lock.json` byte-identical).

| Note | Change | Amends | Tests |
|---|---|---|---|
| Corroborated position | Step 1 counts only when the element after the block also agrees with the anchor: the same `id`; or, with no `id` on either side, the quote matches (exact text, or the text before and after it) or the path is the same. An anchor that stores no `id`, path or quote needs the tag only. Step 1 never counts an element with another `id`, or one whose text begins the stored `suffix`: that element followed the removed target and slid into its place – and into its `:nth-of-type` path, which is why the path alone cannot tell the two apart (the X-001 grinder card had no `id` and the same path as the card after it). A rejected match runs steps 2–4; the block is orphaned when none gives exactly one element. Decision table in `anchorEvidence.ts`. | §5.9 steps 1, 3, 4; `format-v1.md` rule 1 | U-089 (`anchorEvidence.test.ts`), the reference scan in `anchorLookup.test.ts`; E-012 second case |
| Backups | Step 3 refuses an element with another `id` or one that slid in; step 4 one with another `id`. A block never attaches to an element whose `id` differs from the stored one. | §5.9 | P-008 |
| Edits that keep a comment | Text edited in place (same `id`; or same path; or the same text around it), attribute changes (dropping the `id` included), a moved element found again by `id`, path or quote. | – | U-089 |
| Budget | Step 1 reads the element's quote – and its context when the text differs – on the shared 40-million-character quote budget. Once that is spent, the path decides. | §5.9 work budget | U-089 |
| Known limits | Still taken by the wrong element: a same-tag sibling sliding into the place of a removed element that had no `id` and no text (an `<img>`); a slid-in sibling whose own text was edited in the same pass; the second of two adjacent elements with the same text; a new same-tag element inserted between a block and its target (it takes the target's path). | – | – |

### Rev 4 – code review and security review fixes

Findings of the 2026-10-26 code review (H1, M1–M4, L1–L6) and security review (S-M, S-L-A, S-L-B, S-L-C). Each note overrides the cited sections.

| Note | Change | Amends | Tests |
|---|---|---|---|
| Save pending settles | (H1, L1) A save answered `COMMENT_SAVE_PENDING` is reported again when it ends: `preview:commentSaveSettled` (`panelId`, `op`, the request's own key, `ok`, `code` when refused), sent only for a save that outlasted its answer. Until then the renderer (`commentPendingWrites.ts`) keeps the write outstanding: Save and Reply on that draft, element and thread stay off and the window says "Still saving" – also a window opened again on it; the editor's autosave hold for the file stays, released on the settle, not at the answer; a write that lands clears its session draft, with the window closed too. A refused settle shows its banner with Save back and the text kept. A settle that never comes ends the wait after 2 minutes (`PENDING_WRITE_MAX_MS`); main's re-hash before its rename still refuses a stale overwrite. The panel says how a settled write ended (`useCommentSettleNotices`). | §7.7, §8 Rev 3 note, §10.10 | `commentPendingWrites.test.ts`, `CommentWindow.test.tsx`, `CommentWindow.threads.test.tsx`, `useCommentSettleNotices.test.ts`, `PreviewCommentService.test.ts`, `commentEmit.test.ts`, `preview-comment-schema.test.ts` |
| Draft event fields | (M1, L3) `commentDraftOpened` carries `draftToken`, `draftKey` and `target` – all three or none – and nothing else about the draft. No refusal `code`: the menu's only refusal is "Can't comment here". No `unsavedSource`: the window's dirty guard follows the editor tab live and main refuses the write anyway (`COMMENT_UNSAVED_SOURCE`), so a flag frozen at pick time could only be stale. `draftKey` is the element key the window keeps typed text under (§10.4 "Draft restored"): a SHA-256 of the real path and the element's place in the file (its CSS path, or its offset when the path was too long to store, plus the JS-built element below it), cut to 32 hex characters. Never a path; two elements never share one; the same element picked again gets the same one while its place holds. | §7.3, §7.4, §7.7, §8, §10.4 | `commentDraftOpener.test.ts`, `PreviewCommentService.test.ts`, `preview-comment-schema.test.ts`, `CommentWindow.test.tsx`, `usePreviewComments.test.tsx` |
| List generation | (M2) Each list request takes a generation and only the answer to the newest is stored. A thread window remembers the generation it opened with (`listAfter`) and closes itself only on a newer list that no longer has its threads: the list shown at a pin click can predate the pin's own thread, so an empty selection in it means "not read yet", not "deleted". | §7.6, §10.4 | `usePreviewCommentStore.test.ts`, `CommentWindow.threads.test.tsx` |
| One shortcut rule | (M3) Main (`previewInputForward.ts`) and the panel (`usePreviewComments`) both ask `matchCommentModeKey` (`src/shared/commentModeKey.ts`): the typed key `m` with exactly Ctrl+Alt, or Cmd+Option on macOS, where the physical KeyM stands in only when Option made the typed key something other than printable ASCII. The two cannot disagree about which press toggles the mode. | §3, §7.1, §10.1 | `commentModeKey.test.ts` |
| Pin job | (M4) A pin click runs one worker job, `pin`: it finds the blocks on the pin's element and builds the draft for its **New comment** from the same parse. It replaces `pin-blocks` plus a separate draft job, so a page the document cache cannot hold (over 8 MB) is parsed once per pin click, not twice. | R3-12, §7.7 | `commentFileJobs.test.ts`, `commentDraftOpener.test.ts` |
| Meta charset on edits | (L2) A reply, a resolve or an edit grows a block in place, so it can push a `<meta charset>` out of the browser's 1,024-byte prescan as an insert can. The splice refuses it too (`meta-charset`), unless the change does not grow the file. | §5.6 | `splice.test.ts` |
| Unsaved sources sent | (L4) The renderer counts its unsaved-sources list as sent only when main accepted it. A refused or failed send is tried again up to 3 times, 1 s apart; a newer list replaces it, and nothing is sent after the panel unmounts. | §7.7 | `useUnsavedSourcesFeed.test.ts` |
| No `whenSaveSettled` | (L5) Not built: `editorSaveRegistry.whenSaveSettled(id)` stays internal to the registry, and a comment save does not wait on it. It is not needed, because an editor save in flight keeps its tab dirty until its write has landed (`MarkdownEditorPanel` clears the dirty flag only after the awaited write). Meanwhile the window's guard keeps Save off and main refuses the write (`COMMENT_UNSAVED_SOURCE`); the autosave hold taken for the comment write keeps a new autosave from starting. The one save the dirty flag does not show, Cmd+S on a clean tab, writes the bytes already on disk; it is sent before the comment save and lands first in practice, but no lock orders the two – the same exposure as any outside write (§9 residuals). | §4 file table, §7.7 | – |
| G-005 | (L6) Tested in the renderer: each of the 10 golden blocks stays hidden in the Markdown preview on its own lines, and 9 of 10 mid-line. The tenth (`03-crlf-tab`) holds a blank line; mid-line in a Markdown paragraph, that blank line ends the paragraph (CommonMark), so the comment's start and end land in different blocks and its text shows. Erfana writes blocks only into HTML files, own-lines where the rules allow; a block pasted mid-line into Markdown is the known limit. | §12 G-005 | `MarkdownPreview.comments.test.tsx`, `htmlComments.golden.test.ts` |
| Worker deaths | (S-M) Before any work the worker tells main the SHA-256 of a request's bytes (`begin`). When it dies on a request – a crash, out of memory, or main's time limit – that content is **poisoned**: later requests carry the list (at most 64 hashes, oldest dropped) and the worker answers `poisoned` for it without parsing (served raw, "comments unavailable"; a job answers `parse-failed`). One hostile file costs one worker, and every other file keeps its comments. The next request after a death starts a new worker after a back-off – 1 s, doubling per death in the last 10 minutes, at most 30 s; requests meanwhile answer `busy` – and a fifth death in 10 minutes leaves comments unavailable for the session. Replaces R3-12's "restart once". | R3-12, M-068 | `CommentParseWorkerAdapter.test.ts`, `commentParseWorker.test.ts` |
| Picker words | (S-L-A) A picker announcement uses only what main parsed. The `step` pick names the element by token (plus `added` for a JS-built element under it), never by a label; main looks the token up and sends `commentModeChanged` with `element: { tag, line, added? }` – the tag name and source line from its own parse. The renderer says "Showing {tag}, line {line}." or "Showing an element added by a script, inside {tag} on line {line}." A page can no longer put its own words in Erfana's live region. | §8, §10.8, §10.10, E-022 | `commentPickHandler.test.ts`, `commentPickerStep.test.ts`, `PreviewCommentService.test.ts`, `preview-comment-schema.test.ts`, `picks.test.ts`, `commentLive.test.ts`, `usePreviewComments.test.tsx`; E-022 |
| File names drawn safely | (S-L-B) A file name comes from the project, so anyone who can name a file writes it. Every place the comments UI shows one – the drawer's file heading, the window's banners, read error and frame note, the delete confirmation – draws bidi controls and invisible characters as visible tokens (`VisibleText`, `visibleString`), as for comment text. | §10.4, §10.6 | `CommentDrawer.test.tsx`, `CommentWindow.test.tsx`, `CommentWindow.threads.test.tsx` |
| Main checks the splice | (S-L-C) The worker parses hostile pages, so main checks its write answer itself: the bytes to insert must be nothing (a delete) or strict UTF-8 holding exactly one comment with no `--` inside, that does not start with `>` or `->` and does not end with `-`, followed at most by a line break and indentation (`isSafeInsert`). Anything else is refused (`verify-failed`) before the write. | §7.5, §9 | `commentWriteCore.test.ts`, `CommentWriter.test.ts` |

### Rev 4 – tab switch with the drawer open (owner bug)

Owner report (2026-10-27): with the drawer open on one preview tab, switching to another left that tab frozen – a still picture that took no input. Each note overrides the cited sections.

| Note | Change | Amends | Tests |
|---|---|---|---|
| The sheet is a panel gate | The full-width drawer hid the page with the window's `overlay` occluder, which hides **every** preview. dockview keeps every opened tab mounted, so a drawer left open in a hidden tab kept the tab on screen hidden behind its still frame. The sheet now raises its own panel's gate (`covered`, `stores/usePreviewCoveredStore.ts`, written by `comments/useDrawerSheet.ts`); the overlay guard applies it to that panel only (reason `covered`, after the chrome gate and `collapsed`), and the panel counts it as hidden (still frame, no keyboard way into the page). The flag stays set while its tab is hidden, so coming back hides the page before the guard would show it – no flash of the page over the sheet. | §10.6, §4.2 | `usePreviewComments.test.tsx`, `OverlayGuardService.test.ts`, `usePreviewCoveredStore.test.ts`, `HtmlPreviewPanel.pageEntry.test.tsx`; E-026 |
| A hidden tab is not narrow | dockview hides an inactive tab with `display: none`, so its root measures 0×0, which read as "under 640 px": a side drawer turned into a sheet the moment its tab was hidden, which is what raised the occluder even in a wide window. A 0×0 measure is now skipped and the last real width stands. | §10.6 | `usePreviewComments.test.tsx`; E-026 |

### Rev 4 – owner test: folded sections

Owner decision (2026-10-27, "Fix: reopen and reveal"): on a real page the owner opened a closed `<details>` ("Technical details"), commented a `<p>` inside it and saved. The save's reload folded the section again, so the comment showed "Not visible now" with no pin, and the drawer's **Open** did not unfold it. Only `<details>` is handled: an element hidden any other way (`display: none`, `hidden`, an inactive slide) keeps "Not visible now". Each note overrides the cited sections.

| Note | Change | Amends | Tests |
|---|---|---|---|
| Kept open | The world-996 read before a write also records the top frame's open `<details>`, each by its **place** among the page's `<details>` in document order: the first 65,536 are looked at (`PREVIEW_LIMITS.COMMENT_SECTIONS_SCANNED_MAX`), by index – a live collection's `length` would count the whole document inside the read's 400 ms – and at most 256 are kept (`COMMENT_OPEN_SECTIONS_MAX`). A comment block is a comment node, so a save moves no place. The top frame's first hello after the write's reload commits the same page gets them back, once, as `commentState.openSections`; its preload opens them, outer before inner, before it scrolls, draws or reports, so the load's first anchors report already counts the pin visible. A place the page builds later is retried each animation frame within the 1 s restore budget; any user input stops that. | §7.5 steps 3, 6; §8 `commentState` (adds `openSections?: number[]`, ≤ 256) | `commentScripts.test.ts`, `commentReloadCoordinator.test.ts`, `PreviewCommentService.test.ts`, `state.test.ts`, `contract.test.ts`, `foldedSections.test.ts`; E-027 |
| Scope | The scroll restore's: every comment write (add, reply, edit, resolve, delete) and comment mode's reload of a page served raw – also a write whose reload serves the page raw (its last comment deleted with the mode off): a state that is not commentable carries `openSections` too, and nothing else new. Never a navigation or an ordinary file-change reload: one hand-out per write, so a later reload of the page reopens nothing – unlike the scroll restore, which an armed write applies again at a later commit of the same page (unchanged here). A frame's own sections are not kept, as its scroll is best effort; a frame write reloads the whole view, so the top frame's are. Reopen only: a section open in the file that the reader had folded comes back open, as before. | §7.5 | `commentReloadCoordinator.test.ts` |
| Reveal unfolds | A reveal opens every closed `<details>` around the element, outermost first, before `scrollIntoView` – not one whose first `<summary>` holds it, which shows while folded. The render after it reports the element visible, so "Not visible now" goes and the pin draws. A drawer row's **Open** now reveals its thread's element too (attached threads only), behind the window, so closing the window shows it; unlike "Show on page" it keeps the drawer and announces nothing. | §7.10, §10.6 | `foldedSections.test.ts`, `usePreviewComments.test.tsx`; E-027 |
| Accordions | Opening a section of an exclusive accordion (`<details name>`) closes its open sibling, as a summary click would, so a reveal can fold the section the reader had open beside it. Accepted. | – | – |
| Trust | The places are numbers from main's own read in an isolated world; main and the preload both parse them, and any bad entry drops the list (the scroll stays). Only main's state starts a restore or a reveal, on the one receive channel; nothing the page sends or dispatches does. The page sees a section open (its `toggle` fires), as it would see the reader open it. | §9.1 S4, S7 | `commentScripts.test.ts`, `state.test.ts`, `foldedSections.test.ts` |

### Rev 4 – owner test: comment window focus and save key

Owner report (2026-10-27, Windows): after a pick the new-comment window opened without the keyboard in its field, and Cmd/Ctrl+Enter did not save – "the same as in other cases", meaning the Markdown preview's Ask / Modify / Prompt dialogs (`PromptDialog`: focus on mount, Enter with Ctrl **or** Meta submits). Each note overrides the cited sections.

| Note | Change | Amends | Tests |
|---|---|---|---|
| Root cause | The field already took DOM focus (`BaseDialog`'s `initialFocusRef`, 10 ms after open) and already saved on Cmd/Ctrl+Enter. But every pick is a click or key INSIDE the page, a separate `WebContentsView` that then holds native keyboard focus, and a DOM `focus()` in the host cannot take that back (Electron #18859, the issue #124 finding in `previewHostFocus.ts`). So the reader's keys – the text and the save chord – kept going to the page behind the still frame. The Markdown prompts never meet this: Markdown preview is host DOM. E-016 passed regardless, because Playwright's `page.keyboard` types into the host renderer whatever holds native focus. | §10.4 Focus | – |
| Host focus before the draft | Main hands native focus to the owning window's own contents **before** it sends `preview:commentDraftOpened` – every kind (`open`, `menu`, `icon`): each opens Erfana's menu or window over the page – so the renderer's DOM focus lands in a contents that holds the keyboard (`commentEmit.ts` → `PreviewEmitTarget.focusHost` → `focusHostWhileKey`). No new channel and nothing trusted from the renderer: the draft event is main's own. Only while the window is the OS key window: a draft is built from disk (up to 25 MB) and `webContents.focus()` also raises the window, so a reader who switched apps meanwhile is not pulled back – the DOM focus is still set for their return. The first comment's identity step gets the same host focus and keeps "focus in Name". Close still hands focus back into the page (unchanged). | §10.4 Focus, §8 `commentDraftOpened` (side effect, payload unchanged) | `previewHostFocus.test.ts`, `commentEmit.test.ts`, `buildPreviewGraph.emitTargets.test.ts`; E-016c |
| The save key | Unchanged keys, now pinned per platform: Enter with Ctrl or Meta saves the new comment, a reply and an edit on every OS (as `PromptDialog`), and the tooltip and `aria-keyshortcuts` name the platform's own – "Save (Cmd+Enter)" / `Meta+Enter` on macOS, "Save (Ctrl+Enter)" / `Control+Enter` elsewhere (§10.10). The chord with Save blocked (empty, too long, unsaved source tab) sends nothing, as Save does; while a save is pending a second chord sends nothing. New: a held key's auto-repeat and an Enter that confirms an IME composition are not presses. | §10.4, R-003 | `CommentWindow.keys.test.tsx` |

### Rev 4 – owner test: open in source and button sizes

Owner report (2026-10-27, Windows; `designs/decisions/decisions.html`, the window "Comment on span.label", line 172): after **Open in source** the comment window stayed open, floating over the Monaco editor; and the window mixed two button sizes – small outlined Resolve and Open in source beside large bold Reply, New comment and Close. Each note overrides the cited sections.

| Note | Change | Amends | Tests |
|---|---|---|---|
| Open in source closes the window | The window closes first, then the editor opens at the line (the drawer's own Open in source is unchanged – the drawer stays). Same order and reason as "Go to tab": a dialog left open would sit over the editor, and its focus trap would pull the keyboard back out of it. Focus is not handed back to the page – the editor takes it. Nothing is asked and nothing is lost: closing a window always keeps typed text (§10.4), and reply and edit text already live in the session drafts (`replyDraftKey`, `editDraftKey`), so the reply is there when the pin is clicked again. `useCommentDirtyGuard` is not involved – it guards a save against an unsaved *source* tab, not the window's own text. | §10.4 | `usePreviewComments.test.tsx`, `CommentWindow.threads.test.tsx`; E-028 |
| The window belongs to its tab | The design was silent. The window is a `BaseDialog` – portalled to the app window, `position: fixed` – and dockview keeps a hidden tab mounted, so the window of a tab the reader switched away from floated over the tab now shown, and its `dialog` occluder (global) froze every other preview on its still frame: the E-026 class of bug, for the window instead of the drawer. Now `usePreviewComments` takes the panel's dockview visibility (`visible`) and withholds the window from the layer while its tab is hidden: the request is **kept**, so the window comes back with its tab, text restored from the session drafts; an open inner step (an edit, a delete confirmation) does not survive the round trip, its text does. The element menu of a hidden tab is dropped (it pointed at a page no longer on screen), quietly – no native focus to a page that is not shown. | §10.4, §10.3 | `usePreviewComments.test.tsx`; E-028 |
| One button size | Every text button in the window is the Dialog.css button (`.dialog-btn` + variant: `--space-5` / `--space-12` padding, `--text-md`, `--font-semibold`) – the Dialog framework's mandatory button, as in `PromptDialog` (Ask / Modify / Prompt). Resolve, Re-open, Open in source, Copy raw text, Delete block…, Try again, and the banner actions Go to tab, Save {file} and Pick again move from the compact `.erf-comment-action` (24 px, `--text-sm`, regular) to the secondary variant. `.erf-comment-action` stays for the drawer, which is panel chrome sized with the toolbar. The 24 px icon buttons (close, a message's …, a resolved thread's chevron) are unchanged, as in every dialog. | §10.4, §10.11 Buttons; window card | `CommentWindow.threads.test.tsx`; E-028 |
| One primary per view | Save (new comment), Continue (identity), Save changes (an edit) and the danger button of a delete confirmation, as before. Reply is primary only while the view holds exactly one open thread; with several, every Reply is secondary – a row of violet buttons ranks nothing. Accepted: while an edit is open in a single-thread view, its Save changes and the thread's Reply are both primary; the edit is an inner step that holds focus. | §10.4 | `CommentWindow.threads.test.tsx` |
| The foot wraps as a pair | At the larger size a thread view's foot (Open in source, New comment, Close) can pass the 360 px window. New comment and Close are one group (`.erf-comment-window__foot-end`), so a narrow window wraps the pair whole, right-aligned, under Open in source, rather than stranding Close alone. | §10.4 | `CommentWindow.threads.test.tsx` |

### Rev 4 – owner test: pins at the right edge

Owner report (2026-10-27, Windows): the drawer open as a side panel, so the page view was narrower; a comment on `div.doc`, an element spanning the page's full width. Its pin showed only as a thin sliver of blue beside the page's vertical scrollbar – read as "the comment icon is hidden behind the comments panel on the right". Each note overrides the cited sections.

| Note | Change | Amends | Tests |
|---|---|---|---|
| Root cause | The drawer never covered the pin; the page's own scrollbar did. The overlay clamped pins to the frame's `innerWidth` / `innerHeight`, which **count** a classic scrollbar. A full-width element's top-right corner sits on the scrollbar's left edge, so its pin – tail tip 4 px outside that corner, box clamped to at most `innerWidth − 24` – ran under the scrollbar: with a 15–17 px scrollbar, 7–9 px of the 24 px box showed. | §10.5 | – |
| The visible viewport | Every overlay measure uses the frame's **visible** viewport (`viewportOf`): the scrolling root's `clientWidth` / `clientHeight` – the root element in standards mode, the body in quirks mode (CSSOM View) – never past the inner size, and the inner size when the root reports 0 (no root, no layout box). Overlay scrollbars (macOS) take no room, so nothing changes there. Not `visualViewport`: `getBoundingClientRect` and `position: fixed` both work in the layout viewport. Each frame's preload measures its own window, so a frame's pins clamp to that frame's own viewport. | §10.5, §10.2 | `label.test.ts` (`viewportOf`) |
| 4 px inside | A pin clamped to an edge keeps its box `PIN_EDGE_INSET_PX` inside the visible viewport on every side: 4 px, the tip's own offset (`--space-2`), clear of the edge and of comment mode's 2 px frame along it. A pin that fits stays where it was – the inset applies only where the clamp does. Collision stepping runs after the clamp, so two full-width elements in one row step apart as any two pins do, and stepping stops at the left inset. | §10.5 | `pins.test.ts`, `controller.test.ts` |
| Vertically | Same rule, new bounds. §10.5 already clamps to "the visible part of the element and the viewport", so an element scrolled partly off keeps its pin at the viewport's top – now 4 px down – and one fully off has none. The bottom bound leaves out a horizontal scrollbar; an element showing only behind it has no pin. | §10.5 | `pins.test.ts` |
| Outline, label, shields, flash | The same visible viewport: a huge element's outline is clipped at the scrollbar's edge, so its right ring shows; the label is clamped sideways inside it (§10.2); click shields and the reveal flash stop there too. The mode frame and tab were already inside – `position: fixed; inset: 0` leaves scrollbars out. | §10.2 | `controller.test.ts` |
| Not changed | A pick's `view` (`w`, `h`) stays `innerWidth` / `innerHeight`: it records the reader's window, not where the overlay draws. | §8 | – |
| E2e oracle | `pinBoxOf` (`e2e/pages/html-preview.comments-ui.ts`) places a pin by this rule from the page's own visible size, read as `viewportOf` reads it; `pinPoint`, `clickPin` and `pinCoverage` use it. The capture's scale stays `innerWidth`-based, since the capture holds the scrollbar too. | §12.4 | E-029 |

### Rev 4 – case-only path differences on macOS

Owner decision (2026-10-27, "fix now"), on a bug the CI fixes turned up: a comment on a page whose path names the project folder in another letter case was refused as "excluded" on macOS, though on the default case-insensitive APFS volume it is the same folder. It failed closed – nothing was ever written outside the project – but it refused a legitimate save. Each note overrides the cited sections.

| Note | Change | Amends | Tests |
|---|---|---|---|
| Root cause | §7.6 step 1's lexical "inside the project?" check (`commentFileAccess.ts`, rule 1) ignores letter case on Windows and macOS, but the part of the path below the root, which the exclusion rules read, came from the host's `path.relative`, which compares exactly on macOS and Linux. `/Users/a/proj/page.html` under the root `/Users/a/Proj` passed the first and came back from the second as `../proj/page.html`, whose `..` segment was refused as excluded. The same held for two Unicode spellings of an accented folder name, which the macOS check also treats as one. Windows was not affected: its `path.relative` ignores case too. | §7.6 step 1 | – |
| One rule for both | The part below the root is cut at the root's own end under the same case rule (`pathBelowRoot`, `src/main/utils/pathCompare.ts`). The end is found by comparing the folded root with the path's folded prefixes at its separators, not by length, because folding can change a length. It exists only where `isInsideRoot` holds. The exclusion, dot-segment and 8.3 rules then read the real part below the root. | §7.6 step 1 | `pathCompare.test.ts`, `commentFileAccess.caseVariant.test.ts` (a case-insensitive disk simulated, Windows and macOS rules on every host) |
| The disk decides | Unchanged: the lexical check only rejects early. `realpath` and the exact compare of the two real paths (`realPathWithin`) decide. On macOS `realpath` returns each folder's on-disk name (Apple's `realpath(3)` asks `getattrlist` for it), so a case variant of the project folder is accepted and written under its on-disk spelling – M-009's rule for a case variant of a file, now for the folder too. A spelling that folds to the root but resolves anywhere else is outside the project. The U+212A KELVIN SIGN sibling (`proj` + U+212A beside the root `projk`) passes the folded lexical check under Windows and macOS rules and is refused by the realpath step on every host where both folders can exist. | M-009, §7.6 step 1 | `CommentWriter.confinement.test.ts` (real disk; the host-rules row runs only on a case-insensitive disk), `commentFileAccess.containment.test.ts` |
| Checked, unchanged | No other comment step pairs a case-folding check with the host's `path.relative`. `confinePath` and `resolveConfined` compare two real paths (the registry's root is one), `commentUnsavedSources` checks containment and then resolves, never cutting a relative part, and `CommentWriter` confines through `commentFileAccess`. | – | – |

**Open after P0, carried to the handoff**: S4 on Linux (X11/Wayland) and macOS, mixed-DPI; S1/S6 re-confirmed on macOS. Owner review list: R3-11.

### Traceability (decision → tests)

| # | Tests |
|---|---|
| 1 | X-001, G-001 |
| 2 | U-002, U-018, M-018, R-004, E-002 |
| 3 | R-008, R-014, R-019, M-017, E-001, E-021, SEC-18 |
| 4 | R-001, R-002, J-001, E-011, E-028 |
| 5 | U-085, M-040–042, J-007, E-005 |
| 6 | U-032–042, P-004, SEC-13, E-001, E-024 |
| 7 | R-008 |
| 8 | R-009, R-020, E-002, E-005, E-010, E-012, E-013, E-026, E-027 |
| 9 | R-011 |
| 10 | U-016, U-017 |
| 11 | U-005–009, P-001, P-002, SEC-12 |
| 12 | U-010–015, U-059, U-070–076, R-005, M-020, E-010, SEC-17 |
| 13 | M-011, R-007, E-008 |
| 14 | R-001, R-011, E-020 |
| 15 | M-009, M-010, M-050, M-059, E-006, SEC-09 |
| 16–17 | U-085, U-086, J-007, M-054, SEC-12 |
| 19 | J-002–004, J-010, J-012, R-018, E-001, E-001b, E-007, E-016, E-016c, M-052 |
| 20 | J-005, J-013, R-010, E-002, E-014, E-029 |
| 21 | M-014, U-084 |
| 22 | U-004, U-016, U-060, G-002–004 |
| 23 | X-002 |
| 24 | U-050–061, U-020/021, P-003, P-005, P-007, E-001, E-003, E-004, E-024, SEC-14 |
| 26 | Assumption (like 18/25/29); G-002 keeps reading only Erfana-shaped blocks |
| 27 | X-001 (P1 and P8) |
| 28 | F-001 (slide-deck), M-040, M-058, J-016, E-005, E-027 |
| 30 | U-087, J-006, E-005 |
| 31 | M-018, R-004 |
| 32 | U-070–074, E-010 |
| 33 | J-014 |
| 34 | U-019, U-020, J-007 |
| 35 | M-055, E-006 |
| 5 (rev 3) | U-044, E-025 (framework pages), M-068 |

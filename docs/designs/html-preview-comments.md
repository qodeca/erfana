# Design – HTML Preview comments (v1)

> Status: planned (2026-10-25). Implementation plan for comments on elements in the HTML Preview.
> Branch: `feature/html-preview-comments` (off `develop`). No GitHub issue yet.
> Inputs: owner interview (grill-me, depth full, 35 locked decisions), an online survey of 20+ commenting tools, and four specialist designs (architecture, UX, security, test strategy). Conflicts between those designs are resolved in §3.
> Revision 2 (2026-10-25): folds in three plan reviews – correctness against the code, coverage of the decisions, and risk/sequencing. Their blockers are fixed in place; §18 lists what changed.
> Revision 3 (2026-10-26): folds in the P0 spike results ([docs/spikes/html-preview-comments.md](../spikes/html-preview-comments.md)). **§19 is authoritative where it conflicts with earlier sections.**

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
| 14 | Out of v1: Markdown Preview comments; area / text-selection comments; live sync; agent replies/status; "Send to agent"; menu items other than "Add comment". |
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
| 35 | Commenting follows the preview's own serving rules: any page the preview shows is commentable, gitignored pages shown inside frames included. Never-served paths (`node_modules`, `dist`, `out`, `coverage`, `.git`, dot-folders) are not. Read-only with a visible reason: non-UTF-8 files, symlinks/hard links, `srcdoc` frames, a file with an unresolved conflict hunk, files over 4 MB. Drawer filters Open / Resolved / Needs attention. |

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
| `services/preview/PreviewProtocolHandler.ts` (changed) | After `resolveConfined` (`:330`), only when the feature flag is on, the ledger note is exactly a document/sub-frame load, the extension is `.html`/`.htm`, the file is ≤ 4 MB, and comment mode is on or the bytes contain `erfana:comment`: decode losslessly → **one shared parse** → `instrumentHtml` + `parseCommentBlocks` + block → token resolution from the **bytes actually served** → serve instrumented bytes. Otherwise serve raw bytes, with a recorded "unavailable" reason when comments were expected. If the source already contains `data-erfana-el`, serve raw. |
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
| `…/comments/CommentDrawer.tsx` + `.css` | Side drawer, flow sibling of `.html-preview-page-area` (no occluder) |
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
| Tokens per document | 50,000 |
| File size | 4 MB (`PREVIEW.MAX_ENTRY_HTML_BYTES`, `constants.ts:512`). Served HTML can be larger (`MAX_ASSET_BYTES`, 25 MB, `:505`); such files are served raw and are read-only for comments with the reason "file too large" |
| Parse budget per load (shared parse, main thread) | ≤ 50 ms at 1 MB, ≤ 200 ms at 4 MB on the reference machines (F-002); otherwise move the parse to a worker |

### 5.9 Re-attach order (cheapest first)

1. **Position** – the next non-whitespace sibling element, skipping other erfana blocks, has the stored tag.
2. Unique `id` + tag.
3. Unique CSS path.
4. Unique text-quote match (exact, then prefix/suffix; whitespace collapsed, NFC).
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
- The renderer fetches thread content through `preview:commentList`. Text and emails never enter the page.
- Ops: `reply | editMessage | deleteMessage | setStatus | deleteThread`. Deleting the first message deletes the thread. Anyone may do anything (decision 31). Each op is a §7.6 replace or delete.

### 7.8 Unsaved editor guard (decision 13)
Before enabling Save: `findEditorTabsShowing(api, projectPath)` with the **project-space** path main returned; if any id is in `dirtyPanelIds`, show the "Save your edits first" banner with **Go to tab** and **Save {file}** (`editorSaveRegistry.save`). If the tab is in the "changed on disk" conflict state, the banner offers **Go to tab** only (no Save – saving would overwrite the outside edit), following `previewTabMove.ts:205-206`. During the write: `editorSaveRegistry.holdAutosave(id)` + `editorSaveRegistry.whenSaveSettled(id)` (new public method), released afterwards; the clean editor reloads via `useFileWatcher` with no conflict banner. Limitation: a tab in another window is not seen; the disk re-hash still prevents a stale overwrite. The same guard applies to a frame's own file.

### 7.9 Identity
`GlobalSettingsSchema.comments = { authorName?, authorEmail?, identityNoticeSeen }`, lenient `.catch` (pattern `global-settings-schema.ts:80-84`). App-level `~/.erfana/settings.json` only – never project `.erfana/` (a cloned repo must not preset identity). The identity step shows on the first comment whenever `identityNoticeSeen` is false – also when the name was already set in Settings (then the fields are pre-filled and the notice is the point). Prompt copy in §10.7. No migration is needed: the new section is lenient and absent in older settings files.

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
- PDF export: the overlay is hidden while printing, so pins never land in the PDF. Find in page: overlay text lives in a closed shadow root and is excluded from find counts (test R-021 / E-022).
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

Only open threads are counted. Clicking opens the window in any mode; the click never reaches the page. Overlapping pins move left along the top edge in 22 px steps (the ancestor keeps the corner). Drawn only for elements passing `checkVisibility({opacityProperty, visibilityProperty})` and in the viewport. Scales with page zoom. Never animated. `role="button"`, `tabindex="-1"`.

### 10.6 Comment drawer

Flow sibling at the inline end of `.html-preview-page-area` (never absolute), 320 px (min 280), opens instantly. Under a 640 px panel it takes the full width and "Show on page" closes it first. Filter "Show": **Open (n) · Resolved (n) · Needs attention (n)** (radio group). File order; "Not visible now" is an inline tag.

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
- Always-mounted polite live region in the shadow root ("button, Buy now, 2 comments."); mode and save results also go to `.erf-band__announce`; an assertive region for errors. Verify with NVDA, VoiceOver and Orca.
- The drawer is the guaranteed keyboard route to every thread.
- Reduced motion: no transitions; flash = static highlight for 1.5 s; instant scrolling; nothing loops.

### 10.9 Tokens

| Tier | Names |
|---|---|
| New component tokens (`design-tokens.css`) | `--comments-window-width` 360px, `--comments-window-max-width` 480px, `--comments-drawer-width` 320px |
| Resolved into the page (`commentState.theme`) | `accent` ← `--color-accent-primary`, `accentHover` ← `--color-brand-violet-hover`, `ink` ← `--color-brand-black`, `paper` ← `--color-brand-white`, `muted` ← `--color-text-primary`, `warning` ← `--color-warning`, `font` ← `--font-mono`, `size` ← `--text-sm`, `ring` ← `--border-width-thick`, `pinTarget` ← `--btn-height-sm`. A unit test checks the mapping against `design-tokens.css` (lint cannot see CSS inside a TS string). |
| Chrome | Existing `--space-*`, `--text-*`, `--color-bg-elevated`, `--color-border-subtle`, `--shadow-dialog`, `--color-text-tertiary` |

Contrast numbers quoted in design-system cards go into `docs/design-system/claims.json`, never typed.

### 10.10 Microcopy

| Where | String |
|---|---|
| Toggle tooltip | "Comment mode (Ctrl+Alt+M) – off" / "Comment mode (Ctrl+Alt+M) – on: click an element to comment, Esc to leave" (macOS: Cmd+Option+M); not ready: "Comment mode – available once the page has loaded" |
| List button | "Comments, {n} open" · "Comments, {n} open, {k} need attention" · "Comments, none yet" |
| Pins tooltip | "Show comment icons – on" / "Show comment icons – off: icons hidden on this page" |
| Mode tab | "Comment mode – Esc to leave" |
| Announce | "Comment mode on. Click an element, or press Tab to pick one. Esc to leave." · "Comment mode off." · "Top of page – no parent to select." · "No child elements." · "Showing {label}." |
| Menu | "Add comment" · disabled "Can't comment here" |
| Window titles | "New comment" · "Comment on {label}" · "Comments on {label}" · "Damaged comment" |
| Context line | "{label} · {file}, line {n}" · "Added by a script – saved before <{ancestor}>." · "Saved in {frame file}." |
| Field | label "Comment", placeholder "What should change here?", hint "Plain text. Saved inside {file}.", counter "{n} / 4000" |
| Identity line | "Commenting as {name}" · "Change" |
| Buttons | "Cancel" · "Save" (tooltip "Save (Ctrl+Enter)") · "Saving…" · "Reply" · "Resolve" · "Re-open" · "New comment" · "Edit" · "Delete…" · "Save changes" · "Close" · "Open" · "Show on page" · "Try again" |
| Meta | "{name} · {time}" · "· edited" · "Resolved by {name} · {time}" · "{n} replies" · "Draft restored" |
| Save errors | "Write a comment first." · "Comments can be up to 4,000 characters. This one is {n}." · "Couldn't save: {file} is read-only. Your text is still here." · "This element changed in the file since you picked it. Close and pick it again – your text will be restored." · "{file} no longer exists. Copy your text before closing." · "Couldn't save the comment. Your text is still here – try again." · "Erfana can only add comments to UTF-8 files." · "{file} has unresolved git conflicts. Resolve them first." · "{file} is a link to another file, so Erfana won't write to it." |
| Saved | "Comment saved to {file}." |
| Unsaved source | "Save your edits first" / "{file} has unsaved changes in another tab. Save them first so your edits and this comment don't overwrite each other." · "Go to tab" · "Save {file}" · "Saved. You can add your comment now." |
| Delete | "Delete this comment? It is removed from {file}. Git history keeps earlier versions." → "Delete comment" · "Delete this thread and its {n} replies?" → "Delete thread" |
| Damaged | "Erfana can't read this comment block, so it won't change it. Fix it in the source, or delete it." · "This block contains git conflict markers. Resolve the conflict in the source." · "Raw text (read-only)" · "Copy raw text" · "Open in source" · "Delete block…" · "Delete this damaged block? Erfana removes exactly the text shown above from {file}." → "Delete block" · "This block changed on disk. Reopen it and try again." |
| Not found / not visible | "Erfana can't find this element any more. The comment stays in {file}, line {n}." · "It was attached to:" · "This element isn't on screen right now – it may be on another slide or tab. Its icon comes back when it does." |
| Drawer | "Comments" · "Close comments" · "Show" · "Open {n}" · "Resolved {n}" · "Needs attention {n}" · "Show comment icons" · tags "Not visible now", "Element not found", "Damaged", "Resolved", "In frame: {file}" · "Reading comments…" · "No comments in this file yet. Turn on comment mode and click an element." · "No open comments." · "No resolved comments." · "Nothing needs attention." · "Couldn't read comments from {file}." |
| Pin | name "{n} comment(s) on {label}. Open." · damaged "Damaged comment on {label}. Open." · tooltip "{n} comments – click to open" |
| Identity | §10.7 · "Enter a name to continue." · "That doesn't look like an email address." |
| Settings | "Comments" · "Your name" – "Saved into HTML files next to each comment you write. Changing it affects new comments only." · "Your email (optional)" – "Also saved into the file. Leave empty to keep it out." · notice "Both are visible to anyone who can open the file – in the page source and in git history once pushed." · "Enter a name to add comments. Existing comments keep the name they were saved with." · feature flag "Comments in HTML preview" – "Lets you add comments to elements of a previewed page." |
| Unavailable | toolbar tooltip "Comments are unavailable for this page: {reason}" · reasons "file too large", "not a UTF-8 file", "file is a link", "inline frame (srcdoc)", "unresolved git conflict", "the page keeps removing Erfana's overlay", "couldn't prepare the page" |
| File gone / draft expired | "{file} no longer exists. Copy your text before closing." · "This comment window was open too long. Pick the element again – your text is kept." → "Pick again" |
| Write refused | "Erfana can't write to {file} on this drive." |

### 10.11 Design-system cards (change cards before code that departs from them)

| Card (status) | Change |
|---|---|
| New `product/html-comments/` (proposed) | The whole journey and every state of §10 on a fake page |
| Permission band (decided) | Three new tools after Find; re-measure `nav.css` tier thresholds |
| Focus (decided) | Exceptions: in-page ring uses passed-in colours; close returns native focus to the page; pins focusable but not in the Tab order |
| Menu (decided) | Exception: the opener is page content, so no `aria-haspopup` |
| Rows (decided) | Exception: the active row's Open button is a second Tab stop |
| Form (decided) | New textarea entry: multi-line, counter, Cmd/Ctrl+Enter |
| Colours, Layering, Motion, Icons, Buttons, Feedback (proposed) | In-page literals resolved from tokens; top-layer rung + dialog rung; one-shot flash; bubble pin + three lucide glyphs; inline destructive confirmation; banners inside the window |

Each code site that deviates carries `/* deviates: docs/design-system/<card> — why */` plus a row in that card's Exceptions section.

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
- M-060 instrumentation gates: flag off → raw bytes and `nodeIntegrationInSubFrames: false`; ledger note not a document load → raw; > 4 MB → raw with reason; no `erfana:comment` and mode off → raw.
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
- SEC-09 frame `pushState`s to another path → comment still targets its navigated file, or is refused.
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
- SEC-20 log scan after add/edit/delete with marker strings: no author, email, text or absolute path in `~/.erfana/logs`.
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
| E-012 | P1 | Outside edit removes the target → "Element not found"; block still in the file |
| E-013 | P2 | 200 comments: drawer, pins, Show on page |
| E-014 | P2 | Pins toggle |
| E-015 | P2 | Hostile page: no window opened, mtime unchanged |
| E-016 | P2 | Keyboard-only path: shortcut → Tab picker → Enter → type → Cmd/Ctrl+Enter |
| E-017 | P2 | Same file in two previews: comment appears in both after reload |
| E-018 | P2 | Focus in and out of the window and drawer |
| E-019 | P2 | Element rectangles and `innerText` equal before/after adding comments (pre/inline fixture) |
| E-020 | P3 | Markdown Preview has no comment entry |
| E-021 | P2 | Settings "Comments" section changes the author of new comments only |
| E-022 | P2 | PDF export of a commented page contains no pins; Find in page does not count overlay text |
| E-023 | P1 | Feature flag off → no comment UI, page served raw, frames run without preload (today's behaviour) |
| E-024 | P2 | `git diff` after add/edit/delete on a line-start target shows only added/removed block lines (target line unchanged) |
| F-001 | P1 | Save → pin visible on the `slide-deck/` fixture: 20 samples, P95 < 1,000 ms. **Gate on macOS and Linux**; on the emulated Windows box record only (`known-flakes.md:62-76`) |
| F-002 | P1 | Shared parse + instrumentation per load: 0.5 / 1 / 4 MB files and a 10-frame page within the §5.8 budget (recorded per OS) |
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

Evidence: [docs/spikes/html-preview-comments.md](../spikes/html-preview-comments.md). Each item overrides the cited sections.

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
| R3-12 | **Parse in a worker** (S9): main-thread parse is 92 ms at 1 MB and 382 ms at 4 MB (budget 50/200). One persistent `worker_threads` worker (pattern `src/main/services/GitStatusWorkerAdapter.ts`), warmed when the first HTML preview opens, does the shared parse, instrumentation, block parse, and the Save / list re-parses. The §5.8 budget becomes **main-thread time** ≤ 10 ms at 1 MB and ≤ 30 ms at 4 MB (measured 7–28 ms); token tables cross as plain arrays. | §4.2 (new `services/preview/comments/commentParseWorker.ts` + adapter), §5.8, F-002 | M-068 worker crash → restart once, then "comments unavailable"; F-002 measures main-thread time |
| R3-13 | **Token cap** (S9): 100,000 tokens per document (the 4 MB test file had 64,187 elements). Over the cap: the file is served raw and comments are unavailable with the reason "page too large". | §5.8, §4.2 token table | M-069 over-cap → raw + reason |
| R3-14 | Small corrections: `process.isMainFrame` **is** available (either check works; keep `window === window.top`); `scrollIntoView` in a frame already scrolls the parent – no reveal step (§7.10, S3 closed); the `#hash` anchor jump may show for one frame before the scroll restore (§7.5); `frameFileMap` ignores non-`erfana-preview:` URLs – a refused frame reports the refused address and emits no `did-frame-navigate`. | §4.2, §7.5, §7.10, §15 | – |

**Open after P0, carried to the handoff**: S4 on Linux (X11/Wayland) and macOS, mixed-DPI; S1/S6 re-confirmed on macOS. Owner review list: R3-11.

### Traceability (decision → tests)

| # | Tests |
|---|---|
| 1 | X-001, G-001 |
| 2 | U-002, U-018, M-018, R-004, E-002 |
| 3 | R-008, R-014, R-019, M-017, E-001, E-021, SEC-18 |
| 4 | R-001, R-002, J-001, E-011 |
| 5 | U-085, M-040–042, J-007, E-005 |
| 6 | U-032–042, P-004, SEC-13, E-001, E-024 |
| 7 | R-008 |
| 8 | R-009, R-020, E-002, E-005, E-010, E-012, E-013 |
| 9 | R-011 |
| 10 | U-016, U-017 |
| 11 | U-005–009, P-001, P-002, SEC-12 |
| 12 | U-010–015, U-059, U-070–076, R-005, M-020, E-010, SEC-17 |
| 13 | M-011, R-007, E-008 |
| 14 | R-001, R-011, E-020 |
| 15 | M-009, M-010, M-050, M-059, E-006, SEC-09 |
| 16–17 | U-085, U-086, J-007, M-054, SEC-12 |
| 19 | J-002–004, J-010, J-012, R-018, E-001, E-001b, E-007, E-016, M-052 |
| 20 | J-005, J-013, R-010, E-002, E-014 |
| 21 | M-014, U-084 |
| 22 | U-004, U-016, U-060, G-002–004 |
| 23 | X-002 |
| 24 | U-050–061, U-020/021, P-003, P-005, P-007, E-001, E-003, E-004, E-024, SEC-14 |
| 26 | Assumption (like 18/25/29); G-002 keeps reading only Erfana-shaped blocks |
| 27 | X-001 (P1 and P8) |
| 28 | F-001 (slide-deck), M-040, M-058, J-016, E-005 |
| 30 | U-087, J-006, E-005 |
| 31 | M-018, R-004 |
| 32 | U-070–074, E-010 |
| 33 | J-014 |
| 34 | U-019, U-020, J-007 |
| 35 | M-055, E-006 |
| 5 (rev 3) | U-044, E-025 (framework pages), M-068 |

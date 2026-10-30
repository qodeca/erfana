---
spec_id: 24
document_type: solution_adr
sequence: 1
---

# 001-shared-comment-base

**Date:** 2026-10 | **Status:** Accepted – Q1–Q4 decided by the owner 2026-10-29; amended by § 8

How spec 024 splits comments into one shared base plus preview parts (024-FR-001, 024-FR-002). Paths are relative to the repo root; "inferred" marks claims not read in code.

> **Amended 2026-10-29 by the expert panel.** § 8 lists the changes. Where § 8 and §§ 1–7 differ, § 8 wins.

## Context

All shipped comment code is HTML-specific. Three facts constrain the split:

- **The preload is sealed.** Overlay modules may import only `ipcRenderer` and their own `./x` siblings (`src/preload/previewPage.contract.test.ts:255-267`, ADR 0005 decision 6). No markup or `<style>` writes (`:169-176`). The build fails if two preload entries share a module (`electron.vite.config.ts:32-62`). React cannot run there.
- **The write core assumes HTML.** The writer reads `.html?` only (`commentFileAccess.ts:104-105`). Its pre-save check compares the element tag sequence (`splice.ts:381`). The agent note is a fixed HTML text (`format.ts:52-56`, written by `serializeBlock` at `:476-482`). Indents may be blanks only (`format.ts:83`).
- **The Markdown render pipeline lives in the renderer** (`MarkdownPreview.tsx:221-255`, `previewRehypePlugins.ts`). Main's render check needs that same pipeline.

## 1. Module map

**S** = shared base, **H** = HTML-specific, **M** = Markdown-specific.

### Format core (pure)

| Module | Now | Becomes | Mark | Reason, if not shared |
|---|---|---|---|---|
| `format`, `thread`, `identity`, `encoding`, `conflictMarkers` | `src/shared/htmlComments/` | `src/shared/comments/` | S | – |
| `quoteText`, `anchorEvidence`, `anchorLookup` | same | `src/shared/comments/`, typed on a new `TargetIndex` interface instead of `HtmlIndex` | S | – |
| `splice` | same | `src/shared/comments/splice.ts`; `planInsert`'s placement choice moves to the file kind | S | – |
| `parse` | same | split: the block classifier (header, damage reasons, readable compare) goes to `src/shared/comments/blocks.ts`; the parse5 comment walk goes to `htmlComments/htmlParse.ts` | S + H | Finding comment nodes depends on the HTML parser |
| `anchor` | same | split: `resolveBlockTarget` goes to `src/shared/comments/reattach.ts`; the parse5 anchor builder stays | S + H | CSS paths come from the parse5 tree |
| `htmlIndex`, `parseBounds`, `instrument`, `frameworkMarkers` | same | stay | H | parse5 tree, element tokens and framework roots exist only in HTML |
| `index` (barrel) | same | stays as the HTML barrel; `src/shared/comments/index.ts` is new | S + H | Two barrels: the shared one exports the base only, so importing it never pulls in parse5 |
| **New** `fileKind.ts`, `htmlKind.ts`, `selectionFind.ts` | – | `src/shared/comments/` | S (`htmlKind` is H) | `htmlKind` wraps the H modules above |
| **New** `markdownComments/{mdIndex,slots,renderCheck,mdAnchor,markdownKind}.ts` | – | `src/shared/markdownComments/` | M | Markdown has no tags or ids in the source, so placement and re-attach are new (design §5, §6) |
| **New** `src/shared/markdown/previewPipeline.ts` | inside `MarkdownPreview.tsx` | plugin list, sanitize schema, frontmatter split | M | One pipeline for the preview and main's render check |
| **Added since** `agentNotes`, `noteLines`, `anchorSel`, `selectionWords`, `spokenExcerpt`, `cutText`, `targetIndex`, `commentableExtensions` (8) | – | `src/shared/comments/` | S | – |
| **Added since** `markdownComments/{markdownLimits,mdCommentScan,mdHast,mdHints,mdLocate,mdRender,mdSlots,mdSource}.ts` (8) | – | `src/shared/markdownComments/` | M | Markdown's limits, comment tokenizer, rendered tree, target hint, locate, render check, slots and line coordinates: rules of the Markdown source, which has no tags or ids (design `markdown-format.md`; § 8 C3, C4, C7, C9, C11, C19) |

### Main process

| Modules | Becomes | Mark | Reason, if not shared |
|---|---|---|---|
| `CommentWriter`, `commentWriteCore`, `commentFileAccess`, `commentFileLock`, `commentRefusals`, `commentUnsavedSources`, `commentSaveFlow`, `commentKeyStore`, `commentListCore`, `commentListBuilder`, `commentFileJobs`, `commentJobDocs`, `CommentParseWorkerAdapter`, `commentParseWorker`, `commentParseProtocol` (15) | `src/main/services/comments/` | S | – |
| **New** `FileCommentService.ts`, `src/main/ipc/comments/file-comment-handlers.ts` | same folder | S | – |
| `PreviewCommentService`, `ElementTokenTable`, `frameFileMap`, `commentFrames`, `commentFrameBroadcaster`, `commentPickHandler`, `commentPickerStep`, `commentMenuPoint`, `commentPins`, `commentPanelStatus`, `commentServiceEvents`, `commentServiceTypes`, `commentParseCore`, `commentInstrumentation` (14) | stay in `src/main/services/preview/comments/` | H | They serve one native preview view: tokens, frames, served bytes and page messages |
| `commentStillCapture`, `commentReloadCoordinator`, `commentScripts`, `commentOverlayTheme` (4) | stay | H | Still images, reload and scroll restore exist only because the page runs in another process |
| `commentDraftCore`, `commentDraftBuilder`, `commentDraftOpener` (3) | stay | H | They turn a page token into a target ("find target"). Markdown sends line, tag and ordinal instead (§3) |
| `commentE2eHook` (1) | stays | H | It exposes served loads |
| **Added since** `commentInsertIndent`, `commentListChange`, `commentPathConfine`, `commentRebuild`, `fileCommentPanels`, `fileCommentWatches`, `kindCommentJobs` (7) | `src/main/services/comments/` | S | – |
| **Added since** `commentFileKinds`, `src/main/ipc/comments/file-comments.ts` (2) | `src/main/services/comments/`, `src/main/ipc/comments/` | S – composition roots | They name every registered kind; the base itself never imports a kind (§ 8 C24) |
| **Added since** `markdown/markdownCommentJobs` (1) | `src/main/services/comments/markdown/` | M | The Markdown kind's jobs in the parse worker (§ 8 C19, C22) |
| **Added since** `commentContextGate`, `commentDraftKeys`, `commentWordsCore`, `commentPickerSpeaker`, `htmlCommentJobs`, `htmlCommentParseClient` (6) | stay in `src/main/services/preview/comments/` | H | They check the page's right-click, draft words and picker steps against main's parse5 parse, and run the HTML kind's jobs in the parse worker – all about a page in another process |

### Overlay

| Modules | Mark | Reason |
|---|---|---|
| `src/preload/previewPageComments/*` (22 modules) | H | Runs inside the untrusted page in a closed shadow root (§2) |
| **New** `src/shared/comments/overlayCore/{pinLayout,gesture,modeState}.ts` | S | Pure rules both overlays run. No imports, no DOM |
| **New** `src/renderer/src/components/Comments/overlay/{CommentOverlayLayer.tsx,useCommentMode.ts,targetPicker.ts,commentHighlights.ts}` | S (for renderer-hosted previews) | – |
| **New** `src/renderer/src/components/Editor/markdownComments/markdownAdapter.ts` | M | Maps `data-line-start` blocks to targets |
| **Added since** `src/renderer/src/components/Comments/overlay/{useCommentOverlayHost,useHostPointerKeys,useSelectionComments,previewAdapter,pickerKeys,hostTypes,hostParts,hostMenu,hostWindow,hostDrawer,domWords,commentContentAttrs,contentGuard}.ts` (13) | S (for renderer-hosted previews) | – |
| **Added since** `src/renderer/src/components/Editor/markdownComments/{useMarkdownComments,MarkdownCommentsOverlay,MarkdownCommentsBand}.tsx` (3) | M | The Markdown Preview's composition root, the surfaces it draws in its pane, and its paused band (D-24: only the Markdown Preview draws the editor's unsaved text) |

### Renderer

| Modules | Becomes | Mark | Reason, if not shared |
|---|---|---|---|
| `CommentWindow`(+css), `ThreadsView`, `NewCommentView`, `CommentThread`, `CommentMessage`, `CommentParts`, `IdentityStep`, `CommentDrawer`(+css), `CommentToolbarTools`, `commentCopy`, `commentFormat`, `commentPlacement`, `commentRows`, `commentSchemas`, `commentWindowHeading`, `commentWindowTypes`, `commentPendingWrites`, `useCommentSettleNotices` (18) | `src/renderer/src/components/Comments/` | S | – |
| `usePreviewCommentStore`, `useCommentDirtyGuard`, `Settings/sections/CommentsSection` | stay where they are, made generic | S | – |
| `usePreviewComments`, `PreviewCommentsLayer`, `commentLive` | split: shared `useComments.ts` and `CommentsHost.tsx`; the HTML parts become `HtmlPreviewPanel/comments/htmlCommentSource.ts` | S + H | Page-driven drafts, still images and main-driven mode changes exist only in HTML |
| `useDrawerSheet` | stays | H | It hides the native view behind a full-width drawer (`usePreviewCoveredStore`) |
| `services/preview/commentGateway.ts` and **new** `services/comments/fileCommentGateway.ts` | both implement one `CommentSource` interface | H / S | HTML is addressed per view, through page draft tokens. Text previews are addressed per file |
| **Added since** `CommentWindowShell`, `CommentStepper`, `CommentWordsPicker`, `DamagedBlockView`, `ThreadStatus`, `CommentDrawerRow`, `CommentDrawerSort`, `CommentRemovedNote`, `commentRemovedOutside`, `commentCarriedDrafts`, `commentDockPlacement`, `commentCopyWords`, `commentWindowCopy`, `commentWindowStates`, `commentWords`, `useThreadSession` (16) | `src/renderer/src/components/Comments/` | S | – |
| **Added since** `previewCommentRequests`, `usePreviewDraftKeepAlive` (2) | stay in `HtmlPreviewPanel/comments/` | H | A page draft token and the window it opens, and its keep-alive, exist only because the HTML page picks in another process |
| **Added since** `usePreviewModeBlock` (1) | stays in `HtmlPreviewPanel/comments/` | H | M-07: main holds the HTML comment mode, so turning it off for a read-only page goes through main's mode request; the Markdown host keeps its mode in the renderer |

`commentCopy` keeps one string table with a `TargetNouns` map per preview (C-03), so both previews import one module (024-AC-008).

## 2. Overlay decision

| Option | For | Against |
|---|---|---|
| A. One overlay implementation loaded in both places | Can never drift | It would run Markdown and renderer code inside the untrusted page. That breaks the preload import contract (`contract.test.ts:255-267`) and the no-markup rule (`:169-176`), and React cannot run there. The needs also differ: closed shadow root and drawn boxes vs `CSS.highlights` (selection design `selection-comments.md:22`, `:130`), pins hidden from assistive tech vs real buttons (C-11), a label vs a mode tab (C-21), a modal vs a non-modal window (C-18) |
| B. One behaviour, hosted twice, nothing shared | Preload untouched | Pin steps, stack cap and click-vs-drag thresholds drift silently. That is the drift `previewPageComments/contract.test.ts` already guards for constants |
| **C. One behaviour, two hosts, a small shared pure core** | The numbers and rules that must match live in one place. The renderer host serves Markdown, `.txt` and later previews | The preload contract widens by one folder |

**Decision: C.**

- The HTML overlay stays in the preload. The renderer gets one generic overlay host, driven by a preview adapter (§3).
- `src/shared/comments/overlayCore/` holds pure functions only: pin layout (C-17 step and stack), gesture classification (≥ 4 px or a non-collapsed selection means select, otherwise pick), and the comment-mode state machine. It has no imports, no globals and no side effects.
- The preload may import exactly this folder. A new contract test fails if any file there gains an import or touches a DOM or Electron global.
- The build guard fails if another preload entry imports the folder. It is not the security control; the contract scan and the import check of § 8 C15 are.
- One behaviour suite, `src/shared/comments/__conformance__/overlay.suite.ts`, runs behind an `OverlayDriver` against:
  - the preload harness (`previewPageComments/__test-helpers__/harness.ts`)
  - the Markdown host
  - the `.txt` host

Against the priority order:

1. File safety: neutral – the overlay never writes.
2. Agents: neutral.
3. Same feel: one rule set plus one suite.
4. Later previews: the renderer host is reused.

**NFR-005:** no API, channel or listener is added to the page. The change is a code import, reviewed like ADR 0005.


## 3. The seam – preview adapter contract

A new text-file preview supplies **two adapters**: one for the main process (the file) and one for the renderer (the page). HTML is the one exception: it draws through the preload instead of a renderer adapter.

```ts
// src/shared/comments/fileKind.ts – pure; runs in the parse worker
export interface CommentFileKind {
  readonly id: CommentFileKindId                 // 'html' | 'markdown' | test 'txt'
  readonly extensions: readonly string[]         // '.md', '.markdown'
  readonly agentNote: readonly string[]          // C-02, one wording per file type
  parse(text: string, bomLength: number): KindDocument   // blocks + TargetIndex
  locate(doc: KindDocument, pick: PickedTarget): IndexedTarget | KindRefusal  // find target
  slots(doc: KindDocument, target: IndexedTarget): readonly Slot[]  // where a block may go, in try order
  anchorOf(doc: KindDocument, target: IndexedTarget, sel?: TextQuote): CommentAnchor
  hints(data: CommentData, target: IndexedTarget): readonly string[]  // C-01 note-area lines
  reattach(doc: KindDocument, anchor: CommentAnchor): TargetResolution  // uses shared reattach.ts
  originOf(doc: KindDocument): KindOrigin
  verify(origin: KindOrigin, newText: string, plan: SplicePlan): KindVerifyResult  // pre-save check
}
export interface PickedTarget { lineStart: number; lineEnd: number; tag: string; ordinal: number;
  quote?: TextQuote; id?: string; path?: string }
export interface Slot { offset: number; shape: 'before-target' | 'line-start'; indent: string }

// src/renderer/src/components/Comments/overlay/previewAdapter.ts
export interface PreviewCommentAdapter {
  readonly kind: CommentFileKindId
  readonly nouns: TargetNouns                               // C-03 words
  targetAt(node: Node): PreviewTarget | null                // find target (pointer, selection)
  targetsInOrder(): readonly PreviewTarget[]                // Tab order (C-08)
  parentOf(t: PreviewTarget): PreviewTarget | null
  childOf(t: PreviewTarget): PreviewTarget | null
  describe(t: PreviewTarget): PickedTarget                  // sent to main
  canComment(t: PreviewTarget): { ok: true } | { ok: false; reason: CommentRefusalReason } // frontmatter
  attach(place: ThreadPlacement): HTMLElement | null        // re-attach main's lines to the DOM
  textOf(el: HTMLElement): string                           // for selectionFind / Narrow to words
  contentRoot(): HTMLElement                                // export root; the overlay stays outside it
}
```

- Kinds are registered in `commentFileKinds.ts` at startup. The production list is frozen before the first IPC call.
- `commentFileAccess` takes its allowed extensions from the registry instead of `HTML_NAME`. Both confinement rules – the requested name and the real name – keep applying.

**`.txt` test preview (024-AC-002).** All files go under `src/shared/comments/__conformance__/txt/` and `src/renderer/src/components/Comments/__conformance__/txt/`:

- `txtKind`: one paragraph per blank-line run; a slot before the paragraph; the shared byte check is the only check.
- `txtAdapter`: renders `<p data-line-start>`.
- The tests register both, then run `fileKind.suite.ts` (add, reply, edit, resolve, reopen, delete, byte identity, refused save) and `overlay.suite.ts`.
- The commit touches no file outside those two folders and the composition roots. `scripts/check-seam-commit.mjs` checks this once on the pull request, and its output is attached (§ 8 C24).

## 4. IPC

**New, for renderer-hosted previews:** `src/shared/ipc/file-comment-channels.ts` and `file-comment-schema.ts`. The design's `md-comment:` name is not used, so later previews reuse the channels.

| Channel | Payload |
|---|---|
| `file-comment:list` | `{ panelId, filePath, bufferText? }` → `{ ok, file: CommentFileView, placements: ThreadPlacement[] }` |
| `file-comment:save` | `add`: `{ panelId, filePath, target: PickedTarget, sel?, text, view }`. Thread ops: the same branch as HTML (`fileKey`, `threadKey \| blockKey`, `rawHash`, `op`, …) → `{ ok, threadKey } \| { ok: false, code, reason }` |
| `file-comment:changed` (event) | `{ panelId, filePath, stamp }` |

- `bufferText` is used only to **show** comments while the buffer differs from disk (C-09). Writes always re-read the disk.
- `CommentFileView`, the thread-op schema and `CommentSaveResult` move to `src/shared/ipc/comment-common-schema.ts`, so both families share one definition.
- Handlers: `registerHandle` → `isTrustedSender` (as `image-export:run`) → strict zod. `filePath` goes through the confinement wrapper. The author comes from settings in main. The parse worker gets a `kind` id, never a path (`commentJobDocs.ts:11-13`).
- `window.api.fileComments` is added to the **main-window** preload (`src/preload/index.ts`). Update the surface snapshot.
- `preview:commentSetUnsavedSources` today lists `.html`/`.htm` paths only (`useUnsavedSourcesFeed.ts:54`), and only while the HTML bridge exists; § 8 C6 widens it to every commentable extension in every window.
- **Changed HTML payloads (optional fields only):**
  - `preview-page:commentPick.sel?` (S5)
  - `commentState.icons[].selRange?` (underline – character offsets within the target's text, numbers only; never strings, § 8 C16)
  - `preview:commentsChanged.stamp` (C-14)
  - a `reason` next to `code` in save answers (C-19)
- **Page-reachable surface:** no new channel, no new listener, no `invoke`. The contract test stays, except the one import allow-list line (§2).
- **New setting:** `markdownPreview.comments.enabled` (lenient, default `true`).
- **New error code:** `COMMENT_RENDER_CHANGED`. `docs/ipc-patterns.md` gains a "File comments" section.

## 5. Save pipeline

One `CommentWriter` for every kind. The fixed shared steps run in order:

1. Confine, then lock the real path and its dev/ino.
2. Refuse if the editor has unsaved edits.
3. Read the author from settings.
4. Re-read the file under the lock.
5. Decode losslessly and check the round trip.
6. Scan for conflict hunks.

`kind.parse`, then `locate` / `slots`, then `serializeBlock(data, layout, kind.agentNote, kind.hints(...))`.

Then, **for each slot in order**:

1. Shared checks: `verifySpliceBytes`, block count ±1, `@data` read-back, `isSafeInsert`.
2. `kind.verify`:
   - HTML: the same tag sequence, as today.
   - Markdown: the rendered tree is equal with positions and comments dropped, using `previewPipeline` with the same `remark-breaks` setting. Parse and compare only; nothing is executed.
3. If the render changed, try the next slot.
4. If no slot passes: `COMMENT_RENDER_CHANGED` – nothing written, text kept.

Last: `assembleSplice` from the bytes read, then `atomicWriteBytesStrict` with compare-and-swap.

**Why the bytes stay exact for every kind:**

- Main rebuilds the file from the bytes it read, and the strict write requires those same bytes on disk (`CommentWriter.ts:273-288`).
- A kind can choose *where* the block goes and *whether* to refuse. It cannot produce the bytes outside the block.
- Delete must give back the earlier bytes and pass `kind.verify`.
- Markdown adds one splice shape, `line-start` (`indent + block + eol` at a line start). It is used for "after the previous list item". `isSafeInsert` accepts exactly that shape, and P-M01 covers it.

**Byte-exactness proof:**

- The shared suite runs per kind across LF, CRLF, mixed endings and a BOM.
- The corpus test (024-NFR-003) runs locally or nightly.

## 6. Commit order in the single PR

Every commit leaves `npm run test:cov` green. A move commit shows renames and import paths only (`git diff -M --stat`).

1. `fix:` #429 – P-007 times out in Coverage.
2. `fix:` #426 – E-019 fails after E-016 on macOS.
3. `test:` frozen v0.23.1 parser and writer, copied with `git show v0.23.1:…` into `src/shared/comments/__fixtures__/frozen-v0.23.1/` and added to a SHA-256 lock.
4. `test:` pinning tests for v0.23.1 HTML behaviour:
   - writer bytes across LF, CRLF, mixed and BOM
   - snapshots of IPC schemas, `commentCopy` strings and the preload surface
   - `overlay.suite.ts` against the preload harness
5. `refactor:` **pure move** of the parse5-free format files to `src/shared/comments/`. `htmlComments/index.ts` re-exports. Fixtures move byte-for-byte at the same depth, so `golden.test.ts` paths and `v1.lock.json` stay unchanged.
6. `refactor:` pure move of the 15 shared main modules to `src/main/services/comments/`.
7. `refactor:` pure move of the 18 shared renderer modules to `components/Comments/`.
8. `refactor:` add `TargetIndex` and `CommentFileKind`; `htmlKind`; extensions come from the registry; split `parse` / `anchor`. Goldens unchanged.
9. `refactor:` add `overlayCore`; the preload uses it; contract amendment plus `docs/adrs/0006` (Q4 approved by the owner, 2026-10-29). HTML suite unchanged.
10. `refactor:` extract `previewPipeline` from `MarkdownPreview.tsx`. A test shows the preview and main's chain build the same tree.
11. `feat:` format additions:
    - `anchor.sel`
    - note-area hints
    - the agent note per kind
    - new goldens, plus the frozen-parser cross-version test
12. `feat:` Markdown kind: `mdIndex`, `slots`, `renderCheck`, `mdAnchor`; `FileCommentService`; `file-comment:*` channels; setting.
13. `feat:` renderer overlay host, Markdown adapter, toolbar, menu, paused band, identity step and Settings (C-04).
14. `feat:` selection comments in both previews; then C-01 to C-22 and OD-01 to OD-08, one commit per item or tight group (C-23 is out of scope, #440).
15. `test:` gate samples and the Claude Code gate report (024-AC-017).
16. `feat:` lock the Markdown placement rules and agent note (format-v1.md § "In Markdown files", goldens, lock). It names the gate report.
17. `test:` `.txt` conformance preview (alone, for 024-AC-002).
18. `test:` corpus round trip and large-file timing; `docs:` security, IPC, user guide, CHANGELOG.

## 7. Risks and open questions

| Risk | Mitigation |
|---|---|
| The renderer's react-markdown chain and main's unified chain disagree, so the render check refuses good slots or accepts bad ones | Commit 10's equality test on the spike cases and the corpus. One options constant for both |
| Parsing 1 MB of Markdown in the worker misses 0.5 s for pins (024-NFR-001) | Measure early, in commit 12; keep the parse cache keyed by content hash. Inferred: within budget |
| A shared module grows an import and pulls code into the sandbox | overlayCore contract test; the build guard |
| Selection data reaches the page (B1') against ADR 0005's "no comment text" | Only character offsets reach the page, never strings (§ 8 C16), so decision 2 holds. Security review confirms |
| A slot passes Erfana's render but renders differently on GitHub (design R1) | Corpus run with `cmark-gfm` where available (inferred: low risk) |
| The editor reloads after a write and loses cursor or undo (design R2) | Spike before commit 13 |

**Owner questions** (each recommendation listed first):

- **Q1 – Comments inside block quotes.** **Decided by the owner, 2026-10-29: write the block before the whole quote, and name the inner block in the anchor, as for table rows.** Reason: design §5.2 wrote blocks with a `> ` prefix, which the frozen v0.23.1 parser reads as Damaged – it compares trimmed readable lines, so `> status: open` ≠ `status: open` (`parse.ts:186-188, 230-232`) – and which breaks the blanks-only indent rule (`format.ts:83`).
- **Q2 – v0.23.1 drops the new hint lines.** **Decided by the owner, 2026-10-29: accept; spec 024 v0.4.0 amends FR-010 and AC-011.** The v0.23.1 writer re-renders the agent note from its fixed lines on every edit (`format.ts:442-446`, `splice.ts:224`), so it keeps `anchor.sel`, which lives in loose `@data` (`format.ts:175`), but drops the hint lines; the next current-version write restores them. It never writes `.md` files (`commentFileAccess.ts:104-105`). The test drives the frozen v0.23.1 thread path (§ 8 C30).
- **Q3 – Showing comments while the buffer has unsaved edits (C-09).** **Decided (routine call, 2026-10-29): the renderer sends the buffer text to main's single parser, for display only (§4).** A second parser in the renderer would break "one base".
- **Q4 – Widening the sealed-preload import rule (ADR 0005 decision 6) to the pure `overlayCore` folder (§2).** **Decided by the owner, 2026-10-29: yes, with a security-auditor review and a new ADR 0006.** Because the page receives selection offsets, not strings (§ 8 C16), ADR 0005 decision 2 is untouched.

## 8. Changes from the expert panel (2026-10-29)

Five specialist reviews (data safety, security, UX, test, agent workflow) and a design review. Each change cites its finding IDs from `.local/panel/spec-t3-024-unified-comments-improved.md`. Owner decisions are in spec 024 `01-overview.md` § Context.

| # | Change | Findings |
|---|---|---|
| C1 | One shared encoder renders every agent-note line (fold line breaks, `--` → `-\-`, escape `"` and `\`, visible `\uXXXX` for control, bidi and zero-width characters, cut on a grapheme boundary before escaping; no line starts with `status: `, `@`, `\` or a marker run). `CommentFileKind.agentNote` is validated at registration. `hints(data)` takes `@data` only, so reply and resolve can rebuild them, and the kind is passed into `planReplace`. | DS-1, DS-15, SEC-4, ARCH-M1, ARCH-M2 |
| C2 | `SplicePlan` carries its shape. The `@data` read-back offset and `removableRange` (`parse.ts:258-274`, moved to `blocks.ts`) depend on it; for `line-start`, delete removes leading indent + block + line break. HTML ranges are pinned unchanged. Property: `delete(add(f, slot)) = f` per slot rule. | ARCH-H2, DS-2 |
| C3 | The Markdown kind finds blocks only in `html` nodes of the CommonMark/GFM parse, split by a comment tokenizer; `--!>` is unterminated in Markdown. | DS-3, DS-24 |
| C4 | Slots never sit between another tool's comment and its node, nor inside a START/END region; the render check drops only the inserted block. Shared, so HTML follows too. | DS-4 |
| C5 | A Markdown `@data` table (tag, path, inner target, `view`, `target:` line per kind) goes into the spec and format-v1.md, with one golden per kind. | DS-5 |
| C6 | Writes stay straight to disk (owner). `useUnsavedSourcesFeed` moves to the shared base, filters by registered extensions, runs when either preview's comments are on and reports every window. The writer re-checks under the lock right before the rename. The Markdown editor reloads when clean, and shows its conflict flow when dirty, on any disk change. | DS-6, ARCH-H1, SEC-24 |
| C7 | Markdown `PickedTarget` gains `baseHash` and a required `quote`. Hash match → line position; otherwise exactly one quote match, else `COMMENT_TARGET_MOVED`. Markdown re-attach needs a text match. | ARCH-H4, DS-7, AG-16 |
| C8 | `.gitattributes` `-text` for every new fixture folder, with a `git check-attr` test. | DS-8 |
| C9 | Each shape's exact bytes, offset rule and indent rule (Markdown: spaces only, at the container's content column, never 4 or more past it). Slots never return a `> ` prefix. | DS-9, ARCH-L6 |
| C10 | The full shared check list: lossless re-decode, splice bytes, block count ±1, shape-aware `@data` read-back, comment count, `isSpliceWithin`, size limit, UTF-8 boundary check, retry once on `changed`. `meta-charset` moves to `htmlKind`. | ARCH-M3, DS-10 |
| C11 | One coordinate system: the whole decoded file, BOM included; CR, LF, CRLF each one line break; `previewPipeline` owns the frontmatter offset. The commit-10 equality test adds BOM, CR-only, CRLF and frontmatter files. | DS-11 |
| C12 | Re-read after the rename; report "file changed during save" on a mismatch. The compare-to-rename gap is an accepted risk. | DS-12 |
| C15 | The preload contract scan covers `overlayCore`; its import rule uses the TypeScript syntax tree with resolved paths (also fixed for `previewPageComments`). `react/no-danger` and `comments.source.test.ts` are widened before commit 7 and fail if their file count drops. Only `fileCommentGateway.ts` touches `window.api.fileComments`. | SEC-1, SEC-2, SEC-5, SEC-20, SEC-22 |
| C16 | Main checks `sel.exact` against its parse of the file on disk and drops it with `selRefused: 'not-in-file'` otherwise. The page gets selection offsets, never strings, so ADR 0006 amends decision 6 only. | SEC-3, SEC-7, SEC-8, ARCH-M8 |
| C17 | `file-comment:openDraft` mints a single-use token tied to window, panel and file; `add` names it; thread ops take keys only; `filePath` must be open in a panel of the sender's window. Recorded in `docs/security.md`. | SEC-9, ARCH-M9 |
| C18 | Named caps for every new IPC field (shared with the page schema); `bufferText` capped at the file limit and debounced; channel families bound to kinds; requested and real names map to the same kind; `txt` absent from the production registry; `file-comment:changed` only to the owning window, watchers counted, capped and freed. | SEC-10, SEC-11, SEC-12, ARCH-L2 |
| C19 | Markdown parse, locate, slots, verify and the buffer parse run in the parse worker under its limits; slots capped per save; the "before" tree rendered once; verify compares after parse and sanitize, before presentation plugins; the plugin list is pinned by a test; main never loads YAML; size limits from the corpus; parse cache keyed by kind + hash; the pipeline packages are runtime dependencies. *Note (2026-10-30):* the Markdown pipeline packages stay `devDependencies`, because electron-vite bundles them into the main bundle, so they ship at runtime – the intent of C19 holds. | SEC-13, SEC-14, SEC-15, DS-21, ARCH-M10, ARCH-L1, ARCH-L3 |
| C20 | No new log line carries comment text, words, excerpts, names or e-mails. Gate and corpus runs use a made-up identity. | SEC-18, SEC-23 |
| C21 | The `security-auditor` reviews commit 9 (`overlayCore` widening) and commit 12 (`file-comment:*`, Markdown kind) when they land, and the full PR. | SEC owner 6, ARCH-L9 |
| C22 | `commentSaveFlow` splits into a shared timeout/late-settle core and the HTML-only view binding; the parse worker splits into a shared runner plus per-kind jobs; `cutText` moves to the base; `commentLive` is split before commit 7; `commentPendingWrites` goes through `CommentSource`. A test fails if a shared folder imports an HTML-only folder. | ARCH-H3, QA-13 |
| C23 | Module map rows added: `commentModeKey`, `preview-comment-{channels,schema,page-schema}`, `comment-handlers`, `commentEmit`, `previewLiveComments`, `previewCommentsBridge`, `useUnsavedSourcesFeed` (shared), `commentTestids`; the FR-005/OD-03 view gate and the `design/` tables are placed. | ARCH-M4, ARCH-L5 |
| C24 | The seam covers `<!-- -->` file types (owner). `CommentFileKindId` is a plain string. The composition roots (main registry, worker entry, renderer adapter list, settings) are outside the base. A script, not the PR description, checks commit 17's paths. | QA-14, ARCH-M6 |
| C25 | `COMMENT_RENDER_CHANGED` gets a refusal reason and a code-map row. Leftover recommendation text under Q1–Q4 removed. | ARCH-L4, ARCH-L7 |
| C26 | Pins: invariants (bytes, goldens, locks, parse results, safety e2e, page preload surface) never change; characterisation pins change only in a `feat:` commit naming its C-xx/OD-xx; E-020 retired with Markdown comments. | QA-1, ARCH-M7 |
| C29 | Every commit passes `git rebase --exec "npm run lint && npm run typecheck && npm run test:cov && npx electron-vite build" develop`, with the log attached. Move commits move coverage-floor and max-lines keys one for one, and a script proves they change only imports. Merged without squashing. | QA-2, QA-3 |
| C30 | The frozen v0.23.1 copy holds every file it depends on (including `preview-limits`), with imports kept inside the folder, a recorded patch, `parse5` and `zod` pinned via npm aliases, v0.23.1 blob SHAs, a canary that the current parser accepts and the frozen one rejects, and the thread path for AC-011; excluded from coverage. | QA-4, QA-27, DS-16, DS-26, ARCH-L8 |
| C31 | Commit order: the corpus round trip and the large-file timing move to right after commit 12 (Markdown kind), before the gate (commit 15); commit 18 keeps only docs. | QA-25 |

Spec-level changes (gate, state table, menu matrix, keyboard list, selection rules, export leak, card approval) live in the spec's FR-016, FR-027, NFR-006, FR-004, FR-024 and FR-025.

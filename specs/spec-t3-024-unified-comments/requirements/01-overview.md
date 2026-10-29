# Overview

## Purpose

Erfana's comments become one experience across the app. HTML Preview comments shipped in v0.23.1; this spec adds Markdown Preview comments and text-selection comments, and it moves both previews onto **one shared comment base**, so the looks, words, keys and steps are the same everywhere. Each preview keeps only the parts its file type forces. The base leaves a seam so a later text-file preview can plug in without a change to the base.

The main use is a person who reviews a document and then asks a CLI agent in Erfana's terminal to act on the comments; review by several people through git is the second use. When the two conflict, agent use wins.

## Scope

### In scope

- A shared comment base used by the HTML Preview and the Markdown Preview, with a seam for later previews of file types that use `<!-- -->` comments (024-FR-001, 024-FR-002).
- Markdown Preview comments on `.md` and `.markdown` files, in the preview-only view (024-FR-003, 024-FR-005, 024-FR-015).
- Comments on selected text in both previews (024-FR-004).
- One experience: shared words, identity step and Settings text; any difference written down with its reason (024-FR-006, 024-FR-007, 024-FR-022).
- The `erfana:comment v1` format for both file types, extended only with optional fields that v0.23.1 still reads and keeps (024-FR-008 to 024-FR-011).
- File safety: a save changes only the comment block; a failed check writes nothing; outside damage is detected; other tools' comments keep their targets; saving straight to disk stays safe while the editor holds the file (024-FR-012 to 024-FR-014, 024-FR-023, 024-FR-026).
- Comment marks never leak into exports, copies or Find (024-FR-024).
- A menu matrix, a comment state table and the owner's approval of changed design cards before UI code (024-FR-025, 024-FR-027).
- A Claude Code gate on Markdown comments before the Markdown format rules lock (024-FR-016).
- The comments-v2 changes C-01 to C-22 (P0, and P1 with C-14, C-16, C-19 and C-22 raised to Must) and owner decisions OD-01 to OD-08 (024-FR-017 to 024-FR-019).
- Fixing the broken comment tests #426 and #429 as the first step (024-FR-020).
- Delivery as one pull request into `develop`, in one release (024-FR-021).

### Out of scope

- Comments on files that are not text (PDF, images); comments in the source editor (Monaco); comments in the Markdown editor or split views.
- New comment features beyond comments-v2, including its P2 changes (C-24 and later), an "Ask agent" button (OD-02) and a project-wide comment view (OD-08).
- A format version after v1.
- A backup copy of the file before a comment save; the pre-save checks and git are the guard.
- A promise that outside tools (for example Prettier run by the user's project) keep blocks intact; Erfana detects the damage instead.
- A warning that a website built from a Markdown file may publish its comments.
- Agent-gate runs with agents other than Claude Code, and re-running the gate at each release.
- Screen-reader checks, including comments-v2 C-23 – Erfana is dropping screen-reader support (#440). Keyboard-only use stays in scope.
- Showing the privacy notice again to users who dismissed the v0.23.1 notice.
- A special rule for agent instruction files (`CLAUDE.md`, `AGENTS.md`); they are commented like any other Markdown file.
- Previews of file types whose comments are not `<!-- -->` (for example `//` or `#`).
- A "changed since you last looked" marker (comments-v2 C-24) and combining duplicate comments after a git merge.
- Area (drawn-rectangle) comments.

## Success criteria

| Criterion | Metric | Target |
|-----------|--------|--------|
| One base | Comment modules outside the overlay duplicated between the two previews (024-FR-001) | 0 |
| File safety | Real-file round trips that change any byte outside the permitted range (024-NFR-003) | 0 of at least 2,500 files; refused saves ≤ 2 % |
| Compatibility | New sample blocks that v0.23.1 reads as Damaged (024-FR-009) | 0 |
| Agent use | Markdown gate samples Claude Code handles correctly (024-NFR-004) | Every one of at least 11 samples, at least 2 of 3 runs |
| Platforms | Comment test suites passing on macOS, Windows and Linux (024-NFR-002) | 3 of 3 |
| Speed | Pin and save times on a 1 MB file with 200 comments (024-NFR-001) | P50 and P95: pins 0.5 s or less, save 1 s or less |
| Owner acceptance | Owner's hands-on test on real HTML and Markdown files with an agent | Approved |

## Context

**Priority when good things clash** (owner, 2026-10-29): 1) the user's file is never damaged; 2) agents read and act on comments well; 3) HTML and Markdown feel the same; 4) room for more previews later.

**Delivery** (owner, 2026-10-29): everything ships as one pull request into `develop`, in one release, with no deadline – the base is done right before it is done fast. The owner declined splitting the work into smaller reviewed pull requests.

**Design inputs.** The UX and behaviour come from these designs, as they stand at commit `de29e70d`; a later change to them applies only after this spec is updated to cite it. Where they disagree, the later one in this list wins, and this spec wins over all of them:

1. [docs/designs/comments/html-preview-comments.md](../../../docs/designs/comments/html-preview-comments.md) – shipped in v0.23.1.
2. [docs/designs/comments/markdown-preview-comments.md](../../../docs/designs/comments/markdown-preview-comments.md) – decisions M1 to M11.
3. [docs/designs/comments/selection-comments.md](../../../docs/designs/comments/selection-comments.md) – decisions S1 onwards.
4. [docs/designs/comments/comments-v2.md](../../../docs/designs/comments/comments-v2.md) – changes C-01 to C-27 and owner decisions OD-01 to OD-08.

**Shipped code today** (v0.23.1, about 21,000 lines, all HTML-specific): `src/shared/htmlComments/` (format), `src/preload/previewPageComments/` (in-page overlay), `src/main/services/preview/comments/` (main-process service), `src/renderer/src/components/Panels/HtmlPreviewPanel/comments/` (drawer, window, toolbar).

**Delegated.** How the code splits into the shared base and the preview parts – module layout, whether the in-page overlay is one implementation or two, IPC shape – is the solution architect's decision, recorded in this spec's `architecture/` folder, within the requirements below.

**Accepted risks** (owner, 2026-10-29): one large pull request is hard to review; the format additions are permanent once released and get no separate sign-off beyond the pull-request review; a file outside git that is damaged despite the checks has no way back (no backup copy, reconfirmed by the owner after the expert panel); an outside write that lands in the short gap between the compare and the rename can be overwritten, and is reported afterwards as "file changed during save".

**Expert panel** (2026-10-29): five specialist reviews and a design review produced the v0.5.0 changes. Owner decisions taken there: comment saves go straight to disk, made safe for the editor (024-FR-026); the Claude Code gate stays small; C-14, C-16, C-19 and C-22 become Must; unforced differences between the previews are aligned; screen-reader support leaves Erfana (#440); the seam covers `<!-- -->` file types only; and "no overengineering" guides the rest. The full finding list is in `.local/panel/spec-t3-024-unified-comments-improved.md` (not committed).

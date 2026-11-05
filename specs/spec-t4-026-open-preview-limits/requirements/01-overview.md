# Overview

## Purpose

CLI agents in Erfana's terminal write HTML reports, notes and images into places the previews refuse today: dot folders such as `.claude/`, gitignored folders, build folders, the agent's scratchpad under `/tmp`, and git worktrees outside the project folder. Those files open as source, or cannot be clicked at all, so the owner leaves Erfana to look at them. This spec opens the previews to those places, keeps a short list of secret files that no page can ever read, and puts a one-click confirm in front of HTML from outside the project.

The rules come from the owner's review of every preview restriction on 2026-11-03 (decisions D1–D45, summarised in `05-notes.md`). It replaces the preview half of #254 where the two differ: #254 let a page read `.env` and `.git`, and kept everything outside the project unreachable; this spec blocks secret files and opens outside folders behind a confirm.

## Business objectives

| Objective | Success metric | Target |
|-----------|---------------|--------|
| See agent output next to the agent, without leaving Erfana | Cases of the 6-report set (026-NFR-003) that open from a terminal link as a running preview on macOS, Windows and Linux | 6 of 6 on each platform |
| Keep secrets out of reach of a previewed page | Hostile-page attempts on block-listed files and folder escapes that succeed (026-NFR-001) | 0 |
| Keep project open fast with `node_modules` and `.git` in the tree | Project-open time on the erfana repository, against the last release (026-NFR-002) | At most 10% slower |

## Scope

### In scope

- Every `.html` and `.htm` file inside the project previews, wherever it sits: dot folders, dotfiles, gitignored files, `node_modules`, `dist`, `out` and `coverage`, and – after a risk message – `.git` and the other secret folders.
- A previewed page may load any project file except a fixed secret block list, which applies everywhere a page can load from.
- Hardening of the block-list check against the known bypasses of path deny lists.
- Blocking WebRTC (a browser feature for direct live connections) in previews, as a Should.
- HTML, Markdown and images outside the project, opened from terminal links, links in previews and links in Markdown; HTML behind a per-folder confirm held in memory, with its own in-memory web allowlist. Other outside files open in the editor; every outside file opened this way can be edited and saved.
- Web frames from approved hosts.
- A live-preview limit of 10, or 5 on machines that report less than 15 GiB of memory (so 16 GB machines get 10).
- Removal of the HTML preview on/off setting.
- `.svg` files open in the live preview, with the image viewer one action away.
- The project tree and file watcher half of #254: `node_modules` and `.git` visible and loaded on expand, an empty built-in hide list, `.git` editable like any folder, and a watch-limit fallback.
- Documentation of the new risk, and removal of stale promises.

### Out of scope

- New viewers for PDF, CSV, TSV, video or audio (owner decision R18).
- A "trust this project?" step like VS Code's Workspace Trust (D38).
- Changes to the remote-host allowlist rules for subresources (R5), IPv6 hosts (R6), frame depth and count limits (R8), the external-link prompt and the download block (R9), symlinked files (R10), page storage (R11), size limits (R13), build steps (R14), Markdown cleaning (R15) and Markdown image rules for project files (R16; 026-FR-014 adds the rule for outside Markdown files).
- Refusing files with more than one hard link (D42).
- A warning in the README (D39).
- An in-app notice that the on/off setting is gone (D20).
- An in-app list to revoke approved hosts (#86) and per-kind host approvals (#81).

## Success criteria

| Criterion | Metric | Target |
|-----------|--------|--------|
| Agent output previews | 6-report set, all three platforms (026-NFR-003) | All pass |
| Secrets stay unreadable | Hostile-page suite, all three platforms (026-NFR-001) | All attempts refused |
| Independent security sign-off | High or critical findings from a reviewer who did not build the change (026-NFR-001) | 0 |
| Project open stays fast | erfana repository, median of 5 runs per platform (026-NFR-002) | ≤ 10% slower than the last release |
| Prompts are usable without a mouse | Confirm and risk messages (026-NFR-004) | Fully keyboard operable |

## Target users

| User type | Description | Key needs |
|-----------|-------------|-----------|
| Agent-driven developer | Runs Claude Code or another CLI agent on their own or trusted code and reviews its output in Erfana | One click from a terminal path to a running preview; no prompts for files inside the project |
| Developer opening a stranger's repository | Clones code they do not control and clicks around | Secret files stay unreadable; the documented risk tells them what a page can still read |

The first group is the main audience (D29). The second gets the block list and the documentation, not a separate mode.

## Context

- The HTML preview (#74) runs a page in its own process on an in-memory session, served through the `erfana-preview:` protocol with realpath confinement, a CSP built from the project allowlist and an independent request filter. The threat model and the accepted risks are in [docs/security.md § HTML preview](../../../docs/security.md#html-preview); the user-facing rules are in [docs/html-preview/README.md](../../../docs/html-preview/README.md).
- Spec 025 (built-in browser) opens `file://` pages confined to their folder and subfolders – the same folder rule this spec uses for approved outside folders. Its terminal-link change covers `http` and `https` links only, so it does not overlap 026-FR-007.
- Electron 44.9.3, which Erfana ships, bundles Chromium 152.0.7977.167 (checked 2026-11-03), the first release where Chromium's `Connection-Allowlist` header, which can block WebRTC, is generally available – unconfirmed until the spike in 026-CA-003.

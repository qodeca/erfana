# Claude Code gate – Markdown comments

Requirements: 024-FR-016, 024-NFR-004. Acceptance: 024-AC-017, 024-AC-027. Written by `src/main/services/comments/markdown/markdownGate.test.ts` from the runs of `run-gate.sh` ([samples and how to run](../../../src/shared/markdownComments/__fixtures__/gate/README.md)); do not edit by hand.

Round 2. Earlier rounds, kept unchanged: [round 1](claude-code-gate-round-1.md) – samples and lock in `gate/round-1/`; run again because its nested-list-item sample commented on the outer item, because the sample writer took the first item whose text held the words.

## Summary

| Sample | Covers | Runs passed | Result |
|---|---|---|---|
| `gate-01-paragraph.md` | paragraph | 3 of 3 | pass |
| `gate-02-heading.md` | heading | 3 of 3 | pass |
| `gate-03-list-item-1.md` | list item 1 | 3 of 3 | pass |
| `gate-04-list-item-2.md` | list item 2 | 3 of 3 | pass |
| `gate-05-nested-list-item.md` | nested list item | 3 of 3 | pass |
| `gate-06-table-row.md` | table row | 3 of 3 | pass |
| `gate-07-quote-paragraph.md` | paragraph inside a block quote | 3 of 3 | pass |
| `gate-08-code-block.md` | code block | 3 of 3 | pass |
| `gate-09-resolved-comment.md` | resolved comment | 3 of 3 | pass |
| `gate-10-selection-comment.md` | selection comment | 3 of 3 | pass |
| `gate-11-run-twice.md` | run twice | 3 of 3 | pass |

**Gate: pass** – 11 of 11 samples pass in at least 2 of 3 runs.

## Set-up

- Claude Code version: `2.1.314 (Claude Code)`
- Model ID: `claude-opus-5-5`
- Prompt: `Act on the open review comments in notes.md.` – the same for every run; each sample is copied into its run's project folder as `notes.md`
- Command (run in the project folder): `claude -p Act\ on\ the\ open\ review\ comments\ in\ notes.md. --safe-mode --setting-sources project --tools Read\,Edit\,Write\,Glob\,Grep --allowedTools Read\,Edit\,Write\,Glob\,Grep --permission-mode dontAsk --strict-mcp-config --no-session-persistence --disable-slash-commands --output-format stream-json --verbose`
- Isolation: `--safe-mode --setting-sources project` (subscription login kept; CLAUDE.md, skills, plugins, hooks, MCP servers and auto memory off, user and local settings not read, the project folder has none)
- Runs: 3 per sample, each in a new, empty project folder outside the repository with no `CLAUDE.md`, and a new session per run; the "run twice" sample runs a second time, in a new session, on its own output in the same folder. Runs folder: `gate-r2`
- Identity in the samples: the made-up `Gate Reviewer <gate@example.invalid>`
- Commit: `6793179b3204b7bd38ed0638ddf7af03e1af4f32 (with uncommitted changes)`; system: `MINGW64_NT-10.0-26200 3.6.9-b4195d69.x86_64 x86_64`

### Deviation from 024-AC-017

024-AC-017 says the runs are made by hand, in Erfana's terminal. They were made with the same program, the Claude Code CLI, non-interactively (`claude -p`), from a script, so the gate could run unattended with one recorded command, the same isolation for every run and a log of every pass. Nothing in a run depends on the terminal it runs in: Erfana's terminal starts the same CLI.

## Hashes

SHA-256, from `gate.lock.json`, written before the first run. The note text is the Markdown agent note's lines joined with LF, in UTF-8.

| What | SHA-256 |
|---|---|
| `samples/gate-01-paragraph.md` | b29d437f8dd5420cd9047de0eabddb2dc4d13e21674c0ccf63c28395ccac181a |
| `samples/gate-02-heading.md` | a66c67946b9ef1b7fbf25ec45d5adb90969c6bec701276821bf1ea259f94eec5 |
| `samples/gate-03-list-item-1.md` | 2f3ac06aa1abd0122643bb33d2f9b1f388484ff56604275a5414dc399a20cf4f |
| `samples/gate-04-list-item-2.md` | 6532ebb107abc054a52d569e0fa12ce16a8f3608f46b5188b9ed6ed07827efe9 |
| `samples/gate-05-nested-list-item.md` | 50705d5c05b85ad4c18ae5ffaa2d01b72eef2a1c46584b49e0d39d762cb4da61 |
| `samples/gate-06-table-row.md` | 8b44988f1bd0a15202af2b505b57ef2fab4ad2530247d34945608e64e0b55c65 |
| `samples/gate-07-quote-paragraph.md` | 0794eac279938cea95b549a23ed323d9e6e95483f0dea6c1e010db18172ee73e |
| `samples/gate-08-code-block.md` | 32a86eb920cbeb7d46e7a0c5fc21316b514f48a5806cb3f9c9865d9e9507fdd6 |
| `samples/gate-09-resolved-comment.md` | c22593262f3fd5410fb93a06eb8282fce0d65c43e88c6ab91a82d087b1dc6f9d |
| `samples/gate-10-selection-comment.md` | d3e3655463b482d41dc90d7dadc7a2e50c2860f19d5de094bc35e675e50e2519 |
| `samples/gate-11-run-twice.md` | 93d25527c49751a09877501183550482f383c4039db8145a18219c6ab2216184 |
| agent note text | 26e71c214300a880bed47240c6079980d3aacbe636c75d44445dafa6097fed87 |
| prompt | 775bb55097d18fec756adaaa97cce48cfb8c41a1b879ef9fe9e2e1d7ba6dc720 |

## Checks per run

A run passes when every check passes: **target** (each open comment's target changed as asked), **only targets** (outside the comment blocks, nothing but the asked edits changed – so a resolved comment's target is left alone too), **comments** (every comment block byte-identical), **resolved** (resolved blocks and their targets unchanged), **second run** ("run twice" only: no byte changed), **Erfana list** (the Markdown kind's `list` job: no damaged block, each open comment attached and Changed – Words changed for the selection comment counts as its Changed state – and each resolved comment still resolved) and **exit** (the CLI exited 0).

## Runs

| Sample | Run | Result | Failed checks | Seconds | Turns |
|---|---|---|---|---|---|
| `gate-01-paragraph.md` | 1 | pass | – | 20 | 3 |
| `gate-01-paragraph.md` | 2 | pass | – | 15 | 4 |
| `gate-01-paragraph.md` | 3 | pass | – | 11 | 3 |
| `gate-02-heading.md` | 1 | pass | – | 12 | 3 |
| `gate-02-heading.md` | 2 | pass | – | 17 | 4 |
| `gate-02-heading.md` | 3 | pass | – | 9 | 3 |
| `gate-03-list-item-1.md` | 1 | pass | – | 11 | 4 |
| `gate-03-list-item-1.md` | 2 | pass | – | 18 | 4 |
| `gate-03-list-item-1.md` | 3 | pass | – | 12 | 4 |
| `gate-04-list-item-2.md` | 1 | pass | – | 13 | 4 |
| `gate-04-list-item-2.md` | 2 | pass | – | 12 | 3 |
| `gate-04-list-item-2.md` | 3 | pass | – | 12 | 4 |
| `gate-05-nested-list-item.md` | 1 | pass | – | 23 | 3 |
| `gate-05-nested-list-item.md` | 2 | pass | – | 13 | 3 |
| `gate-05-nested-list-item.md` | 3 | pass | – | 11 | 3 |
| `gate-06-table-row.md` | 1 | pass | – | 18 | 5 |
| `gate-06-table-row.md` | 2 | pass | – | 20 | 5 |
| `gate-06-table-row.md` | 3 | pass | – | 13 | 4 |
| `gate-07-quote-paragraph.md` | 1 | pass | – | 18 | 3 |
| `gate-07-quote-paragraph.md` | 2 | pass | – | 26 | 5 |
| `gate-07-quote-paragraph.md` | 3 | pass | – | 12 | 4 |
| `gate-08-code-block.md` | 1 | pass | – | 12 | 3 |
| `gate-08-code-block.md` | 2 | pass | – | 17 | 3 |
| `gate-08-code-block.md` | 3 | pass | – | 9 | 3 |
| `gate-09-resolved-comment.md` | 1 | pass | – | 23 | 4 |
| `gate-09-resolved-comment.md` | 2 | pass | – | 15 | 4 |
| `gate-09-resolved-comment.md` | 3 | pass | – | 15 | 3 |
| `gate-10-selection-comment.md` | 1 | pass | – | 20 | 3 |
| `gate-10-selection-comment.md` | 2 | pass | – | 10 | 3 |
| `gate-10-selection-comment.md` | 3 | pass | – | 16 | 3 |
| `gate-11-run-twice.md` | 1 | pass | – | 13 + 7 | 4 + 2 |
| `gate-11-run-twice.md` | 2 | pass | – | 8 + 9 | 4 + 3 |
| `gate-11-run-twice.md` | 3 | pass | – | 12 + 10 | 3 + 3 |

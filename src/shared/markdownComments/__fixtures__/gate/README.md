<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# Claude Code gate samples (spec 024)

The samples of the Claude Code gate ([024-FR-016](../../../../../specs/spec-t3-024-unified-comments/requirements/02-requirements.md), 024-NFR-004): eleven Markdown files with Erfana comments, which Claude Code acts on three times each before the Markdown placement rules and agent note lock. The report of the current round is [`verification/claude-code-gate.md`](../../../../../specs/spec-t3-024-unified-comments/verification/claude-code-gate.md); it links the reports of earlier rounds.

The gate is in **round 2** (`GATE_ROUND` in `src/main/services/comments/markdown/__test-helpers__/gateReport.ts`). Round 1 failed on `gate-05-nested-list-item`: the sample writer took the first list item whose text held the words, which was the outer item, so the comment was about the wrong item. Round 2 names the nested item, and the writer now refuses a target that holds another match.

| Path | What it holds | Written by |
|---|---|---|
| `gateCases.ts` | Each sample before any comment, its comments, and the edit each open comment asks (`from` → `to`) | By hand |
| `samples/gate-*.md` | Each sample after Erfana's writer added its comments (the Markdown kind's job table and the shared write core), by the made-up `Gate Reviewer <gate@example.invalid>`, with a fixed clock and seeds | `markdownGate.test.ts` with `GATE_SAMPLES_WRITE=1` |
| `prompt.txt` | The one prompt every run gets (no line break) | Same |
| `gate.lock.json` | SHA-256 of every sample, of the Markdown agent note text (its lines joined with LF) and of the prompt, written **before any run** | Same |
| `run-gate.sh` | Runs the gate and writes the report | By hand |
| `round-<n>/samples/`, `round-<n>/gate.lock.json` | An earlier round's samples and lock, moved here unchanged; its report is `verification/claude-code-gate-round-<n>.md` | Moved with `git mv` |

## Rules

- **A sample is never edited after it is hashed.** The write mode refuses while `gate.lock.json` exists. A failed sample is reported, not fixed: the fix goes into the agent note, the hint lines or the sample writer, and then the whole gate runs again on new samples and a new lock, as a new round (below).
- **Any change to the agent note or the placement rules means a full re-run** (024-FR-016). The merge-time test fails when the note's hash no longer matches the report's.
- The folder is `-text` in [`.gitattributes`](../../../../../.gitattributes), so git keeps every byte.

## A new round

A round's samples, lock and report are history once a new round starts: they are moved, never edited or deleted.

1. Move the current round, byte for byte: `git mv samples round-<n>/samples`, `git mv gate.lock.json round-<n>/gate.lock.json`, and `git mv` the report to `verification/claude-code-gate-round-<n>.md`.
2. Add the round to `GATE_HISTORY` and raise `GATE_ROUND` in `gateReport.ts`.
3. Write the new samples (below) and run the gate.

The merge-time test checks that every earlier round's samples still match its lock and that the report links its report.

## Writing the samples (once per round)

```sh
GATE_SAMPLES_WRITE=1 npx vitest --run --config vitest.main.config.ts --project main src/main/services/comments/markdown/markdownGate.test.ts
```

## Running the gate

From the repository root, in Git Bash on Windows or a shell on macOS or Linux, with `claude` on the `PATH`:

```sh
bash src/shared/markdownComments/__fixtures__/gate/run-gate.sh <a new folder outside the repository>
```

For each sample and each of the three runs it:

1. copies the sample to `<folder>/<sample>/run-<n>/before.md` and, as `notes.md`, into a new, empty `project/` folder (no `CLAUDE.md`);
2. runs, in that folder, a new non-interactive session: `claude -p "$(cat prompt.txt)"` with only the file tools `Read,Edit,Write,Glob,Grep` (no shell, no web, `--permission-mode dontAsk`), no MCP servers, no session saved, `stream-json` output; isolated with `--bare` when `ANTHROPIC_API_KEY` is set, else `--safe-mode --setting-sources project`;
3. keeps `after-<pass>.md`, the CLI's log and the timing; the "run twice" sample gets a second session on its own output.

`GATE_MODEL=<model>` pins `--model`. Then it runs `markdownGate.test.ts` with `GATE_RUNS_DIR` set, which checks every run (`gateChecks.ts`: target changed as asked, nothing else changed, every comment block byte-identical, resolved comments untouched, the second run changed nothing, and Erfana's own `list` job shows each open comment Changed, never Not found or Damaged) and writes the report. A sample passes with 2 of 3 runs.

The runs are made with the CLI from a script, not by hand in Erfana's terminal; the report records that deviation and why.

<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# HTML Preview comments – test fixtures

Fixtures for the `src/shared/htmlComments` suites ([design](../../../../docs/designs/html-preview-comments.md) § 12 and § 16, [format](../../../../docs/html-comments/format-v1.md)). They are byte-exact: `-text` in [`.gitattributes`](../../../../.gitattributes), so git never converts their line endings.

| Path | What it holds | Written by |
|---|---|---|
| `v1/<case>.block.txt` | The ten canonical v1 serializations of `v1/cases.ts` (G-001) | `gen/genFixtures.ts` |
| `v1-compat/<page>.html`, `<page>.expected.json` | Pages as other writers, editors, checkouts and merges leave them, with the parser's reading of each (G-002) | `gen/compat.ts` |
| `v1.lock.json` | The SHA-256 of every file in `v1/` and `v1-compat/` (G-003) | `gen/genFixtures.ts` |
| [`agent-review/*.html`](../../../../e2e/fixtures/html-preview-corpus/comments/agent-review/) (under `e2e/fixtures/html-preview-corpus/comments/`) | The three pages of the agent check (X-001) | `gen/agentReview.ts` |
| `v1/cases.ts`, `commentTestData.ts`, `arbitraries.ts`, `contexts/` | The golden cases, shared test data, fast-check generators and context pages | Not generated |

## Regenerating

```sh
npm run fixtures:html-comments
```

Run it from the repository root. It bundles `gen/genFixtures.ts` with esbuild into `temp/` (git-ignored) and runs the bundle with node. With the format unchanged, every file comes out byte-identical and `git status` shows no change. A diff means the format changed: v1 fixtures are append-only, so change the spec, the goldens and `v1.lock.json` together, and only on purpose.

The run ends by printing, for each agent-review page, the line each block starts on, its status and its target. [`agent-review/RUBRIC.md`](../../../../e2e/fixtures/html-preview-corpus/comments/agent-review/RUBRIC.md) is written by hand from that output, so update its **Line** column whenever the pages change.

`npm run fixtures:html-comments -- --examples <dir>` also writes the examples of `format-v1.md` into `<dir>`, to paste into the spec. Point it outside the repository.

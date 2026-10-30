<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# Markdown comment fixtures (spec 024)

Fixtures for the `src/shared/markdownComments` suites ([placement rules](../../../../specs/spec-t3-024-unified-comments/design/markdown-format.md)). They are byte-exact: `-text` in [`.gitattributes`](../../../../.gitattributes), so git never converts their line endings.

| Path | What it holds | Written by |
|---|---|---|
| `goldenCases.ts` | The placement goldens' inputs: a file before the comment and the target, one per kind of the `@data` table and per slot rule (G-M01 …) | By hand |
| `goldens/g-m*.md` | Each case after the add, with a fixed author, clock and random source | `markdownGoldens.test.ts` with `MD_GOLDENS_WRITE=1` |
| `goldens.lock.json` | The SHA-256 of every golden | By hand, from the hashes of the files |
| `outside/` | `original.md` after each outside tool of 024-AC-015, with the commands in its [README](outside/README.md) | See that README |

## Regenerating the goldens

```sh
MD_GOLDENS_WRITE=1 npx vitest --run --config vitest.main.config.ts --project main src/shared/markdownComments/markdownGoldens.test.ts
```

With the placement rules and the format unchanged, every golden comes out byte-identical and `git status` shows no change. A diff means a rule changed: after the Claude Code gate (024-FR-016) the rules are locked, so change the spec, the goldens and the lock together, and only on purpose.

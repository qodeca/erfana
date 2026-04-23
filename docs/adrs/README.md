# Architecture Decision Records (ADRs)

Short, dated, durable records of **why** the Erfana codebase is shaped the way it is around specific non-obvious choices. One decision per file. Written at the time the decision was made (or retroactively when a reviewer flagged the decision as load-bearing).

## Format

Each ADR uses this shape:

```
# ADR <NNNN>: <title>

- **Status**: accepted / superseded / deprecated
- **Date**: YYYY-MM-DD
- **Deciders**: who signed off
- **Related**: other ADRs / issues / specs

## Context
What forced a choice. What would break if we kept deferring.

## Decision
What we picked. One paragraph.

## Consequences
What we now have to accept. What follows.

## Alternatives considered
What else was on the table and why it lost.

## References
File paths, commits, plan-file sections, reviewer-audit IDs.
```

ADRs are **not** retrofitted for every historical choice — only for decisions whose rationale would be expensive to re-derive from code alone.

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [0001](./0001-self-host-whisper-binaries.md) | Self-host whisper.cpp binaries via dedicated CI workflow | accepted | 2026-04-23 |
| [0002](./0002-minisign-over-cosign-sigstore.md) | Minisign Ed25519 for manifest signatures, not cosign/Sigstore | accepted | 2026-04-23 |
| [0003](./0003-dual-pubkey-trust-primary-rotation.md) | Dual-pubkey trust chain (primary + offline rotation) | accepted | 2026-04-23 |
| [0004](./0004-per-spawn-toctou-rehash.md) | Per-spawn re-hash for TOCTOU close (5-tuple spawn log) | accepted | 2026-04-23 |

## When to write an ADR

Write one when:

- A reviewer independently flagged the decision as "where's the rationale?".
- The same question is likely to recur when the codebase gets bigger.
- Removing the decision would be plausible-looking but wrong.
- The rejected alternative is more obvious than the chosen path.

Do **not** write one when:

- The answer is in the code and the code is short.
- The question is "how", not "why".
- A deferred-work ledger entry already captures the rationale (e.g. `docs/windows/deferred-work.md` D1-D12).

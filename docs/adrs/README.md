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
| [0005](./0005-sub-frame-preload-one-receive-channel.md) | Sub-frame preload with one receive channel (HTML Preview comments) | accepted | 2026-10-26 |
| [0006](./0006-overlay-core-in-the-sealed-preload.md) | Overlay core in the sealed preload (amends 0005 decision 6) | accepted | 2026-10-29 |
| [0007](./0007-pick-overlay-engine-drawn-through-cdp.md) | Pick overlay drawn by the engine through the DevTools protocol (browser, spec 025) | proposed | 2026-11-02 |
| [0008](./0008-freeze-with-debugger-pause-after-capture.md) | Freeze with `Debugger.pause`, after the capture and the source hints | proposed | 2026-11-02 |
| [0009](./0009-browser-profile-in-the-project-folder.md) | The browser profile and its trust decisions live in the project folder | proposed | 2026-11-02 |
| [0010](./0010-turn-on-cookie-encryption.md) | Turn on the `EnableCookieEncryption` fuse | proposed | 2026-11-02 |
| [0011](./0011-erfana-surfaces-over-the-page-and-main-process-key-routing.md) | Erfana surfaces around and over the page view, and key routing in the main process | proposed | 2026-11-02 |
| [0012](./0012-local-files-through-a-dedicated-scheme.md) | Local files open through a dedicated `erfana-local:` scheme | proposed | 2026-11-02 |

## When to write an ADR

Write one when:

- A reviewer independently flagged the decision as "where's the rationale?".
- The same question is likely to recur when the codebase gets bigger.
- Removing the decision would be plausible-looking but wrong.
- The rejected alternative is more obvious than the chosen path.

Do **not** write one when:

- The answer is in the code and the code is short.
- The question is "how", not "why".
- A deferred-work ledger entry already captures the rationale (e.g. `docs/windows/deferred-work.md` D1-D8 and `docs/windows/deferred-work-phase4.md` D9-D12).

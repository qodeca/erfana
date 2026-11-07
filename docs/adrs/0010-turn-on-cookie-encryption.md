# ADR 0010: Turn on the `EnableCookieEncryption` fuse

- **Status**: accepted (owner decision, 2026-11-03) – supersedes the decision in `scripts/fuses.js` (the `EnableCookieEncryption` comment, lines 705–709) and [`docs/spikes/2026-10-22-asar-integrity.md`](../spikes/2026-10-22-asar-integrity.md) § Cookie encryption; revised 2026-11-02 after the expert panel (test lanes)
- **Date**: 2026-11-03
- **Deciders**: Marcin Obel (owner), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-015, 025-FR-017, 025-FR-018, 025-NFR-007, 025-NFR-010 · 025-CA-005 · [ADR 0009](./0009-browser-profile-in-the-project-folder.md)

## Context

`scripts/fuses.js` keeps the fuse off because Erfana persisted no cookies worth protecting; the October 2026 spike said to revisit "if Erfana ever keeps a signed-in web session". Spec 025 does: per-project persistent profiles with staging and production sign-ins, and 025-FR-017 requires encrypted cookies.

[Electron's fuse documentation](https://www.electronjs.org/docs/latest/tutorial/fuses): cookies are encrypted with OS keys; existing plain cookies are "encrypted-on-write"; it is one-way – turning it off later leaves the store "corrupt and useless". `safeStorage` (used by `lockHmac.ts` and `ApiKeyService`) already reads the same "Erfana Safe Storage" key.

## Decision

1. **`[FuseV1Options.EnableCookieEncryption]: true`** in `buildFuseConfig`, with a comment naming this ADR, the one-way rule and the start-up budget; shipped in the first browser release, never behind a flag.
2. **Never off again**: `scripts/fuses.test.mjs` fails on `false` with a message pointing here.
3. **Migration is encrypt-on-write**; no persistent Erfana store holds cookies today.
4. **Test lanes.**
   - Fuse read back from the packaged binary (`npx @electron/fuses read`) – 025-AC-017.
   - Plain-text cookie search on packaged, signed macOS and Windows builds – 025-AC-052 / 025-NFR-007 (manual signed lane).
   - Linux in CI: an unsigned `electron-builder --linux dir` build with the fuses applied, on a cached image with `gnome-keyring` and `libsecret`, runs 025-AC-017 and 025-AC-018; the keyring-change step of 025-AC-018 also runs in the e2e lane through a test-build backend override.
   - 025-AC-079 (update from v0.23.1 keeps data): install the published v0.23.1 artefact, create a profile-free project with a lock and API key, upgrade to the candidate, check both still work.
5. **Start-up budget (025-NFR-010)**: two candidate builds that differ **only** in this fuse, cold starts interleaved, 20 samples each, interval from process spawn to the main window's `ready-to-show`, median growth ≤ 150 ms per platform (`bench` lane, 025-AC-082). Expected small, as `safeStorage` already reads the key (inferred).
6. **Linux without a keyring** keeps working with Chromium's built-in key; ADR 0009 decision 7 covers what Erfana stores there.

## Consequences

- One-way door, accepted: reverting signs every user out everywhere.
- The key lives in the OS: a copied profile starts signed out (025-FR-015).
- Every user pays the start-up read.
- Only cookies are encrypted; on Windows any same-user process can decrypt the key (user guide, 025-FR-044).
- Dev and unpackaged runs do not encrypt; fixtures use throwaway credentials.

## Alternatives considered

- **Keep it off** – session cookies for client sites in plain text inside synced project folders; fails 025-FR-017. Rejected.
- **In-memory sessions** – signed out at every restart; fails 025-FR-015. Rejected.
- **Encrypt the whole profile folder** – no hook into Chromium's storage backends. Rejected.

## References

- [Electron – fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- `scripts/fuses.js`, `scripts/fuses.test.mjs`, `docs/spikes/2026-10-22-asar-integrity.md`, `src/main/utils/lockHmac.ts`

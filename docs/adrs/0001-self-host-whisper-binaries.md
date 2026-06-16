# ADR 0001: Self-host whisper.cpp binaries via dedicated CI workflow

- **Status**: accepted
- **Date**: 2026-04-23
- **Deciders**: Marcin Obel (project owner), Claude Code (implementation + 3 independent reviewer agents)
- **Related**: [#165](https://github.com/qodeca/erfana/issues/165) · [ADR 0002](0002-minisign-over-cosign-sigstore.md) · [ADR 0003](0003-dual-pubkey-trust-primary-rotation.md) · [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md)

## Context

Pre-0.9.4, `WhisperModelManager` downloaded whisper.cpp binaries from `ggml-org/whisper.cpp` GitHub Releases. During Phase 4 planning, step-zero verification surfaced three independent findings that made that approach unworkable:

1. **No macOS CLI binary upstream.** `ggml-org/whisper.cpp` has never published a macOS CLI binary at any recent version (v1.7.0–v1.8.4). The release assets are: Windows zips, a macOS xcframework intended for iOS embedding (not a runnable CLI), and CUDA/BLAS variants. The pre-0.9.4 macOS code path referenced a filename that simply does not exist — "Local (whisper.cpp)" was showing as enabled on macOS but would 404 on first download.
2. **Windows zip format incompatibility.** PowerShell's native `Compress-Archive` produces stream-format zips that Node's `extract-zip` (via `yauzl`) rejects. A naive "fetch upstream + extract" would fail silently on long or non-ASCII paths. Any CI approach needs `7z` or equivalent + a round-trip-through-extract-zip test step.
3. **Signing chain reproducibility.** Upstream binaries are unsigned on Windows and not notarized on macOS. Shipping those to end users would trigger SmartScreen / Gatekeeper warnings on every launch, and we'd have no way to rotate or revoke trust if a supply-chain compromise ever occurred.

Option B (pin to upstream ggml-org releases, narrow scope to Windows) was the initial plan. After the three findings surfaced, Option B was rejected in favour of Option A.

## Decision

We self-host whisper.cpp binaries on **our own** `qodeca/erfana` GitHub Releases via a dedicated CI workflow (`.github/workflows/whisper-binaries.yml`). Tags follow the pattern `whisper-build-<upstream_label>-erfana<N>` and are **always** marked pre-release so electron-updater ignores them (app releases use `v<semver>` tags in the same repo).

Two release streams, one repo:

- **App releases** — `v{semver}` tags, normal releases, consumed by electron-updater.
- **Whisper binary releases** — `whisper-build-*` tags, always pre-release, consumed by `WhisperModelManager` via the hard-coded pin in `src/main/services/whisper-assets.ts`.

Manual `workflow_dispatch` only. Gated on a `production-signing` GitHub Environment requiring repo-admin approval before any signing secrets are attached. Signed + notarized on macOS (Developer ID Application). Windows is **unsigned in 0.9.4** — Phase 5 procures a code-sign cert; SHA-256 pin + MOTW strip are the current trust anchors.

## Consequences

**Acceptable costs**

- **~$150/yr GitHub Actions compute** on private repo billing (macos-14 × ~15 min × $0.16/min × 10× multiplier dominates; see `docs/build/whisper-binaries.md` §Cost for the full breakdown).
- **Manual rebuild cadence** — ~4-6 rebuilds/year matched to whisper.cpp minor bumps + security-driven rebuilds. No auto-update loop for the subprocess.
- **Apple Developer Program ($99/yr)** — already paid for the app signing.
- **Non-reproducible builds** — CMake embeds timestamps + git SHA, so re-running with the same `upstream_sha` + `erfana_revision` does NOT produce bit-identical output. Pin = "this specific build we shipped", not "hash of any reproducible build". Quarterly integrity check verifies a random shipped binary against its pin.

**Operational requirements**

- Every whisper rebuild requires manual human approval at the GitHub Environment gate (the secrets don't attach until approval).
- Retention policy: never delete a `whisper-build-*` release that any shipped Erfana version still pins (3-month minimum support window).
- Upstream SHA diff-review per bump — see the checklist in `docs/build/whisper-binaries.md`.

**New surface we now own**

- Trust-chain client code (`src/main/utils/verifyManifest.ts` + embedded pubkeys in `whisper-pubkeys.ts`).
- Dual-key rotation procedure (see [ADR 0003](0003-dual-pubkey-trust-primary-rotation.md)).
- Cert-revocation runbook for Apple / Windows / minisign (see `docs/build/whisper-binaries.md` §"Cert-revocation runbook").
- Monthly credential-health canary (`.github/workflows/whisper-binaries-canary.yml`).

## Alternatives considered

### Option B — pin to ggml-org releases

- **Rejected**: macOS has no CLI binary upstream at any recent version; naive URL construction 404s. This was the #1 blocker.
- **Rejected even if macOS existed**: Windows zips would need to pass a round-trip extract-zip check we don't control. We'd still need a CI step to re-package.
- **Rejected for supply-chain**: trusting upstream releases = trusting whoever has commit + release rights at `ggml-org/whisper.cpp`. No rotation story.

### Option C — bundle whisper inside the Erfana installer (DMG/NSIS)

- **Rejected**: installer size balloons by ~8 MB × 2 architectures. Users who never turn on local transcription pay the download cost. Current "lazy download on first use" UX is better.
- **Rejected**: the signing + notarization flow for the subprocess would need to happen every app release, coupling two independent cadences.

### Option D — pin to Homebrew (`brew install whisper-cpp`)

- **Rejected**: macOS-only; doesn't solve Windows. Not a universal answer.
- **Rejected**: Homebrew's release cadence isn't under our control; a regression there would block Erfana transcription users.

### Option E — rebuild using GitHub's `softprops/action-gh-release` from an upstream fork

- **Rejected**: same supply-chain concern as Option B. We'd trust a fork owner, not reduce trust surface.

## Why this decision is load-bearing

A well-meaning future contributor will propose "just pin to the official release" every ~6 months, because the self-host approach looks more complex than it needs to be. Without this ADR, that proposal takes 30 minutes to rebut from first principles each time. With this ADR, it takes 30 seconds to say "read ADR 0001, then come back".

## References

- Plan file (external): `~/.claude/plans/run-a-comprehensive-planning-purrfect-tide.md`
- `docs/CHANGELOG.md` §0.9.4 — user-facing summary
- `docs/build/whisper-binaries.md` — operational runbook
- `docs/windows/implementation-plan.md` §"Phase 4 — Local Whisper parity"
- `.github/workflows/whisper-binaries.yml` — the 4-job workflow
- `.github/workflows/whisper-binaries-canary.yml` — monthly credential canary
- `src/main/services/whisper-assets.ts` — pinned RELEASE_TAG + SHAs
- First published release: `whisper-build-v1.8.4-erfana1` (see `docs/windows/phase4-binary-spec.md`)

# ADR 0002: Minisign Ed25519 for manifest signatures, not cosign/Sigstore

- **Status**: accepted
- **Date**: 2026-04-23
- **Deciders**: Marcin Obel, Claude Code (security-auditor agent review)
- **Related**: [ADR 0001](0001-self-host-whisper-binaries.md) · [ADR 0003](0003-dual-pubkey-trust-primary-rotation.md) · [`src/main/utils/verifyManifest.ts`](../../src/main/utils/verifyManifest.ts)

## Context

After [ADR 0001](0001-self-host-whisper-binaries.md) committed us to self-hosting whisper binaries, we needed a manifest-signing scheme. The `manifest.json` at each `whisper-build-*` release asserts (a) the artifact SHA-256s for each platform, (b) the monotonic revision index, and (c) the signing key role. A supply-chain compromise scenario is: attacker gets write access to the release assets but NOT to the signing key. Manifest signature + pinned pubkey on the client defeats that attacker.

Three candidate schemes were evaluated:

1. **cosign** (Sigstore project) — GPG-successor with transparency-log (Rekor) integration.
2. **Sigstore bundles** with keyless signing + OIDC.
3. **Minisign** — Ed25519-based, pure-function signatures, no online infrastructure.

## Decision

We chose **minisign Ed25519** for `manifest.json` signatures. Verifier is a pure-JS implementation in `src/main/utils/verifyManifest.ts` using `@noble/ed25519` as the primitive. Keys are generated with the `minisign` CLI on the signing host; primary key lives as a GitHub Actions secret in the `production-signing` environment; rotation key lives offline on a hardware token.

Supports both minisign variants:

- **`Ed` legacy** — raw Ed25519 signature over the manifest bytes.
- **`ED` prehashed** — BLAKE2b-512 prehash, then Ed25519 over the 64-byte digest. Detected via magic bytes `0x45 0x44` in the signature file header; selected automatically by the verifier.

## Consequences

**What we get**

- **No online infrastructure dependency.** Verification is a pure function: `(manifest_bytes, signature_bytes, pubkey) → bool`. No Rekor, no OCSP, no transparency log. Works if `github.com` is down, works on air-gapped machines (theoretically).
- **Tiny verifier surface.** `verifyManifest.ts` is ~170 lines; `@noble/ed25519` is audited and pure JS. Total attack surface smaller than a cosign integration.
- **No CA / chain-of-trust.** The pubkey is embedded in `src/main/services/whisper-pubkeys.ts` at compile time. Client trust = "did the shipped app's compiled pubkey verify this?" No intermediate CA to compromise.
- **Fast.** Ed25519 verify is ~100µs on modern hardware. Even the prehashed `ED` variant adds only a single BLAKE2b-512 pass over typical ~1 KB manifests.

**What we accept**

- **No transparency log.** An attacker who compromises the primary key can sign a back-dated manifest and we have no out-of-band way to detect the forgery. Mitigated by [ADR 0003](0003-dual-pubkey-trust-primary-rotation.md) dual-pubkey rotation + monotonic `revisionIndex` anti-replay.
- **Key-ID endianness quirk.** Minisign displays key IDs with bytes reversed vs the on-wire encoding. The verifier documents this at `verifyManifest.ts:84-88` but a future maintainer comparing hex dumps may re-discover it painfully.
- **No OIDC / keyless.** Every rebuild requires the primary key secret attached to the CI job. If we ever want GitHub OIDC-backed signing, that's a migration.

## Alternatives considered

### cosign / Sigstore keyed mode

- **Pros**: transparency log via Rekor; widely deployed; integrates with OCI artifacts.
- **Cons**: requires online verification against Rekor (or accepting the signature as opaque, which defeats the point); verifier ships as a Go binary (not embeddable in the Electron main process without a subprocess); depends on Sigstore public infrastructure which has had outages.
- **Verdict**: rejected. The transparency log is a real security benefit we chose not to pay for this iteration. Promotion criterion: Erfana's trust model grows to "we need cryptographic audit of every release we've ever signed" — currently not a requirement.

### Sigstore keyless (OIDC)

- **Pros**: no private key to rotate; signs with short-lived identity tokens.
- **Cons**: requires online verification; ties signing identity to GitHub Actions availability; every verify needs a Rekor inclusion proof fetched at runtime.
- **Verdict**: rejected. The "no key to rotate" benefit is real, but the "need network to verify" cost is fatal for a user who fails first transcription on a flaky network. Minisign verify works offline.

### GPG (gpg2 / OpenPGP)

- **Pros**: universally supported; mature tooling.
- **Cons**: huge attack surface (every CVE in GnuPG becomes our problem); complex key-servers and WoT semantics we don't need; no clean Node.js embeddable verifier.
- **Verdict**: rejected. Minisign is "GPG minus everything we don't need".

### Custom JSON Web Signatures (JWS)

- **Pros**: universally parseable; we already use JSON.
- **Cons**: we'd be handcrafting the format. No tooling for key generation. Less auditable than reusing a widely-deployed signature format.
- **Verdict**: rejected.

## Why this decision is load-bearing

Every future security-minded contributor will ask "why not cosign / Sigstore, it's the modern choice?" without this ADR. The answer is nuanced: their primitive (Ed25519 with optional prehash) is what minisign IS; the difference is the transparency log and the online-verify requirement. Recording the rationale prevents a re-evaluation-by-default each time.

## References

- `src/main/utils/verifyManifest.ts` — the verifier implementation (detects Ed/ED variants at lines 91-97, reverses key-ID bytes at lines 84-88)
- `src/main/utils/verifyManifest.test.ts` — test file uses a real published `manifest.json` + signature as fixture (see "crypto fixture pattern" note in `docs/testing/README.md`)
- `src/main/services/whisper-pubkeys.ts` — embedded primary + rotation pubkeys
- [minisign reference](https://jedisct1.github.io/minisign/) — Frank Denis' original C implementation
- [@noble/ed25519](https://github.com/paulmillr/noble-ed25519) — the pure-JS primitive we use for Ed25519 verify
- First published manifest: [manifest.json in whisper-build-v1.8.4-erfana1](https://github.com/qodeca/erfana/releases/tag/whisper-build-v1.8.4-erfana1)

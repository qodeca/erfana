# ADR 0003: Dual-pubkey trust chain (primary + offline rotation)

- **Status**: accepted
- **Date**: 2026-04-23
- **Deciders**: Marcin Obel, Claude Code (security-auditor agent review)
- **Related**: [ADR 0001](0001-self-host-whisper-binaries.md) · [ADR 0002](0002-minisign-over-cosign-sigstore.md) · [`src/main/services/whisper-pubkeys.ts`](../../src/main/services/whisper-pubkeys.ts)

## Context

After [ADR 0002](0002-minisign-over-cosign-sigstore.md) committed us to minisign, we needed a **key rotation story**. A single-key design is fragile: if the primary key is compromised, we'd need to ship a new Erfana version with a new embedded pubkey, and between the compromise disclosure and user update there's a signing-valid-but-attacker-controlled window where the attacker can sign arbitrary manifests.

The question: how do we bound that window to zero without an online revocation infrastructure?

## Decision

We embed **two** minisign public keys in Erfana's compiled source (`src/main/services/whisper-pubkeys.ts`):

- **`primary`** — the key used in CI for every signed release. Lives as a GitHub Actions secret in the `production-signing` environment.
- **`rotation`** — offline on a hardware token (YubiKey or equivalent). Never touches a CI environment; never stored on any network-connected machine.

Both pubkeys are embedded as `readonly` constants. `verifyManifest` accepts a signature if it verifies against **either** pubkey. The manifest's own `signingKey` field (`"primary" | "rotation"`) is advisory only — the verifier reports the cryptographically-verified role, not the manifest's claim.

## Consequences

**The rotation story**

If the primary key is compromised:

1. Generate a new primary keypair offline.
2. Ship Erfana patch release with `whisper-pubkeys.ts` updated: the compromised primary pubkey is **removed**, the new primary pubkey is added, the rotation pubkey is **retained**.
3. During the user-update window, releases are signed with the **rotation key** (from the hardware token). Users on the old Erfana version accept rotation-signed releases because the rotation pubkey is still embedded.
4. Once user update penetration is high enough, the next release can switch back to primary-key signing (new primary). Rotation key returns to offline storage.

This gives us **zero-gap continuity**: at no point is there a release that current users can't verify.

**If BOTH keys are compromised simultaneously**

- Ship Erfana emergency release with a fresh keypair.
- Users on the old version are stuck until they update — document this in [ADR 0001](0001-self-host-whisper-binaries.md) known limitations.
- This is the documented worst case; rotation key on a hardware token makes it highly unlikely (attacker needs physical possession).

**What we accept**

- **Two keys to guard.** The rotation key's hardware token must be physically secured. Loss of the token = we can't recover if primary is ever compromised (need emergency keypair + user update window with no zero-gap).
- **Both public keys in every Erfana build.** The binary is bigger by ~32 bytes per pubkey. Both pubkeys are visible to anyone with a build — which is fine, they're public by definition.
- **`signingKey` field is advisory.** A manifest can lie about which key signed it — we don't trust that field. The verifier reports the role it actually matched against.

## Alternatives considered

### Single-key with in-app revocation list

- **Pros**: simpler architecture; one key to protect.
- **Cons**: revocation list must be fetched online; defeats the "minisign works offline" property from ADR 0002; introduces a new trust boundary (who signs the revocation list?).
- **Verdict**: rejected. The online-fetch requirement contradicts ADR 0002.

### Single-key with emergency patch-release pattern

- **Pros**: simplest possible architecture.
- **Cons**: leaves a signing-valid-but-attacker-controlled window between compromise detection and user update. For users on auto-update this window is hours; for users with auto-update disabled it's indefinite.
- **Verdict**: rejected. Unacceptable for a security-critical subprocess.

### Three or more keys (primary + rotation + disaster-recovery)

- **Pros**: more redundancy.
- **Cons**: diminishing returns; more surface to guard; more hardware tokens to track.
- **Verdict**: rejected for now. Promotion criterion: if we ever have a multi-person signing authority with offline quorum, reconsider.

### Cert-chain with root CA

- **Pros**: industry-standard.
- **Cons**: requires revocation infrastructure (OCSP / CRL); ties us to X.509 semantics minisign doesn't use; overkill for a single product.
- **Verdict**: rejected.

## Why this decision is load-bearing

Without the dual-pubkey pattern, any primary-key compromise forces an emergency app release with a zero-day user-update window during which the attacker can sign arbitrary releases. The dual-pubkey pattern eliminates that window by design.

A future "simplify this!" proposal will suggest dropping the rotation key ("it's never used anyway"). This ADR is the answer: the rotation key's value is conditional (you only need it during an incident), but during the incident it's the only thing preventing an ecosystem-wide trust failure.

## References

- `src/main/services/whisper-pubkeys.ts` — the two `readonly` pubkey constants
- `src/main/utils/verifyManifest.ts:99-121` — the dual-key accept loop
- `docs/build/whisper-binaries.md` §"Cert-revocation runbook" — operational procedure when either key is compromised
- Published primary key ID: `4AEBCE8499845646`
- Published rotation key ID: `E8E4B205269790F1`

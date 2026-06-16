// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Erfana minisign public keys for whisper.cpp manifest verification.
 *
 * Consumed by `src/main/utils/verifyManifest.ts` (Branch B, Phase 4 #165).
 * Accept either signature — primary OR rotation — to enable key rotation
 * without bricking existing installs.
 *
 * **Primary key**: lives in CI as `MANIFEST_SIGNING_KEY` secret under the
 * `production-signing` GitHub Environment. Signs every normal
 * `whisper-build-*` release manifest. Key ID `4AEBCE8499845646`.
 *
 * **Rotation key**: kept offline on Marcin's hardware token / air-gapped USB.
 * Only used to sign a revocation manifest if the primary key is compromised.
 * Key ID `E8E4B205269790F1`.
 *
 * Compromise recovery runbook: see
 * `docs/build/whisper-binaries.md` § "Cert-revocation runbook".
 *
 * @see docs/build/whisper-binaries.md
 * @see docs/windows/phase4-binary-spec.md
 */

export interface WhisperPubKey {
  readonly role: 'primary' | 'rotation'
  readonly keyId: string
  /** base64-encoded Ed25519 pubkey as emitted by `minisign -G`. */
  readonly publicKey: string
}

export const WHISPER_PUBKEYS: readonly WhisperPubKey[] = [
  {
    role: 'primary',
    keyId: '4AEBCE8499845646',
    publicKey: 'RWRGVoSZhM7rShmOHr5lmt6v6wH8Tjm/nXItCg46Co+hxgvJFLWkv0fC'
  },
  {
    role: 'rotation',
    keyId: 'E8E4B205269790F1',
    publicKey: 'RWTxkJcmBbLk6J2eWEDWHYcAmgpKfRqO5PR8oRRLUpgn5rgCaWmTvd9w'
  }
] as const

# Local Whisper trust chain architecture

Single diagram + threat-model reference for the 4-layer client-side trust chain that defends Erfana's local whisper.cpp subprocess against tampering. Phase 4, issue [#165](https://github.com/qodeca/erfana/issues/165). For the decision rationale behind each layer, see [ADR 0001](../adrs/0001-self-host-whisper-binaries.md) through [ADR 0004](../adrs/0004-per-spawn-toctou-rehash.md).

## Why the trust chain exists

Whisper.cpp runs as a **child process** with full user-level permissions. A compromised whisper binary = arbitrary code execution with the user's privileges. The trust chain reduces the window where that compromise can occur to the point of theoretical unreachability without kernel-level escalation.

## 4-layer composition

```
                 ┌──────────────────────────────────┐
                 │   Layer 1: Manifest signature    │  (install-time)
                 │   minisign Ed25519, dual-pubkey  │
                 │   verifyManifest.ts              │
                 └──────────────────┬───────────────┘
                                    ▼
                 ┌──────────────────────────────────┐
                 │   Layer 2: Artifact SHA-256 pin  │  (install-time)
                 │   whisper-assets.ts hard-coded   │
                 │   secureDownloader streaming SHA │
                 └──────────────────┬───────────────┘
                                    ▼
                 ┌──────────────────────────────────┐
                 │   Layer 3: Per-spawn re-hash     │  (spawn-time)
                 │   TOCTOU close (<50 ms)          │
                 │   WhisperModelManager.verify…()  │
                 └──────────────────┬───────────────┘
                                    ▼
                 ┌──────────────────────────────────┐
                 │   Layer 4: Monotonic revision    │  (install-time)
                 │   lastSeenRevision sentinel      │
                 │   persisted in userData dir      │
                 └──────────────────────────────────┘
```

Each layer defeats a specific attacker. A full break requires defeating **all four**, including one that's out of reach without kernel-level primitives.

### Layer 1 — Manifest signature verification

- **What it is**: `manifest.json` at every `whisper-build-*` release is minisign Ed25519-signed. Two pubkeys are embedded in `src/main/services/whisper-pubkeys.ts` (primary used in CI; rotation offline on hardware token).
- **What it defeats**: attackers who can upload release assets but **cannot** access the signing key. GitHub releases have separate permissions from repo-secret access.
- **Where it lives**: `src/main/utils/verifyManifest.ts`, consumed by `WhisperModelManager.ensureBinary()`.
- **Trust root**: the pubkeys embedded at Erfana compile time. The signing key is a separately-custody'd asset.
- **Design choice**: see [ADR 0002](../adrs/0002-minisign-over-cosign-sigstore.md) for minisign-over-cosign rationale, [ADR 0003](../adrs/0003-dual-pubkey-trust-primary-rotation.md) for dual-pubkey rotation.

### Layer 2 — Artifact SHA-256 pin

- **What it is**: `src/main/services/whisper-assets.ts` hard-codes the expected SHA-256 of each platform's artifact (`whisper-macos-universal-*.tar.gz`, `whisper-win-x64-*.zip`) **AND** each file inside (`whisper-cli`, `whisper.exe`, `whisper.dll`, `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll`). The manifest's per-platform SHA is cross-checked against this source pin; mismatch = `WHISPER_SOURCE_PIN_DRIFT`.
- **What it defeats**: attackers who compromise the signing key (Layer 1 broken) but can't also modify the Erfana source tree. A signed-but-tampered binary is caught by the pin.
- **Where it lives**: `whisper-assets.ts` constants + `WhisperModelManager.verifyAllFiles()` (post-extract) + `SecureDownloader` streaming SHA check (during download).
- **Source-drift guard**: if the manifest SHA doesn't match our pin, `ensureBinary()` throws `WHISPER_SOURCE_PIN_DRIFT` with a specific "update `whisper-assets.ts`" message. Fail-closed by design.
- **Design choice**: see [ADR 0001](../adrs/0001-self-host-whisper-binaries.md) — self-hosting lets us control the pin in lock-step with the release.

### Layer 3 — Per-spawn re-hash (TOCTOU close)

- **What it is**: `{userData}/whisper/bin/` is user-writable. Between install-time verification (Layers 1+2) and spawn-time execution, an attacker with local write access can swap the binary. Layer 3 closes that window by re-hashing every pinned file (main + 4 sidecars) immediately before every `spawn()` — including per-chunk in a chunked transcription.
- **What it defeats**: swap-at-rest attacks by user-space malware. Attacker would need to win a <50 ms race between `verifyInstalledBinary()` returning and `spawn()` creating the child — infeasible without kernel-level primitives.
- **Where it lives**: `LocalWhisperService.runWhisper()` calls `WhisperModelManager.verifyInstalledBinary()` which returns `{spec, mainSha, revisionIndex}` and emits `logger.info('Whisper spawn', {...})` with the forensic 5-tuple.
- **Cost**: ~50 ms per spawn (2.3 MB streaming SHA on Windows = main + 4 DLLs; ~1.8 MB on macOS = universal binary only). Per-chunk cost amortised negligibly against inference time.
- **Design choice**: see [ADR 0004](../adrs/0004-per-spawn-toctou-rehash.md) for the per-spawn-vs-cached trade-off.

### Layer 4 — Monotonic revision floor

- **What it is**: `manifest.revisionIndex` must be `≥ max(MIN_REVISION_INDEX, persisted lastSeenRevision)`. `lastSeenRevision` is a sentinel file in `{userData}/whisper/.last-seen-revision` that records the highest revision this install has ever successfully fetched.
- **What it defeats**: manifest-replay attacks where an attacker serves a **legitimately-signed-but-superseded** manifest (e.g. pre-revocation, pre-security-patch). Signature verifies (Layer 1 OK), artifact matches pin (Layer 2 OK), but the revision is below the monotonic floor.
- **Where it lives**: `WhisperModelManager.ensureBinary()` guard at line 322 (downgrade block), sentinel read/write at `readLastSeenRevision()` / `writeLastSeenRevision()`.
- **Error**: `WHISPER_DOWNGRADE_BLOCKED` with message "below floor <N>".
- **Support case for stuck users**: see [`whisper-support-runbook.md`](whisper-support-runbook.md) §`WHISPER_DOWNGRADE_BLOCKED`.

## Sequence: install → first spawn → Nth spawn

```
User enables Local Whisper → Download model
│
├─ 1. GET manifest.json                      (Layer 1)
├─ 2. GET manifest.json.minisig              (Layer 1)
├─ 3. verifyManifest() [dual-pubkey]         (Layer 1) ──► WHISPER_MANIFEST_INVALID on fail
├─ 4. revisionIndex ≥ floor                  (Layer 4) ──► WHISPER_DOWNGRADE_BLOCKED on fail
├─ 5. manifest SHA == source pin             (Layer 2) ──► WHISPER_SOURCE_PIN_DRIFT on fail
├─ 6. GET archive (streaming SHA verify)     (Layer 2) ──► archive SHA mismatch = SecureDownloaderError
├─ 7. Extract zipArchive.unzip / tarArchive.untarGz
├─ 8. Strip MOTW / com.apple.quarantine
├─ 9. verifyAllFiles() [streaming per-file]  (Layer 2) ──► WHISPER_BINARY_TAMPERED on fail
└─ 10. Write .schema-version + .last-seen-revision

User triggers transcription → first spawn
│
├─ 1. checkCpuSupport()                                ──► WHISPER_CPU_UNSUPPORTED on fail
├─ 2. validateAudioPath()                              ──► WHISPER_INVALID_PATH on fail
├─ 3. verifyInstalledBinary()                (Layer 3) ──► WHISPER_BINARY_TAMPERED on fail
│    returns { spec, mainSha, revisionIndex }
├─ 4. logger.info('Whisper spawn', forensic 5-tuple)
└─ 5. spawn(binaryPath, args, { cwd: binDir on Windows })

Nth spawn (chunked transcription)
│
├─ 1. verifyInstalledBinary()                (Layer 3, again)
├─ 2. logger.info('Whisper spawn', forensic 5-tuple)
└─ 3. spawn(...)
```

## Attacker model

The trust chain explicitly defends against:

| Attacker | Capability | Defeated by |
|----------|-----------|-------------|
| **Release-asset-overwrite attacker** | GitHub release write, no signing key | Layer 1 (sig verify) |
| **Signing-key compromise attacker** | Has signing key, no source-repo write | Layer 2 (source pin) |
| **Local-write attacker** | User-space write to `{userData}/whisper/bin/` | Layer 3 (TOCTOU close) |
| **Replay attacker** | Can serve a validly-signed but older manifest | Layer 4 (monotonic floor) |

The trust chain does **NOT** defend against:

| Attacker | Capability | Why out of scope |
|----------|-----------|------------------|
| **Full repo-compromise attacker** | Has signing key AND source-repo write | Full emergency response (both keys rotated); see [ADR 0003](../adrs/0003-dual-pubkey-trust-primary-rotation.md) worst-case |
| **Kernel-level attacker** | Can racy-swap between `fstat` and `execve` | Out of scope — can bypass any user-space verification |
| **Install-time attacker** | Controls user's `{userData}/whisper/.schema-version` and `.last-seen-revision` at first boot | Low-value — attacker with that level of access can do worse things directly |
| **CPU-level attacker** | Row-hammer / Spectre-class | Out of scope for anti-tampering |

## Layer → error code map

| Layer | Error code | User-facing message | Where raised |
|-------|-----------|---------------------|--------------|
| 1 | `WHISPER_MANIFEST_INVALID` | "The local Whisper release manifest could not be verified..." | `verifyManifest()` rejection, malformed signature, JSON parse failure |
| 2 | `WHISPER_SOURCE_PIN_DRIFT` | "The local Whisper release on GitHub does not match..." | Manifest SHA vs source pin mismatch |
| 2 | `WHISPER_BINARY_DOWNLOAD_FAILED` | "Failed to download whisper binary..." | Streaming SHA mismatch during download |
| 2 | `WHISPER_BINARY_TAMPERED` | "The local Whisper binary on disk has been modified..." | Post-extract `verifyAllFiles()` mismatch |
| 3 | `WHISPER_BINARY_TAMPERED` | (same) | Pre-spawn `verifyInstalledBinary()` mismatch — the TOCTOU close |
| 4 | `WHISPER_DOWNGRADE_BLOCKED` | "A newer local Whisper build was already installed here..." | Monotonic floor violation |

See [`docs/error-codes.md`](../error-codes.md) §"Local Whisper" for the full enum index.

## Future work

- **Correlation-ID grouping** between install-time and spawn-time forensic logs. Tracked as D9 in [`deferred-work-phase4.md`](deferred-work-phase4.md). Today the 7-tuple plan commitment is split into install-time keys (logged once at install-complete) and spawn-time keys (logged every spawn). Correlation ID would let operators join the two events.
- **Windows code-signing** for `whisper.exe` + DLLs — Phase 5, [#166](https://github.com/qodeca/erfana/issues/166). SHA-256 pin is the current trust anchor; Authenticode + SmartScreen become the UX-layer reinforcement.
- **OIDC-backed CI signing** — tracked as Phase 5 follow-up in [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md). Would replace the primary-key-as-secret pattern with short-lived GitHub OIDC tokens.

## Related

- [`docs/error-codes.md`](../error-codes.md) — full enum index, including Layer → error mappings
- [`docs/windows/whisper-support-runbook.md`](whisper-support-runbook.md) — operator playbook per error class
- [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md) — CI / rebuild / cert-revocation operations
- [`docs/adrs/0001-self-host-whisper-binaries.md`](../adrs/0001-self-host-whisper-binaries.md) — self-host decision
- [`docs/adrs/0002-minisign-over-cosign-sigstore.md`](../adrs/0002-minisign-over-cosign-sigstore.md) — minisign choice
- [`docs/adrs/0003-dual-pubkey-trust-primary-rotation.md`](../adrs/0003-dual-pubkey-trust-primary-rotation.md) — dual-pubkey rotation
- [`docs/adrs/0004-per-spawn-toctou-rehash.md`](../adrs/0004-per-spawn-toctou-rehash.md) — Layer 3 per-spawn re-hash decision
- `src/main/utils/verifyManifest.ts` — Layer 1 implementation
- `src/main/services/whisper-assets.ts` / `whisper-pubkeys.ts` — Layer 2 pins + pubkeys
- `src/main/services/WhisperModelManager.ts` — Layers 2, 3, 4 enforcement
- `src/main/services/LocalWhisperService.ts` — Layer 3 consumer + argv hardening + CPU probe

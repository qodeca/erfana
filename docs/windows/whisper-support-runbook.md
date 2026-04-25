# Local Whisper – support & diagnostics runbook

Operator playbook for the 3 whisper error classes most likely to surface in the field, plus rarer edge cases. For CI / build side (how binaries get made), see [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md). For the full error-code index, see [`docs/error-codes.md`](../error-codes.md) §"Local Whisper".

**When to consult this doc**: a user reports "local transcription broken / crashed / won't start" and the error code is one of the `WHISPER_*` codes. Ask for logs first; this runbook tells you what to ask for and what the answer looks like.

---

## Where user logs live

| Platform | Main process log |
|----------|------------------|
| macOS | `~/Library/Logs/erfana/main.log` |
| Windows | `%APPDATA%\erfana\logs\main.log` (typically `C:\Users\<name>\AppData\Roaming\erfana\logs\main.log`) |
| Linux | `~/.config/erfana/logs/main.log` (Erfana is not Linux-shipped but the path exists for dev builds) |

See `docs/logging.md` for log rotation + levels. The Settings → Logging panel has an "Open logs folder" button that resolves the correct path per platform.

**Ask the user to**: (a) reproduce the failure, (b) open the logs folder, (c) grep `main.log` for `WHISPER` or for the specific code, (d) attach the surrounding ~50 lines. The forensic INFO log (`Whisper spawn`, `Whisper binary installed`, `Whisper manifest signature verified`) is at INFO level — visible even on default log settings.

---

## `WHISPER_MANIFEST_INVALID`

**User-visible message**: "The local Whisper release manifest could not be verified. The download is blocked to protect integrity — please try again later or update Erfana."

**What's happening**: `src/main/utils/verifyManifest.ts` rejected the signature on `manifest.json`. Possible causes:

1. **Transient** — GitHub Release CDN served a partial / corrupt file. Retry usually works.
2. **Erfana too old** — manifest was signed with a primary key whose pubkey isn't in this version's `whisper-pubkeys.ts`. User needs to update Erfana.
3. **Actual supply-chain compromise** — someone with release-write access but not signing-key access uploaded a tampered manifest. The trust chain caught it. Treat as security incident.
4. **Corrupted `.minisig` or `.json` file on disk** — user's partial download didn't finish; new attempt overwrites.

**Diagnostic steps**

```
# User: send the manifest verify log line from main.log
# Expected healthy shape:
INFO: Whisper manifest signature verified
  signingKeyRole: "primary"  (or "rotation")
  signingKeyId: "4AEBCE8499845646"  (primary, see whisper-pubkeys.ts)

# Failure shape (one of):
ERROR: ... code: "WHISPER_MANIFEST_INVALID"
  message: "signature verification failed for both keys" / "malformed signature header" / "JSON parse failed"
```

**Operator actions**

| Symptom | Action |
|---------|--------|
| First occurrence for this user, no other reports | Ask to retry. Likely transient. |
| Multiple users with same Erfana version, specific release tag | Check the release on GitHub — did someone re-upload assets? Re-publish the release if so. |
| Only users on old Erfana versions | Expected — they don't have the current pubkey. User needs to update. |
| Multiple users across versions simultaneously | **Potential supply-chain incident.** Disable the release (pre-release → draft), notify security, verify the signing key hasn't rotated. See [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md) §"Cert-revocation runbook" |

**Don't do**: tell the user to delete `{userData}/whisper/` wholesale — this trashes their downloaded models. Only the `.minisig` + `manifest.json` temp files in `tmpdir()` need resetting, and `ensureBinary()` does that on failure automatically.

---

## `WHISPER_DOWNGRADE_BLOCKED`

**User-visible message**: "A newer local Whisper build was already installed here; refusing to replace it with an older one. Update Erfana to pick up the newest release."

**What's happening**: `manifest.revisionIndex` is strictly below the effective floor `max(MIN_REVISION_INDEX, lastSeenRevision)`. The persisted `lastSeenRevision` sentinel records the highest revision this install has ever successfully fetched. Replaying an older manifest gets rejected.

**Legitimate stuck-user scenarios** (not attack scenarios):

1. **Backup-restore / machine migration** — user restored their `%APPDATA%\erfana\` folder from a backup that included a higher `.last-seen-revision` than the current release on GitHub. Rare but real for IT-managed / Intune-managed Windows deployments.
2. **Corporate rollback** — IT rolled Erfana back from a future version that had pinned a higher revision. The old Erfana's `MIN_REVISION_INDEX` is below the sentinel; legitimate replay.
3. **Dev / test installs** — internal builder pointed at a prerelease that later got rescinded.

**Diagnostic steps**

```
# User: read the value of the sentinel file
macOS:   cat ~/Library/Application\ Support/erfana/whisper/.last-seen-revision
Windows: type %APPDATA%\erfana\whisper\.last-seen-revision

# Compare to the current release's revisionIndex in manifest.json
#   (fetch from https://github.com/qodeca/erfana/releases/tag/whisper-build-<label>-erfana<N>)
```

**Operator actions**

| Case | Action |
|------|--------|
| Sentinel value > current release revision, legitimate reason | Safe to delete the sentinel file: `rm {userData}/whisper/.last-seen-revision`. Then retry — `ensureBinary()` accepts the manifest (still signature-verified, still SHA-pinned) and rewrites the sentinel. |
| Sentinel value > current release revision, NO legitimate reason | **Potential attack.** Don't reset. Investigate: did someone ship a rogue Erfana build that pinned a higher revision? Check `MIN_REVISION_INDEX` across shipped versions. |
| Sentinel value equals `MIN_REVISION_INDEX`, user still sees the error | Misdiagnosis — the code is `≥` not `>`. Check the actual error message (which reports the floor). Likely a different failure. |

**Safety note**: deleting `.last-seen-revision` does NOT bypass the other trust-chain layers. The manifest still must pass signature verification (ADR 0002) and the artifact must still match the SHA pin in `whisper-assets.ts`. Resetting the sentinel only removes the **monotonic** floor, not the **source-pinned** floor.

---

## `WHISPER_CPU_UNSUPPORTED`

**User-visible message**: "Your CPU lacks the instruction-set features local Whisper requires. Use the OpenAI API backend instead."

**What's happening**: one of two paths:

1. **Pre-flight probe hit** — `checkCpuSupport()` in `src/main/services/LocalWhisperService.ts` matched one of the regex patterns in `CPU_MODEL_DENYLIST` (Core 2, Pentium 4/D/III/M, Celeron D, Athlon 64/II, Phenom, Sempron, Turion 64, Opteron 2). No spawn happened.
2. **Runtime SIGILL** — Whisper.cpp crashed with `STATUS_ILLEGAL_INSTRUCTION` (Windows exit code 0xC000001D) or SIGILL (POSIX exit 132). Used by CPUs that slipped past the denylist but actually lack SSE4.2.

**Legitimate case**: CPU is really old. User should use OpenAI API backend. This is ~12+ years of Intel / AMD hardware — uncommon but not unheard of.

**False-positive case** (regex over-matches a modern CPU brand):

- **Suspicious brand strings**: OEM-relabeled embedded boards, virtualised environments, niche CPUs where the brand string contains a substring like "Phenom" or "Core 2" unexpectedly.

**Diagnostic steps**

```
# Ask the user to paste the CPU model:
Node.js REPL (or embedded in dev tools):
  require('os').cpus()[0].model

# Expected modern shape:
  "Intel(R) Core(TM) i7-8700K CPU @ 3.70 GHz"
  "AMD Ryzen 9 5950X 16-Core Processor"
  "Apple M2 Pro"

# Known-rejected shapes (correct behaviour):
  "Intel(R) Core(TM)2 Duo CPU E8400 @ 3.00 GHz"
  "Intel(R) Pentium(R) 4 CPU 3.00 GHz"
  "AMD Phenom(tm) II X4 965"
```

**Operator actions**

| Brand string | Action |
|--------------|--------|
| Matches denylist, CPU confirmed pre-2013 | Expected behaviour. User → OpenAI API backend. Document in support ticket. |
| Matches denylist, user insists CPU is modern | Collect the exact `os.cpus()[0].model` string. File an issue citing `LocalWhisperService.ts:103-118` (the `CPU_MODEL_DENYLIST` regex table). Refine the regex to exclude the false-positive. Workaround for user: OpenAI backend until fix ships. |
| Does NOT match denylist but user hit runtime SIGILL | CPU genuinely lacks SSE4.2 but has a modern brand string. Add the brand to denylist for cleaner UX. User action same as above. |

The denylist is intentionally conservative — it's better to reject a supported CPU we don't recognise (one user uses OpenAI API instead) than to let an unsupported CPU through (full ~200 MB download + crash).

---

## Rarer edge cases

### `WHISPER_BINARY_TAMPERED`

Thrown by `WhisperModelManager.verifyAllFiles()` on SHA-256 mismatch. Two throw paths:

1. **Post-extract** — just-extracted file's SHA doesn't match the pin. Usually a transient download issue; `ensureBinary()` catches, wipes `bin/`, and the next attempt re-extracts.
2. **Pre-spawn TOCTOU close** — binary on disk was modified **between** install and spawn. See [ADR 0004](../adrs/0004-per-spawn-toctou-rehash.md).

**Operator action**: if post-extract, ask the user to retry (transient). If pre-spawn and repeated: **malware alert** — suggest a malware scan of the user's machine. The `{userData}/whisper/bin/` directory is user-writable; swap-at-rest is a real threat this error catches.

### `WHISPER_SOURCE_PIN_DRIFT`

Thrown when the manifest's per-platform SHA doesn't match our hard-coded source pin in `whisper-assets.ts`. This is almost always **our** fault — the release got re-uploaded with different content, or we forgot to bump `whisper-assets.ts` in lock-step.

**Operator action**: this is a developer bug, not a user bug. Investigate: did someone overwrite the release? If so, re-publish with a new `erfana_revision` (see [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md) §"Bumping the app-side pin"). Never tell a user to "ignore" this — they can't; it's fail-closed by design.

### `WHISPER_INVALID_PATH`

Thrown by `validateAudioPath()` when the user-supplied filepath fails argv hardening: UNC paths (`\\server\share\...`), Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`), NTFS alternate-data-stream colons (`file.wav:evil`).

**Operator action**: ask the user to rename the file or move it off a network share. `validateAudioPath` is deliberately strict; we chose "reject and explain" over "sanitise and silently succeed".

---

## Verifying a release as an end-user / IT admin

If a user or IT admin asks "is my whisper download tampered?", the quickest answer:

```bash
# macOS / Linux
cd ~/Library/Application\ Support/erfana/whisper/bin/    # macOS path
shasum -a 256 whisper-cli
# Compare output to the SHA in docs/windows/phase4-binary-spec.md for the pinned release

# Windows PowerShell
cd $env:APPDATA\erfana\whisper\bin\
Get-FileHash whisper.exe -Algorithm SHA256
# Compare to phase4-binary-spec.md
```

If mismatch: ask the user to delete `{userData}/whisper/bin/` and restart Erfana (models are preserved; only the binary re-downloads).

---

## Canary workflow: confirming our creds work

The monthly canary (`.github/workflows/whisper-binaries-canary.yml`) probes Apple notarization + Windows signtool credentials. Operator-facing:

### Manual dry-run

```
gh workflow run whisper-binaries-canary.yml --repo qodeca/erfana
```

### Healthy `macos-notarization-canary` output looks like

```
Run xcrun notarytool history ...
{"history":[{"id":"...","createdDate":"...","name":"...","status":"Accepted"...}]}
jq -e 'has("history")' → exit 0
notarytool history probe succeeded.
```

### Failure signals

- **Non-zero exit from `notarytool history`** → Apple app-specific password rotated out. Regenerate at https://appleid.apple.com, update `APPLE_APP_PASSWORD` secret in `production-signing` environment.
- **`jq` assertion failed** → notarytool returned a non-JSON error (network or server-side). Retry; if persistent, check Apple Developer status page.
- **`signtool.exe not found`** → Windows runner image regressed. File an issue to pin the runner image version.

The `notify-on-failure` job auto-creates a GitHub issue titled `[canary] whisper-binaries credential health failure <date>`. First-tier response: comment "investigating" and walk through the above signal list.

---

## Escalation path

1. **Single user, first occurrence**: most whisper errors are transient. Retry + move on.
2. **Multiple users, same Erfana version**: likely a release-side issue. Check GitHub Release, CI history, canary status.
3. **Multiple users, multiple Erfana versions**: architectural issue or supply-chain incident. Escalate to Marcin; reference this runbook + [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md) §"Cert-revocation runbook".
4. **CPU-unsupported false-positive**: code fix to `CPU_MODEL_DENYLIST` regex. User → OpenAI API until fix ships.

---

## Related

- [`docs/error-codes.md`](../error-codes.md) §"Local Whisper" — the full 13-code index
- [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md) — CI / rebuild / cert-revocation operations
- [`docs/adrs/0001-self-host-whisper-binaries.md`](../adrs/0001-self-host-whisper-binaries.md) — why self-hosted
- [`docs/adrs/0002-minisign-over-cosign-sigstore.md`](../adrs/0002-minisign-over-cosign-sigstore.md) — why minisign
- [`docs/adrs/0003-dual-pubkey-trust-primary-rotation.md`](../adrs/0003-dual-pubkey-trust-primary-rotation.md) — dual-pubkey rationale + rotation mechanics
- [`docs/adrs/0004-per-spawn-toctou-rehash.md`](../adrs/0004-per-spawn-toctou-rehash.md) — why the SHA re-hashes before every spawn
- [`docs/known-issues.md`](../known-issues.md) §"Local Whisper" — user-facing known-limits entries
- `src/main/services/LocalWhisperService.ts`, `WhisperModelManager.ts`, `whisper-assets.ts`, `whisper-pubkeys.ts`
- `src/main/utils/verifyManifest.ts` — the signature verifier

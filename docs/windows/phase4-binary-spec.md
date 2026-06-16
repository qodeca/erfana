# Phase 4 binary spec — whisper.cpp

Authoritative record of the whisper.cpp binary release currently pinned by Erfana. Update this file every time `src/main/services/whisper-assets.ts` advances to a new `whisper-build-*` tag.

See [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md) for the rebuild runbook.

## Currently pinned

| Field | Value |
|---|---|
| Upstream repo | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| Upstream label | `v1.8.4` |
| Upstream commit SHA | `9386f239401074690479731c1e41683fbbeac557` |
| Erfana revision | `1` |
| Release tag | `whisper-build-v1.8.4-erfana1` |
| Release URL | https://github.com/qodeca/erfana/releases/tag/whisper-build-v1.8.4-erfana1 |
| Built at | `2026-04-22T16:38:16Z` |
| Workflow run | [24790206935](https://github.com/qodeca/erfana/actions/runs/24790206935) |
| Workflow commit SHA | `961a031344a0cbcc88aec4d74ddbf37282b0795f` |
| Manifest signing key | primary (key ID `4AEBCE8499845646`) |

## Artifacts

### macOS universal

| Field | Value |
|---|---|
| Filename | `whisper-macos-universal-v1.8.4-erfana1.tar.gz` |
| Archive SHA-256 | `78fa53c26f62da7f842def18f57338908641449fcee5da533037237d09bc696b` |
| Size | 744,152 bytes (~727 KB) |
| Architectures | arm64 + x86_64 (universal) |
| Signing | Developer ID Application (Apple) + notarized |

Contained files (flat inside the tarball):

| File | Size | SHA-256 |
|---|---|---|
| `whisper-cli` | 1,778,400 | `ff6de29f7a5581bea65a87c2437aabc8085cd21a6c476e78e11bc81b1edd8b9f` |
| `LICENSE.whisper-cpp` | 1,078 | `94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d` |
| `NOTICE.md` | 723 | `bb67a07b76afd5c7e67f2ecea06cbc08c7e70031cf25569fdfd3d8585b7089b8` |

### Windows x64

| Field | Value |
|---|---|
| Filename | `whisper-win-x64-v1.8.4-erfana1.zip` |
| Archive SHA-256 | `8e3c63e8e7112e3f04304a4d58937696d72881d88ad0c436665e194b7af846f1` |
| Size | 909,525 bytes (~888 KB) |
| Signing | **Unsigned** (Phase 4); Phase 5 procures OV cert |

Contained files (flat inside the zip — 4 sidecar DLLs + binary + docs):

| File | Size | SHA-256 |
|---|---|---|
| `whisper.exe` | 485,888 | `66caae86a60256b2fcde8d518a778608cb092554a173a6859cae080b0d3c4d6c` |
| `whisper.dll` | 483,840 | `d3ab5b3356d5233640de9e972c62ac1af674cbd3c696084aed5261db5b442824` |
| `ggml.dll` | 67,072 | `08cafe44fbb8f463e77421f60cc57a6afa6cac8403a0281f7dedbeb9e68ab900` |
| `ggml-base.dll` | 549,376 | `26e62b452554e22f9125e966975da37e1ec8119d3b09e67b6cd00999348ee40d` |
| `ggml-cpu.dll` | 774,144 | `eeea48c0ae3c7c375fd197ef865a38cc280ba3da5499d559aade473835557980` |
| `LICENSE.whisper-cpp` | 1,099 | `bcd8ec749126d45cb06737d0690295d73df4b6e7e194205bcf91190368f27285` |
| `NOTICE.md` | 470 | `0f03188239193a9021098fc2efa668bcb0a4f7c9bee431c4e1b565e734e13e99` |

The 4 DLLs are the **sidecar integrity set** — `WhisperModelManager.isBinaryInstalled()` verifies each one's SHA-256 on every startup; `LocalWhisperService.transcribe()` re-hashes them pre-spawn (TOCTOU close).

### Manifest

| Field | Value |
|---|---|
| Filename | `manifest.json` + `manifest.json.minisig` |
| `revisionIndex` | `1` |
| Signed by | Primary minisign key (`4AEBCE8499845646`) |
| schemaVersion | 1 |

Full manifest:

```json
{
  "schemaVersion": 1,
  "revisionIndex": 1,
  "upstream": {
    "sha": "9386f239401074690479731c1e41683fbbeac557",
    "label": "v1.8.4"
  },
  "erfanaRevision": 1,
  "builtAt": "2026-04-22T16:38:16Z",
  "workflowRunUrl": "https://github.com/qodeca/erfana/actions/runs/24790206935",
  "workflowCommitSha": "961a031344a0cbcc88aec4d74ddbf37282b0795f",
  "artifacts": {
    "macosUniversal": {
      "filename": "whisper-macos-universal-v1.8.4-erfana1.tar.gz",
      "sha256": "78fa53c26f62da7f842def18f57338908641449fcee5da533037237d09bc696b",
      "size": 744152
    },
    "win64": {
      "filename": "whisper-win-x64-v1.8.4-erfana1.zip",
      "sha256": "8e3c63e8e7112e3f04304a4d58937696d72881d88ad0c436665e194b7af846f1",
      "size": 909525
    }
  },
  "signingKey": "primary"
}
```

## Erfana-side consumption

`src/main/services/whisper-assets.ts` pins:

1. The release tag → URL base (`https://github.com/qodeca/erfana/releases/download/whisper-build-v1.8.4-erfana1`).
2. Per-platform filename + expected SHA-256.
3. Per-platform sidecar filenames + each sidecar's expected SHA-256 (Windows: 4 DLLs).
4. Minimum accepted `revisionIndex` (`1` initially; bumps with each new pin).
5. Two embedded minisign public keys (primary + rotation) — `src/main/services/whisper-pubkeys.ts`.

On app startup / first transcription:

1. Fetch `manifest.json` + `manifest.json.minisig` → verify signature against either pubkey.
2. Assert manifest `revisionIndex` ≥ persisted `lastSeenRevision` (downgrade block).
3. Assert manifest's per-platform SHA-256 matches Erfana source pin (catches a signed-but-wrong-build drift).
4. Download artifact → verify SHA-256 → extract (`zipArchive.unzip` for Windows, `tarArchive.untarGz` for macOS).
5. Strip MOTW (`Zone.Identifier` on Windows) / `com.apple.quarantine` (macOS) post-extraction.
6. Hash every sidecar DLL on Windows; verify each against pin.
7. Re-hash main binary + sidecars immediately before every `spawn()` (TOCTOU).

## First-run verification evidence

Run `24790206935` end-to-end result:

| Job | Status | Duration |
|---|---|---|
| macOS universal build (signed + notarized + smoke-tested) | ✅ | ~2 min |
| Windows x64 build (signed as Phase 5 pending; packaged + round-trip) | ✅ | ~6 min |
| Publish release (manifest signed + 6 assets uploaded) | ✅ | ~35 s |

Remote asset digests (reported by GitHub Releases API, cross-checked against manifest + local sha256sum — all match):

- `manifest.json` server digest: `sha256:45a7f920ee41633c79aa5d62d0ac2eb1eb55baff037a2540084fc28468b3bd6c`
- `manifest.json.minisig` server digest: `sha256:9bb736d4c8873c865448543caa268ca6be5a21a8890799e7d44cc68da6c80b86`

## Upstream SHA diff-review (required for every bump)

Before bumping to a new upstream commit SHA:

```bash
git clone --bare https://github.com/ggml-org/whisper.cpp.git /tmp/whisper-upstream
cd /tmp/whisper-upstream
git log --oneline <old-SHA>..<new-SHA>
git diff --stat <old-SHA>..<new-SHA>
```

Review checklist: see [`docs/build/whisper-binaries.md#diff-review-checklist-every-upstream-bump`](../build/whisper-binaries.md#diff-review-checklist-every-upstream-bump).

## CPU-unsupported exit-code contract (POSIX vs Win32)

`src/main/services/LocalWhisperService.ts:831-843` branches the CPU-unsupported detection on `process.platform === 'win32'` and reads from `WIN32_CPU_UNSUPPORTED_EXIT_CODES` or `POSIX_CPU_UNSUPPORTED_EXIT_CODES` accordingly. The `POSIX_*` set is currently **macOS-only by accident-of-support**: `classifyPlatform()` in `whisper-assets.ts:171-201` rejects Linux outright with a `WHISPER_UNSUPPORTED_PLATFORM` reason, so the POSIX path never actually executes against a Linux SIGILL today.

Any future Linux enablement must validate the `POSIX_CPU_UNSUPPORTED_EXIT_CODES` set against Linux SIGILL exit codes before unlocking the platform; the macOS values are not guaranteed to match. The branch is correct today; the contract is just implicit.

## History

| Erfana app versions | Pinned whisper build | Date pinned | Notes |
|---|---|---|---|
| `0.9.4`+ | `whisper-build-v1.8.4-erfana1` | 2026-04-22 | First Windows + macOS release under Option A (#165) — upstream `9386f239` (v1.8.4) |

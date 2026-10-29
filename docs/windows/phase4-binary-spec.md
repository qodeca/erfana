# Phase 4 binary spec — whisper.cpp

> **Note**: in the `erfana1` sections (the retired pin and its first-run evidence), issue and PR numbers, commit SHAs, release tags and CI run links predate the 2026-06 open-source migration and no longer resolve on `qodeca/erfana`; they are retained as provenance.

Authoritative record of the whisper.cpp binary release currently pinned by Erfana. Update this file every time `src/main/services/whisper-assets.ts` advances to a new `whisper-build-*` tag.

See [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md) for the rebuild runbook.

## Currently pinned

| Field | Value |
|---|---|
| Upstream repo | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| Upstream label | `v1.8.4` |
| Upstream commit SHA | `9386f239401074690479731c1e41683fbbeac557` |
| Erfana revision | `2` |
| Release tag | `whisper-build-v1.8.4-erfana2` |
| Release URL | https://github.com/qodeca/erfana/releases/tag/whisper-build-v1.8.4-erfana2 |
| Built at | `2026-10-24T15:35:05Z` |
| Workflow run | [40104989427](https://github.com/qodeca/erfana/actions/runs/40104989427) |
| Workflow commit SHA | `b012b7c2df376b093fc5f9c2c835ddd2177212f0` |
| Manifest signing key | primary (key ID `4AEBCE8499845646`) |

Why this pin exists: the `erfana1` macOS `whisper-cli` was a shared build whose dylibs were not in the tarball, so local transcription could not start on users' Macs. `erfana2` is the first build from the static macOS workflow (PR #363: `-DBUILD_SHARED_LIBS=OFF`, `-DGGML_OPENMP=OFF`). Same upstream commit as `erfana1`.

## Artifacts

### macOS universal

| Field | Value |
|---|---|
| Filename | `whisper-macos-universal-v1.8.4-erfana2.tar.gz` |
| Archive SHA-256 | `2f73a24866acbd7f446344856cc1a86112cd0235e31480117c54cfa499514ab2` |
| Size | 2,361,432 bytes (~2.3 MB) |
| Architectures | arm64 + x86_64 (universal) |
| Signing | Developer ID Application (Apple, team `DZ477VK57L`) + notarized, hardened runtime |
| Linkage | static – `otool -L` lists only `/usr/lib/` and `/System/Library/` entries on both slices |

Contained files (flat inside the tarball, no sidecars):

| File | Size | SHA-256 |
|---|---|---|
| `whisper-cli` | 6,387,792 | `e533e2ae396115788235a2d0fd175cbed288f25dbd03d4c7be68c39de993c0de` |
| `LICENSE.whisper-cpp` | 1,078 | `94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d` |
| `NOTICE.md` | 723 | `17316464efb1ced417caa6e97681d58ac7196f5444aa742faf1aadbbf33aa1b6` |

### Windows x64

| Field | Value |
|---|---|
| Filename | `whisper-win-x64-v1.8.4-erfana2.zip` |
| Archive SHA-256 | `f4a459133c29911e484146917c1ada49aac8668d734db8c300a820be11be36f2` |
| Size | 1,014,883 bytes (~991 KB) |
| Signing | **Unsigned** (Phase 4); Phase 5 procures OV cert |

Contained files (flat inside the zip – 4 sidecar DLLs + binary + docs). The file set is the same as `erfana1`; every hash and size changed because the binaries were rebuilt:

| File | Size | SHA-256 |
|---|---|---|
| `whisper.exe` | 475,136 | `e24ea8774875dd47bc5f7c64ade9ade7513c4bfeabfca504381da80ae9d10b06` |
| `whisper.dll` | 1,364,480 | `2cfc88565c5b725aa8621203e5764b89671880dad446f08b93ab2cf3ec979cba` |
| `ggml.dll` | 68,608 | `606684847089843116b749cca2b8554b58b7ca231dea77bc5c8023f4aac416a2` |
| `ggml-base.dll` | 565,248 | `732b316c65981f191df7d66162f2890c220d0a1eea28615c5936c26af265e7fc` |
| `ggml-cpu.dll` | 776,704 | `5ee7263411f5e1f46d033530ed6572460040e2ab2f938bc11fd7366ca39dd6c5` |
| `LICENSE.whisper-cpp` | 1,099 | `bcd8ec749126d45cb06737d0690295d73df4b6e7e194205bcf91190368f27285` |
| `NOTICE.md` | 470 | `e05fe0b5480fcca3e9a7968c5a574ee8b86596fb49338525b5a94c897c0192c5` |

The 4 DLLs are the **sidecar integrity set** – `WhisperModelManager.isBinaryInstalled()` verifies each one's SHA-256 every time `ensureBinary()` runs (the Settings download and the start of each transcription); `LocalWhisperService.runWhisper()` re-hashes them pre-spawn (TOCTOU close).

### Manifest

| Field | Value |
|---|---|
| Filename | `manifest.json` + `manifest.json.minisig` |
| `revisionIndex` | `2` |
| Signed by | Primary minisign key (`4AEBCE8499845646`) |
| schemaVersion | 1 |

Full manifest:

```json
{
  "schemaVersion": 1,
  "revisionIndex": 2,
  "upstream": {
    "sha": "9386f239401074690479731c1e41683fbbeac557",
    "label": "v1.8.4"
  },
  "erfanaRevision": 2,
  "builtAt": "2026-10-24T15:35:05Z",
  "workflowRunUrl": "https://github.com/qodeca/erfana/actions/runs/40104989427",
  "workflowCommitSha": "b012b7c2df376b093fc5f9c2c835ddd2177212f0",
  "artifacts": {
    "macosUniversal": {
      "filename": "whisper-macos-universal-v1.8.4-erfana2.tar.gz",
      "sha256": "2f73a24866acbd7f446344856cc1a86112cd0235e31480117c54cfa499514ab2",
      "size": 2361432
    },
    "win64": {
      "filename": "whisper-win-x64-v1.8.4-erfana2.zip",
      "sha256": "f4a459133c29911e484146917c1ada49aac8668d734db8c300a820be11be36f2",
      "size": 1014883
    }
  },
  "signingKey": "primary"
}
```

## Erfana-side consumption

`src/main/services/whisper-assets.ts` pins:

1. The release tag → URL base (`https://github.com/qodeca/erfana/releases/download/whisper-build-v1.8.4-erfana2`).
2. Per-platform filename + expected SHA-256.
3. Per-platform sidecar filenames + each sidecar's expected SHA-256 (Windows: 4 DLLs).
4. Minimum accepted `revisionIndex` (`MIN_REVISION_INDEX`, now `2`; bumps with each new pin).
5. Two embedded minisign public keys (primary + rotation) — `src/main/services/whisper-pubkeys.ts`.

On install (the Settings download, or the first transcription when the binary is missing):

1. Fetch `manifest.json` + `manifest.json.minisig` → verify signature against either pubkey.
2. Assert manifest `revisionIndex` ≥ `max(MIN_REVISION_INDEX, persisted lastSeenRevision)` (downgrade block).
3. Assert manifest's per-platform SHA-256 matches Erfana source pin (catches a signed-but-wrong-build drift).
4. Download artifact → verify SHA-256 → extract (`zipArchive.unzip` for Windows, `tarArchive.untarGz` for macOS).
5. Strip MOTW (`Zone.Identifier` on Windows) / `com.apple.quarantine` (macOS) post-extraction.
6. Hash every sidecar DLL on Windows; verify each against pin.
7. Re-hash main binary + sidecars immediately before every `spawn()` (TOCTOU).

## Verification evidence – erfana2

Pin bump checked on 2026-10-24 from a fresh `gh release download` of `whisper-build-v1.8.4-erfana2`:

- `minisign -V -P RWRGVoSZhM7rShmOHr5lmt6v6wH8Tjm/nXItCg46Co+hxgvJFLWkv0fC -m manifest.json` → `Signature and comment signature verified`, trusted comment `timestamp:1792856115	file:manifest.json	hashed`.
- Both archives' SHA-256 and size match `manifest.json`, the `.sha256` files and the GitHub Releases API digests. The per-file pins above come from extracting each archive into an empty folder.
- `manifest.json` server digest: `sha256:634bb05014a7cfc0882000312483ff09dcc48506ef2cb5994fcfe14c56ecb34f`
- `manifest.json.minisig` server digest: `sha256:a1eb518dab2d7cad88ad3cc69367da546d2e01b9e5f63a8bcafb0cc4eaf8908d`
- macOS (Apple silicon, macOS 26): `spctl -a -vv -t install whisper-cli` → `accepted`, `source=Notarized Developer ID`. Run from a folder outside the extracted tree on `ggml-tiny.bin` + upstream `samples/jfk.wav`, it printed "And so my fellow Americans ask not what your country can do for you, ask what you can do for your country." The x86_64 slice was not run (no Rosetta on the test machine).
- macOS in-app path, headless: `ERFANA_WHISPER_REAL_RELEASE=1` with `src/main/services/WhisperModelManager.realRelease.integration.test.ts` ran the shipped `ensureBinary()` (signed manifest, download, extraction into a temp `userData`, quarantine strip, chmod, re-hash) and then `LocalWhisperService.transcribe()` on `ggml-tiny`. Logged `Whisper binary installed` with `manifestRevision: 2` and `signingKeyRole: primary`, then `Whisper spawn` with `computedSha: e533e2ae…c0de`, and transcribed the same JFK sentence. Gatekeeper's first-launch check of a quarantined download is not covered, because Node's fetch sets no quarantine attribute.
- Windows: the build toolchain changed for this release – #372 dropped the VS 2022 pin, so the runner's current Visual Studio (2026) built the zip. Tested on Windows 11 25H2 (build 26200.9711) at PR #373 head `f1b30fc6`:
  - Zip SHA-256 `f4a45913…36f2` and all 5 PE hashes (`whisper.exe` + 4 DLLs) match the pins.
  - `dumpbin /dependents`: all 5 PE files import only `KERNEL32` / `ADVAPI32`, the `api-ms-win-crt-*` set, `MSVCP140`, `VCRUNTIME140` and `VCRUNTIME140_1`; `ggml-cpu.dll` also imports `VCOMP140.DLL` (OpenMP). The Microsoft VC++ 2015–2022 (x64) redistributable is therefore required, as it was for `erfana1`.
  - Installed redistributable on the test VM: v14.51.36231.00.
  - Static check against the VS 2022 14.44 redistributable DLLs: every imported function exists (`MSVCP140` 119 imported / 0 missing, `VCRUNTIME140` 16 / 0, `VCRUNTIME140_1` 1 / 0, `VCOMP140` 7 / 0).
  - Live: `whisper.exe` with app-local 14.44.35211.0 runtime DLLs → exit 0, correct transcript.
  - In-app (sandboxed e2e profile): upgrade from `erfana1` → `Whisper binary installed … "manifestRevision":2` and a correct transcript; fresh install OK; Cancel OK (`{"cancelled":true}`, `bin/` empty, no temp files left, no `whisper.exe` left running). No integrity, missing-DLL or SmartScreen errors.
  - `WhisperModelManager.realRelease.integration.test.ts` transcribes correctly on Windows.
  - Not tested: a runtime older than 14.44, or no redistributable installed.

## First-run verification evidence (erfana1)

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

`src/main/services/LocalWhisperService.ts:849-852` branches the CPU-unsupported detection on `process.platform === 'win32'` and reads from `WIN32_CPU_UNSUPPORTED_EXIT_CODES` or `POSIX_CPU_UNSUPPORTED_EXIT_CODES` accordingly. The `POSIX_*` set is currently **macOS-only by accident-of-support**: `classifyPlatform()` in `whisper-assets.ts:178-211` rejects Linux outright with a `WHISPER_UNSUPPORTED_PLATFORM` reason, so the POSIX path never actually executes against a Linux SIGILL today.

Any future Linux enablement must validate the `POSIX_CPU_UNSUPPORTED_EXIT_CODES` set against Linux SIGILL exit codes before unlocking the platform; the macOS values are not guaranteed to match. The branch is correct today; the contract is just implicit.

## Retired pin – whisper-build-v1.8.4-erfana1

Pinned from 0.9.4 until the `erfana2` bump. Kept for forensic reference; `MIN_REVISION_INDEX = 2` now refuses its manifest.

### Release

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

### Artifacts

#### macOS universal

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

**Known defect** (why it was retired): this `whisper-cli` is a shared build. It loads `@rpath/libwhisper.1.dylib` and five `libggml*` dylibs, none of which are in the tarball, so it cannot start on a user's Mac. The workflow now builds macOS statically and checks what the binary links (see [macOS build is static](../build/whisper-binaries.md#macos-build-is-static)); `erfana2` replaced this build.

#### Windows x64

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

#### Manifest

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

## History

| Erfana app versions | Pinned whisper build | Date pinned | Notes |
|---|---|---|---|
| `0.9.4`–`0.20.1` (0.21.0 was never released) | `whisper-build-v1.8.4-erfana1` | 2026-04-22 | First Windows + macOS release under Option A (#165) — upstream `9386f239` (v1.8.4) |
| `0.22.0` (released 2026-10-25) onwards | `whisper-build-v1.8.4-erfana2` | 2026-10-24 | Static macOS `whisper-cli` (PR #363) – fixes local transcription failing to start on macOS; Windows rebuilt, same 4 DLLs. Same upstream `9386f239` (v1.8.4). `MIN_REVISION_INDEX` 1 → 2 |

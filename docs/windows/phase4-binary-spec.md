# Phase 4 binary spec — whisper.cpp

Authoritative record of the whisper.cpp binary release currently pinned by Erfana. Update this file every time `src/main/services/whisper-assets.ts` advances to a new `whisper-build-*` tag.

See [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md) for the rebuild runbook.

## Currently pinned

> **Status: awaiting first CI build** — fields are placeholders until the first `whisper-binaries` workflow run publishes `whisper-build-v1.8.4-erfana1` and Branch A commit A2 records the actual values.

| Field | Value |
|---|---|
| Upstream repo | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| Upstream label | `v1.8.4` |
| Upstream commit SHA | `9386f239401074690479731c1e41683fbbeac557` |
| Erfana revision | `1` |
| Release tag | `whisper-build-v1.8.4-erfana1` |
| Release URL | _`https://github.com/qodeca/erfana/releases/tag/whisper-build-v1.8.4-erfana1`_ (after first workflow run) |

## Artifacts (pending first run)

### macOS universal

| Field | Value |
|---|---|
| Filename | `whisper-macos-universal-v1.8.4-erfana1.tar.gz` |
| SHA-256 | _pending_ |
| Size | _pending_ |
| Architectures | arm64 + x86_64 (universal) |
| Signing | Developer ID Application + notarized |

Contained files (flat inside the tarball):

- `whisper-cli` — the CLI binary
- `LICENSE.whisper-cpp` — upstream MIT license
- `NOTICE.md` — Erfana attribution + build provenance

### Windows x64

| Field | Value |
|---|---|
| Filename | `whisper-win-x64-v1.8.4-erfana1.zip` |
| SHA-256 | _pending_ |
| Size | _pending_ |
| Signing | **Unsigned** (Phase 4); Phase 5 procures OV cert |

Contained files (flat inside the zip — sidecar DLLs expected):

- `whisper.exe` — the CLI binary (renamed from upstream `main.exe` by the CI workflow)
- `whisper.dll` — expected sidecar
- `ggml.dll` — expected sidecar
- `ggml-base.dll` — expected sidecar
- `ggml-cpu.dll` — expected sidecar
- `LICENSE.whisper-cpp`
- `NOTICE.md`

_Exact DLL list confirmed after first CI build; `src/main/services/whisper-assets.ts` pins the filenames + each sidecar's SHA-256._

### Manifest

| Field | Value |
|---|---|
| Filename | `manifest.json` + `manifest.json.minisig` |
| Signed by | Erfana primary minisign key (rotation key on offline hardware token) |
| `revisionIndex` | `1` |

## Erfana-side consumption

`src/main/services/whisper-assets.ts` pins:

1. The release tag → URL base (`https://github.com/qodeca/erfana/releases/download/whisper-build-v1.8.4-erfana1`).
2. Per-platform filename + expected SHA-256.
3. Per-platform sidecar filenames + each sidecar's expected SHA-256 (Windows).
4. Minimum accepted `revisionIndex` (`1` initially; bumps with each new pin).
5. Two embedded minisign public keys (primary + rotation).

On app startup / first transcription:

1. Fetch `manifest.json` + `manifest.json.minisig` → verify signature against either pubkey.
2. Assert manifest `revisionIndex` ≥ persisted `lastSeenRevision` (downgrade block).
3. Assert manifest's per-platform SHA-256 matches Erfana source pin (catches a signed-but-wrong-build drift).
4. Download artifact → verify SHA-256 → extract (platform-appropriate: `zipArchive.unzip` for Windows, `tarArchive.untarGz` for macOS).
5. Strip MOTW (`Zone.Identifier` on Windows) / `com.apple.quarantine` (macOS) post-extraction.
6. Hash every sidecar DLL on Windows; verify each against pin.
7. Re-hash the main binary immediately before every `spawn()` (TOCTOU).

## Upstream SHA diff-review (required for every bump)

Before bumping to a new upstream commit SHA:

```bash
git clone --bare https://github.com/ggml-org/whisper.cpp.git /tmp/whisper-upstream
cd /tmp/whisper-upstream
git log --oneline <old-SHA>..<new-SHA>
git diff --stat <old-SHA>..<new-SHA>
```

Review checklist: see [`docs/build/whisper-binaries.md#diff-review-checklist-every-upstream-bump`](../build/whisper-binaries.md#diff-review-checklist-every-upstream-bump).

## History

| Erfana app versions | Pinned whisper build | Date pinned | Notes |
|---|---|---|---|
| `0.9.4`+ | `whisper-build-v1.8.4-erfana1` | _pending first ship_ | First Windows + macOS release under Option A (#165) |

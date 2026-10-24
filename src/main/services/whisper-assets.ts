// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pinned whisper-build release spec.
 *
 * This file is the **single source of truth** for which `whisper-build-*`
 * release Erfana downloads. Update the pinned constants below whenever we
 * publish a new whisper rebuild (per `docs/build/whisper-binaries.md`
 * runbook) and `docs/windows/phase4-binary-spec.md` records the change.
 *
 * Contract:
 *  - `RELEASE_TAG` is a GitHub tag on `qodeca/erfana`, marked pre-release.
 *  - Each per-platform spec pins the archive filename + SHA-256 + per-file
 *    sidecar SHA-256s so that `WhisperModelManager` can verify integrity at
 *    extraction AND before every spawn (TOCTOU close).
 *  - `MIN_REVISION_INDEX` is the lowest `revisionIndex` in a manifest the
 *    client will accept. Downgrades below this value are rejected (manifest
 *    replay attack defence).
 *  - `SCHEMA_VERSION` — bump when the on-disk layout under
 *    `{userData}/whisper/bin/` becomes incompatible with older versions.
 *    `WhisperModelManager` uses this to trigger a one-time cleanup of the
 *    legacy v0.8.0–v0.9.3 macOS `bin/` dir that was populated from a broken
 *    URL and never verified.
 *
 * @see docs/build/whisper-binaries.md
 * @see docs/windows/phase4-binary-spec.md
 * @see src/main/services/whisper-pubkeys.ts
 */

import { LOCAL_WHISPER } from '../../shared/constants'

/** Unique identity of the currently-pinned whisper-build release. */
export const RELEASE_TAG = 'whisper-build-v1.8.4-erfana2'

/** Base URL — join with `ARTIFACTS[x].filename` / `MANIFEST_*_FILENAME` for downloads. */
export const RELEASE_URL_BASE =
  'https://github.com/qodeca/erfana/releases/download/whisper-build-v1.8.4-erfana2'

/** Manifest file served alongside every `whisper-build-*` release. */
export const MANIFEST_FILENAME = 'manifest.json'
export const MANIFEST_SIG_FILENAME = 'manifest.json.minisig'
export const MANIFEST_URL = `${RELEASE_URL_BASE}/${MANIFEST_FILENAME}`
export const MANIFEST_SIG_URL = `${RELEASE_URL_BASE}/${MANIFEST_SIG_FILENAME}`

/** Reject manifests whose `revisionIndex` is strictly lower than this. */
export const MIN_REVISION_INDEX = 2

/** Bump on breaking bin/ layout change to trigger one-time migration cleanup. */
export const SCHEMA_VERSION = 1

/** Platform discriminator. Extended as more archs / platforms land. */
export type WhisperPlatform = 'darwin-universal' | 'win32-x64'

/** Per-file integrity pin — used for sidecar + main-binary verification. */
export interface FilePin {
  filename: string
  sizeBytes: number
  sha256: string
}

/** Per-platform artifact spec. */
export interface PlatformArtifactSpec {
  /** Archive filename (tar.gz on darwin, zip on win32). */
  filename: string
  archiveFormat: 'tar.gz' | 'zip'
  /** SHA-256 of the archive file. Lower-case hex. */
  sha256: string
  sizeBytes: number
  /**
   * Per-file pins for every artifact Erfana will execute or link against
   * after extraction. The MAIN binary is always present (index 0 by
   * convention); sidecars (DLLs on Windows) follow.
   */
  files: {
    /** Main executable (e.g. `whisper.exe`, `whisper-cli`). */
    main: FilePin
    /** Extra files required at runtime (DLLs, shared libs). May be empty. */
    sidecars: readonly FilePin[]
  }
}

/**
 * Pinned per-platform specs for `whisper-build-v1.8.4-erfana2`.
 *
 * SHAs sourced from `docs/windows/phase4-binary-spec.md` after the CI run
 * that published the release (run 40104989427). The macOS `whisper-cli` is
 * a static build: `libwhisper` and `libggml*` are linked in, so it links
 * only system libraries and ships with no sidecars. `erfana1` was a shared
 * build whose dylibs were not in the tarball, so it could not start on a
 * user's Mac; `MIN_REVISION_INDEX = 2` refuses its manifest.
 */
export const ARTIFACTS: Record<WhisperPlatform, PlatformArtifactSpec> = {
  'darwin-universal': {
    filename: 'whisper-macos-universal-v1.8.4-erfana2.tar.gz',
    archiveFormat: 'tar.gz',
    sha256: '2f73a24866acbd7f446344856cc1a86112cd0235e31480117c54cfa499514ab2',
    sizeBytes: 2_361_432,
    files: {
      main: {
        filename: 'whisper-cli',
        sizeBytes: 6_387_792,
        sha256: 'e533e2ae396115788235a2d0fd175cbed288f25dbd03d4c7be68c39de993c0de'
      },
      sidecars: []
    }
  },
  'win32-x64': {
    filename: 'whisper-win-x64-v1.8.4-erfana2.zip',
    archiveFormat: 'zip',
    sha256: 'f4a459133c29911e484146917c1ada49aac8668d734db8c300a820be11be36f2',
    sizeBytes: 1_014_883,
    files: {
      main: {
        filename: 'whisper.exe',
        sizeBytes: 475_136,
        sha256: 'e24ea8774875dd47bc5f7c64ade9ade7513c4bfeabfca504381da80ae9d10b06'
      },
      sidecars: [
        {
          filename: 'whisper.dll',
          sizeBytes: 1_364_480,
          sha256: '2cfc88565c5b725aa8621203e5764b89671880dad446f08b93ab2cf3ec979cba'
        },
        {
          filename: 'ggml.dll',
          sizeBytes: 68_608,
          sha256: '606684847089843116b749cca2b8554b58b7ca231dea77bc5c8023f4aac416a2'
        },
        {
          filename: 'ggml-base.dll',
          sizeBytes: 565_248,
          sha256: '732b316c65981f191df7d66162f2890c220d0a1eea28615c5936c26af265e7fc'
        },
        {
          filename: 'ggml-cpu.dll',
          sizeBytes: 776_704,
          sha256: '5ee7263411f5e1f46d033530ed6572460040e2ab2f938bc11fd7366ca39dd6c5'
        }
      ]
    }
  }
}

/** Max manifest size we'll download. Real manifests are ~800 B; cap at 64 KB. */
export const MANIFEST_MAX_BYTES = 64 * 1024
export const MANIFEST_SIG_MAX_BYTES = 8 * 1024
/** Max binary archive size cap per plan. */
export const BINARY_ARCHIVE_MAX_BYTES = 20 * 1024 * 1024

/** Slack above a model's pinned size for the per-download byte cap. */
export const MODEL_SIZE_MARGIN_BYTES = 1024 * 1024

/** Pinned model hashes + sizes live in `shared/` (display sizes derive from them). */
export { MODEL_PINS, type ModelPin } from '../../shared/whisper-model-pins'

/** Name of the schema sentinel file under `{userData}/whisper/`. */
export const SCHEMA_SENTINEL_FILENAME = '.schema-version'

/**
 * Name of the monotonic-revision sentinel under `{userData}/whisper/`.
 *
 * Persists the highest `manifest.revisionIndex` ever successfully installed.
 * `ensureBinary()` refuses to accept a manifest whose `revisionIndex` is
 * strictly lower than the stored value — this defeats manifest replay, where
 * an attacker hands the client a legitimately-signed but superseded manifest
 * to force downgrade to a known-exploitable whisper.cpp version.
 */
export const LAST_SEEN_REVISION_FILENAME = '.last-seen-revision'

/**
 * Classify the current process for binary-resolution purposes.
 *
 * Returns one of the supported `WhisperPlatform` values, or an object
 * describing why the current combination is unsupported. Linux, Windows
 * ARM64, and macOS on any non-arm64/non-x64 arch all fall into the
 * unsupported bucket.
 */
export function classifyPlatform():
  | { supported: true; platform: WhisperPlatform }
  | { supported: false; reason: string } {
  if (process.platform === 'darwin') {
    // Universal binary handles both arm64 + x86_64.
    if (process.arch === 'arm64' || process.arch === 'x64') {
      return { supported: true, platform: 'darwin-universal' }
    }
    return {
      supported: false,
      reason: `macOS ${process.arch} is not supported (need arm64 or x64)`
    }
  }
  if (process.platform === 'win32') {
    if (process.arch === 'x64') {
      return { supported: true, platform: 'win32-x64' }
    }
    if (process.arch === 'arm64') {
      return {
        supported: false,
        reason:
          'Windows ARM64 is not supported. Upstream whisper.cpp has no ARM64 binary. Use the OpenAI API transcription backend.'
      }
    }
    return {
      supported: false,
      reason: `Windows ${process.arch} is not supported (need x64)`
    }
  }
  return {
    supported: false,
    reason: `${process.platform} is not supported. Local Whisper runs on macOS and Windows x64 only; use the OpenAI API backend on other platforms.`
  }
}

/** Helper: URL for a specific artifact filename under the pinned release. */
export function artifactUrl(filename: string): string {
  return `${RELEASE_URL_BASE}/${filename}`
}

// Re-export shared-constants so consumers don't have to import both.
export { LOCAL_WHISPER }

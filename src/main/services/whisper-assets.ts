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
export const RELEASE_TAG = 'whisper-build-v1.8.4-erfana1'

/** Base URL — join with `ARTIFACTS[x].filename` / `MANIFEST_*_FILENAME` for downloads. */
export const RELEASE_URL_BASE =
  'https://github.com/qodeca/erfana/releases/download/whisper-build-v1.8.4-erfana1'

/** Manifest file served alongside every `whisper-build-*` release. */
export const MANIFEST_FILENAME = 'manifest.json'
export const MANIFEST_SIG_FILENAME = 'manifest.json.minisig'
export const MANIFEST_URL = `${RELEASE_URL_BASE}/${MANIFEST_FILENAME}`
export const MANIFEST_SIG_URL = `${RELEASE_URL_BASE}/${MANIFEST_SIG_FILENAME}`

/** Reject manifests whose `revisionIndex` is strictly lower than this. */
export const MIN_REVISION_INDEX = 1

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
 * Pinned per-platform specs for `whisper-build-v1.8.4-erfana1`.
 *
 * SHAs sourced from `docs/windows/phase4-binary-spec.md` after the CI run
 * that published the release.
 */
export const ARTIFACTS: Record<WhisperPlatform, PlatformArtifactSpec> = {
  'darwin-universal': {
    filename: 'whisper-macos-universal-v1.8.4-erfana1.tar.gz',
    archiveFormat: 'tar.gz',
    sha256: '78fa53c26f62da7f842def18f57338908641449fcee5da533037237d09bc696b',
    sizeBytes: 744_152,
    files: {
      main: {
        filename: 'whisper-cli',
        sizeBytes: 1_778_400,
        sha256: 'ff6de29f7a5581bea65a87c2437aabc8085cd21a6c476e78e11bc81b1edd8b9f'
      },
      sidecars: []
    }
  },
  'win32-x64': {
    filename: 'whisper-win-x64-v1.8.4-erfana1.zip',
    archiveFormat: 'zip',
    sha256: '8e3c63e8e7112e3f04304a4d58937696d72881d88ad0c436665e194b7af846f1',
    sizeBytes: 909_525,
    files: {
      main: {
        filename: 'whisper.exe',
        sizeBytes: 485_888,
        sha256: '66caae86a60256b2fcde8d518a778608cb092554a173a6859cae080b0d3c4d6c'
      },
      sidecars: [
        {
          filename: 'whisper.dll',
          sizeBytes: 483_840,
          sha256: 'd3ab5b3356d5233640de9e972c62ac1af674cbd3c696084aed5261db5b442824'
        },
        {
          filename: 'ggml.dll',
          sizeBytes: 67_072,
          sha256: '08cafe44fbb8f463e77421f60cc57a6afa6cac8403a0281f7dedbeb9e68ab900'
        },
        {
          filename: 'ggml-base.dll',
          sizeBytes: 549_376,
          sha256: '26e62b452554e22f9125e966975da37e1ec8119d3b09e67b6cd00999348ee40d'
        },
        {
          filename: 'ggml-cpu.dll',
          sizeBytes: 774_144,
          sha256: 'eeea48c0ae3c7c375fd197ef865a38cc280ba3da5499d559aade473835557980'
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
/** Max model size cap per plan. */
export const MODEL_MAX_BYTES = 2 * 1024 * 1024 * 1024

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

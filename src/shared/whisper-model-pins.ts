// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pinned hash + exact size of every GGML model the app offers.
 *
 * Lives in `shared/` so the display sizes in `LOCAL_WHISPER.MODEL_SIZES` come
 * from the same numbers the downloader enforces. `sha256` and `sizeBytes` are
 * the LFS `oid` and `size` from the Hugging Face API
 * (`/api/models/ggerganov/whisper.cpp/tree/main`), pinned 2026-10-23.
 *
 * @see docs/build/whisper-binaries.md § "Security baseline"
 */

export type WhisperModelId = 'tiny' | 'base' | 'small' | 'medium' | 'large'

/**
 * One GGML model on Hugging Face (`ggerganov/whisper.cpp`). `remoteFilename`
 * is the file on Hugging Face; the local file is always `ggml-<model>.bin`.
 */
export interface ModelPin {
  remoteFilename: string
  sizeBytes: number
  sha256: string
}

/**
 * `large` maps to `ggml-large-v3.bin` because the repo has no plain
 * `ggml-large.bin`. Bump together when a model is re-published.
 */
export const MODEL_PINS: Readonly<Record<WhisperModelId, ModelPin>> = {
  tiny: {
    remoteFilename: 'ggml-tiny.bin',
    sizeBytes: 77_691_713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21'
  },
  base: {
    remoteFilename: 'ggml-base.bin',
    sizeBytes: 147_951_465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
  },
  small: {
    remoteFilename: 'ggml-small.bin',
    sizeBytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
  },
  medium: {
    remoteFilename: 'ggml-medium.bin',
    sizeBytes: 1_533_763_059,
    sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208'
  },
  large: {
    remoteFilename: 'ggml-large-v3.bin',
    sizeBytes: 3_095_033_483,
    sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Opt-in end-to-end check of the pinned whisper-build release, through the
 * app's own main-process code and against the real network.
 *
 * The unit suites mock the downloader, the archive and the spawn. That is how
 * `whisper-build-v1.8.4-erfana1` shipped: its CI smoke test passed on the build
 * runner, yet the binary could not start on a user's Mac. This test runs the
 * path a user's first transcription takes – signed-manifest fetch, archive
 * download, extraction into `{userData}/whisper/bin/`, quarantine strip,
 * chmod, per-file re-hash, then `LocalWhisperService.transcribe()` spawning
 * the installed binary on `ggml-tiny` and the upstream JFK sample.
 *
 * Off by default (downloads ~80 MB). Run it when bumping the pin:
 *
 *   ERFANA_WHISPER_REAL_RELEASE=1 npx vitest --run --config vitest.main.ts \
 *     src/main/services/WhisperModelManager.realRelease.integration.test.ts
 *
 * Only `electron`'s `app.getPath('userData')` is stubbed (to a temp dir);
 * everything else is the shipped code. It does not cover Gatekeeper's
 * first-launch assessment of a quarantined download, because Node's fetch
 * sets no quarantine attribute.
 */

import { afterAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync } from 'fs'
import { readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// Created inside the test, so a skipped run (env var unset) leaves nothing in tmp.
const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string): string => {
      if (name !== 'userData') throw new Error(`unexpected app.getPath(${name})`)
      if (!state.userDataDir) throw new Error('userData requested before the test created it')
      return state.userDataDir
    }
  }
}))

const ENABLED = process.env.ERFANA_WHISPER_REAL_RELEASE === '1'
const SUPPORTED =
  (process.platform === 'darwin' && (process.arch === 'arm64' || process.arch === 'x64')) ||
  (process.platform === 'win32' && process.arch === 'x64')

/** Upstream `samples/jfk.wav` – pinned so a changed sample fails loudly. */
const JFK_URL = 'https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav'
const JFK_SHA256 = '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e'

/**
 * On Windows a sidecar DLL can stay mapped for a moment after whisper.exe
 * exits, so the first unlink fails with EPERM – retry instead of failing.
 */
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const

afterAll(async () => {
  if (state.userDataDir) await rm(state.userDataDir, RM_OPTIONS)
})

describe.runIf(ENABLED && SUPPORTED)('pinned whisper-build release – real install and transcription', () => {
  it(
    'installs the pinned binary into userData and transcribes the JFK sample with it',
    async () => {
      state.userDataDir = mkdtempSync(join(tmpdir(), 'erfana-whisper-real-'))
      const userDataDir = state.userDataDir
      const { logger } = await import('./LoggingService')
      const infoSpy = vi.spyOn(logger, 'info')
      const { MIN_REVISION_INDEX, RELEASE_TAG } = await import('./whisper-assets')
      const { createWhisperModelManager } = await import('./WhisperModelManager')
      const { createLocalWhisperService } = await import('./LocalWhisperService')

      const manager = createWhisperModelManager()
      const binaryPath = await manager.ensureBinary()
      expect(binaryPath.startsWith(userDataDir)).toBe(true)

      const installed = infoSpy.mock.calls.find(([msg]) => msg === 'Whisper binary installed')
      expect(installed).toBeDefined()
      const meta = installed![1] as { manifestRevision: number }
      expect(meta.manifestRevision).toBeGreaterThanOrEqual(MIN_REVISION_INDEX)
      const floor = await readFile(join(userDataDir, 'whisper', '.last-seen-revision'), 'utf8')
      expect(Number(floor.trim())).toBe(meta.manifestRevision)
      expect(await manager.isBinaryInstalled()).toBe(true)

      await manager.ensureModel('tiny')

      const response = await fetch(JFK_URL)
      expect(response.ok).toBe(true)
      const wav = Buffer.from(await response.arrayBuffer())
      expect(createHash('sha256').update(wav).digest('hex')).toBe(JFK_SHA256)
      const audioDir = mkdtempSync(join(tmpdir(), 'erfana-whisper-audio-'))
      const wavPath = join(audioDir, 'jfk.wav')
      await writeFile(wavPath, wav)

      try {
        const service = createLocalWhisperService(manager)
        const result = await service.transcribe({ filePath: wavPath, language: 'en', model: 'tiny' })
        // Printed so an operator can quote it in the pin-bump PR.
        const spawn = infoSpy.mock.calls.find(([msg]) => msg === 'Whisper spawn')
        console.log(
          `[real-release] ${RELEASE_TAG}\n` +
            `[real-release] INFO Whisper binary installed ${JSON.stringify(installed![1])}\n` +
            `[real-release] INFO Whisper spawn ${JSON.stringify(spawn?.[1])}\n` +
            `[real-release] transcript: ${result.transcript ?? `(none – ${result.errorCode}: ${result.error})`}`
        )
        expect(result.success).toBe(true)
        expect(result.transcript?.toLowerCase()).toContain('ask not what your country')
      } finally {
        await rm(audioDir, RM_OPTIONS)
      }
    },
    10 * 60 * 1000
  )
})

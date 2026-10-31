// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// The slow, opt-in comment measurements of spec 024, never part of the
// default suite. Each writes its report under
// specs/spec-t3-024-unified-comments/verification/; the merge-time tests in
// the same files read those reports in every ordinary run.
//
// - `npm run test:corpus` – the real-file corpus round trip (024-NFR-003):
//   `corpus-collect` freezes the corpus in temp/corpus/, then `CORPUS_SHARDS`
//   projects (default 8) each run their share of it in parallel, then
//   `corpus-merge` writes the report. Each group starts only when the one
//   before it has finished (`sequence.groupOrder`).
// - `npm run test:timing` – the large-file timing (024-NFR-001), alone in its
//   own worker so no other test shares its time.
//
// Each project stands alone (`extends: false`) with the main-process test
// setup; the environment flags switch on the measuring `describe` blocks.
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import type { TestProjectInlineConfiguration } from 'vitest/config'

const SHARDS = Number(process.env.CORPUS_SHARDS ?? '8')
const CORPUS_TEST = 'src/main/services/comments/corpus/corpusRoundTrip.test.ts'
const TIMING_TEST = 'src/main/services/comments/corpus/largeFileTiming.test.ts'
/** Long enough for a shard of the whole corpus on a slow machine. */
const TIMEOUT_MS = 6 * 60 * 60 * 1000

type ProjectTestOptions = NonNullable<TestProjectInlineConfiguration['test']>

function project(test: ProjectTestOptions): TestProjectInlineConfiguration {
  return {
    extends: false,
    resolve: {
      alias: {
        '@main': path.resolve(__dirname, 'src/main'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    test: {
      environment: 'node',
      globals: true,
      setupFiles: ['tests/setup/setupTests.main.ts'],
      testTimeout: TIMEOUT_MS,
      ...test,
    },
  }
}

const shards = Array.from({ length: SHARDS }, (_, k) =>
  project({
    name: `corpus-shard-${k}`,
    include: [CORPUS_TEST],
    env: { CORPUS_RUN: '1', CORPUS_SHARD: `${k}/${SHARDS}` },
    sequence: { groupOrder: 1 },
  })
)

export default defineConfig({
  test: {
    maxWorkers: SHARDS,
    reporters: 'default',
    projects: [
      project({
        name: 'corpus-collect',
        include: [CORPUS_TEST],
        env: { CORPUS_COLLECT: '1' },
        sequence: { groupOrder: 0 },
      }),
      ...shards,
      project({
        name: 'corpus-merge',
        include: [CORPUS_TEST],
        env: { CORPUS_MERGE: '1', CORPUS_SHARDS: String(SHARDS) },
        sequence: { groupOrder: 2 },
      }),
      project({
        name: 'timing',
        include: [TIMING_TEST],
        env: { TIMING_RUN: '1' },
        fileParallelism: false,
        sequence: { groupOrder: 3 },
      }),
    ],
  },
})

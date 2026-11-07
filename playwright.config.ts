// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'

// Load .env file so E2E tests can access API keys (e.g., OPENAI_API_KEY)
dotenv.config()

// The OpenAI key is for the env-gated `transcription` project only (real, paid
// calls). Drop it from the runner's environment otherwise, so no other spec -
// including the ones that still launch the app with `...process.env` - can pass
// it on. The fixtures also build the app's environment from an allowlist
// (e2e/fixtures/isolation.ts), which never includes it.
if (process.env.ERFANA_E2E_TRANSCRIPTION !== '1') {
  delete process.env.OPENAI_API_KEY
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  // Retries policy:
  //   Local (CI unset): 0 — a timing blip is a real signal, not a noise we
  //     should silently smooth over during active development. If a test
  //     flakes locally, fix the test (or quarantine it via the e2e.yml
  //     `e2e-quarantine` lane); do not paper over with retries.
  //   CI: 2 — CI runners have unpredictable load (Defender on Windows,
  //     macOS hosted-runner GPU init), and a real bug that retries can
  //     mask is much rarer than a runner-noise flake. The
  //     `e2e-stable`-vs-`e2e-quarantine` job split is where genuinely
  //     flaky tests are isolated, not the retry count.
  retries: process.env.CI ? 2 : 0,
  // Per-spec parallelism. Capped at 2 workers because most fixtures launch a
  // full Electron process plus a node-pty PTY plus chokidar watchers; on a
  // 10-core dev machine an unlimited cap saturates RAM and PTY handles, and
  // multiple windows pointed at the same shared PROJECT_ROOT collide on the
  // file-based ProjectLockService lock. Two workers gives near-2× speedup on
  // independent specs (testProject-based) and keeps the lock contention
  // window small enough to ignore. Raise only after auditing each spec's
  // PROJECT_ROOT usage and adding `describe.configure({ mode: 'serial' })`
  // to any that share state with a sibling worker.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 2,
  // `retain-on-failure` keeps a trace for every flaky retry that eventually
  // passes, which (with retries: 1) doubles trace storage on every flake.
  // `on-first-retry` only writes traces when the initial attempt failed and
  // a retry runs — the artifact that's actually useful for debugging.
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    // Emits a `[capability-summary] SKIPPED CAPABILITIES: …` line at end-of-run
    // so env-gated suites (e.g. transcription) are loudly auditable instead
    // of silently green. See e2e/reporters/capability-summary.ts.
    ['./e2e/reporters/capability-summary.ts']
  ],
  // Never auto-write actuals as baselines. The explicit
  // `test:e2e:update-screenshots` script passes `--update-snapshots` which
  // overrides this config, so the baseline-generation path stays intact;
  // only the accidental "first run on a new platform writes whatever it
  // rendered as canonical" path is closed.
  updateSnapshots: 'none',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts',
      testIgnore: ['**/visual-regression*', '**/audio-transcription*', '**/*.timing.e2e.ts'],
    },
    {
      // Timing gates (`*.timing.e2e.ts`, e.g. 024-NFR-001): they assert a P95
      // budget, so they run alone, after the functional suite, with no second
      // Electron app sharing the CPU (owner decision 2026-11-04: in the full
      // run the save P95 missed 1000 ms by 1 ms, while it is ~780 ms alone).
      // The budgets are unchanged. A dependency failure in `electron` skips
      // them; run them alone with `--project=timing --no-deps`.
      name: 'timing',
      testMatch: '**/*.timing.e2e.ts',
      dependencies: ['electron'],
      fullyParallel: false,
      workers: 1,
    },
    {
      // The built-in browser's hostile-page suite (spec 025, 025-NFR-001,
      // 025-AC-046, 025-AC-068): what the `Browser isolation` CI job runs
      // (browser-isolation.yml). A subset of the `electron` project, so a bare
      // `playwright test` runs these twice – every script names its project.
      // Files and titles together pick the suite: every test of
      // browser-tab-isolation.e2e.ts carries 025-AC-046 or 025-AC-068, every
      // test of browser-hostile-pages.e2e.ts and browser-hostile-terminal.e2e.ts
      // carries 025-AC-046 or "hostile", and browser-local-files.e2e.ts adds
      // its hostile local folder test.
      // Retries 0, also on CI: a hostile page that gets through once and not
      // on the retry is an attack that worked, not a flake.
      // Run: npm run test:e2e:browser-isolation
      name: 'browser-isolation',
      testMatch: [
        '**/browser-tab-isolation.e2e.ts',
        '**/browser-hostile-pages.e2e.ts',
        '**/browser-hostile-terminal.e2e.ts',
        '**/browser-local-files.e2e.ts'
      ],
      grep: /025-AC-046|025-AC-068|hostile/,
      retries: 0,
    },
    {
      // Env-gated project for capabilities that make real (paid) external
      // API calls. Audio transcription uses the OpenAI API; running it
      // unconditionally would charge on every PR. Gate on a project-level
      // env so the gating is visible in the project list (a missing
      // OPENAI_API_KEY inside a test that decided to run via `test.skip`
      // produces a silent green tick — see #36969 in microsoft/playwright).
      //
      // Enable with: ERFANA_E2E_TRANSCRIPTION=1 (and OPENAI_API_KEY set).
      // The capability-summary reporter logs whether this project ran.
      name: 'transcription',
      testMatch: '**/audio-transcription*.e2e.ts',
      grepInvert: process.env.ERFANA_E2E_TRANSCRIPTION === '1' ? undefined : /./,
    },
    {
      // Env-gated performance benchmarks (`*.bench.ts`). They record numbers
      // rather than assert behaviour, take minutes, and are only meaningful on
      // an otherwise idle machine, so they never run with the suite.
      // Enable with: ERFANA_E2E_BENCH=1 npx playwright test --project=bench
      // Records: docs/performance/.
      name: 'bench',
      testMatch: '**/*.bench.ts',
      fullyParallel: false,
      retries: 0,
      grepInvert: process.env.ERFANA_E2E_BENCH === '1' ? undefined : /./,
    },
    {
      // Guide task runs (`e2e/guide-tasks/*.guide.ts`). Each spec follows one
      // docs/user-guide how-to page step by step, finding controls by the
      // labels the page names, to prove the page still gets a reader to the
      // result. Run: npx playwright test --project=guide
      name: 'guide',
      testMatch: '**/guide-tasks/*.guide.ts',
      fullyParallel: false,
      retries: 0,
    },
    {
      // Every visual spec: visual-regression.e2e.ts (the app's core states) and
      // visual-regression.browser.e2e.ts (the built-in browser's surfaces). The
      // electron project ignores the same files (`**/visual-regression*`).
      name: 'visual',
      testMatch: '**/visual-regression*.e2e.ts',
      retries: 0, // Visual diffs must be investigated, not retried (spec 019-FR-003)
      snapshotDir: './e2e/screenshots',
      snapshotPathTemplate: '{snapshotDir}/{arg}-{platform}{ext}',
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          animations: 'disabled',
        },
      },
    },
  ],
})

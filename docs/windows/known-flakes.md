# Windows test-flake register

Record of Windows-host-specific test flakes, their symptoms, status, and the
commit or issue that remediated them. Seeded 2026-04-23 during the
`feature/windows-flake-remediation` work (#172).

**Why this file exists**: Windows-host test flakes form a pool, not a fixed
list. Different tests trip on different runs depending on what Defender is
scanning, NTFS contention, or V8 GC interaction. Without a register, every
new flake gets re-triaged from scratch and historical context is lost. This
index lets future contributors (starting with #167 Phase 6 `windows-latest`
CI) recognise known patterns and apply proven remediations.

**Scope**: tests that pass on Linux / macOS CI but fail or flake on Windows
specifically. Cross-platform flakes (e.g. network-dependent tests) go in
`docs/known-issues.md` instead. A single macOS-CI-only flake row is included
below until a dedicated macOS register exists — rows are marked in the
**Notes** column when they are not Windows-host.

## Status legend

- ✅ **resolved** — remediation shipped, verified on Windows + macOS/Linux CI
- 🟡 **under observation** — surfaced once, not yet reproduced; no remediation yet
- 🔴 **actively flaking** — reproduces frequently, remediation in progress
- 🚫 **wontfix** — platform-inherent behavior; worked around in test design or accepted

## Register

| Test path | Symptom | First seen | Status | Issue # | Notes |
|---|---|---|---|---|---|
| `src/main/services/watcher/ThrottledWorker.test.ts:307,361,396` | 30 s timeout on Windows; ~3 s on macOS. 60 k-event overflow burst trips V8 GC under Defender. | 2026-04-23 | ✅ resolved | [#172](https://github.com/qodeca/erfana/issues/172) / [#173](https://github.com/qodeca/erfana/issues/173) | Refactor to offset-based deque (commit `f53f426`). 31 s → 831 ms. Exposed a real production perf bug (burst handling during npm install / git checkout). |
| `src/main/services/FileService.copyItem.test.ts:172` | 30 s timeout on Windows; passes ~3 s on macOS. Test creates 1001 real files to trigger `MAX_COPY_ATTEMPTS` throw. | 2026-04-23 | ✅ resolved | [#172](https://github.com/qodeca/erfana/issues/172) | Split into `FileService.copyItem.limit.test.ts` with `vi.mock('fs/promises')`. Real-disk scenarios stay in original file. Runs in <200 ms. |
| `e2e/directory-watcher.e2e.ts:34` | 2 s budget exceeded on Windows (observed 2.0–3.0 s). chokidar `ReadDirectoryChangesW` + Defender on-access adds 1.5–2.5 s vs POSIX inotify. | 2026-04-23 | ✅ resolved | [#172](https://github.com/qodeca/erfana/issues/172) | Per-platform budget: 6000 ms Windows / 2000 ms POSIX. `test.describe.configure({ retries: 0 })` prevents masking. 500 ms NFR-001 target preserved via integration test in `DirectoryWatcherService.pipeline.test.ts`. |
| `src/renderer/src/components/Settings/SettingsOverlay.test.tsx:222,236` | 100 ms `waitFor` exceeded on Windows (observed 380 ms). Worker pre-emption pushes the component's 10 ms focus `setTimeout` past budget. | 2026-04-23 | ✅ resolved | [#172](https://github.com/qodeca/erfana/issues/172) | Rewrite with `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` + `vi.advanceTimersByTime(11)` wrapped in `act()`. Deterministic. |
| `src/renderer/src/components/Panels/TerminalPanel.flickering.test.tsx` | 5 s+ timeout on multiple resize tests ("enforce integer dimensions", "apply threshold to prevent dimension oscillation", "resize when change exceeds threshold"). Reproduced 2026-04-23 during remediation-branch verification. | 2026-04-22 | 🔴 actively flaking | — | Reproduces consistently. Likely candidate: ResizeObserver + wall-clock timing. Apply fake-timer remediation pattern; file follow-up issue. |
| `src/renderer/src/utils/panelUtils.test.ts` (`waitForTerminalReady` custom interval) | 335 ms wall-clock on 2026-04-23 (prior run 151 ms) for a 100 ms timing test. Consistently above budget on Windows. | 2026-04-22 | 🔴 actively flaking | — | Same pattern as SettingsOverlay focus — worker pre-emption on tight timer. Apply fake-timer remediation. |
| `src/renderer/src/components/Editor/MarkdownPreview.prompt.test.tsx` | 8.8 s timeout on "should handle very long content" (Windows local, 2026-04-23). | 2026-04-23 | 🟡 under observation | — | Large-content rendering test; likely Monaco / markdown-parse cost + Defender scanning. First occurrence — needs second observation before fix design. |
| `src/renderer/src/components/Search/SearchBar.test.tsx` | 815 ms timeout on "auto-focuses input on mount" (Windows local, 2026-04-23). | 2026-04-23 | 🟡 under observation | — | Focus race matching SettingsOverlay (P4) pattern. Apply same `vi.useFakeTimers` + `act()` remediation if it reproduces. |
| `src/main/services/DirectoryWatcherService.test.ts:25` (`ENOENT handling > sends project-deleted and remains recoverable (stopAll instead of dispose) after max restart attempts`) | 5000 ms testTimeout exceeded on Windows local (2026-04-23, commit `5769d49`). Passes clean on ubuntu CI (250/250 files, 7955 tests green). | 2026-04-23 | 🟡 under observation | — | Tight restart-attempt loop sensitive to worker pre-emption under Defender. Same family as SettingsOverlay (P4). Apply `vi.useFakeTimers` + `vi.advanceTimersByTime` for the restart-scheduler timer. |
| `src/main/services/DirectoryWatcherService.test.ts:105` (`ENOENT handling > schedules restart on first transient error (ENOENT)`) | `expect(sends.some(s => s.channel === 'directory-watch:project-deleted')).toBe(false)` — got `true` (Windows local, 2026-04-23, commit `5769d49`). Passes clean on ubuntu CI. | 2026-04-23 | 🟡 under observation | — | Race: on Windows, the `project-deleted` broadcast fires before the assertion inspects the send buffer; on POSIX the restart scheduler pre-empts first. Pair-fix with the sibling row above using fake timers so scheduler order is deterministic. |
| `e2e/third-party-components.e2e.ts:38` (`Monaco editor: Set content via keyboard and verify in preview`) | macOS CI (`macos-latest`) flake on 2026-04-23 (commit `5769d49`, run [24852814922](https://github.com/qodeca/erfana/actions/runs/24852814922)). Marked flaky by Playwright retry — passed on second attempt. Not observed on Windows local. | 2026-04-23 | 🟡 under observation | — | **macOS-host**, not Windows — recorded here because no macOS register exists yet. Likely Monaco keyboard-input focus race. Needs second CI observation before remediation; candidate fix is `MonacoPage.waitForReady()` before `page.keyboard.type()`. |
| `e2e/fixture-smoke.e2e.ts` (whole worker) | `Worker teardown timeout of 60000ms exceeded` + `EBUSY: resource busy or locked, unlink/rmdir '.e2e-temp/worker-*'` on Windows; the app also flashed a main-process crash dialog (`TypeError: Cannot read properties of undefined (reading 'expiry')` from `node:internal/timers` via `FSWatcher._throttle`). Surfaced 2026-06-13 on the #217 branch's first push. | 2026-06-13 | ✅ resolved | [#217](https://github.com/qodeca/erfana/issues/217) / PR #245 | Root cause was the crash, not the EBUSY (one bug, two symptoms): a chokidar `awaitWriteFinish` throttle timer in `FileWatcherService` called `setTimeout` as Node's timer subsystem was being dismantled during shutdown, throwing an uncaught error that crashed the main process and left file handles locked. Fix (`e1142cd`): a shutdown-scoped `uncaughtException` guard in `index.ts` swallows exactly this benign timer race (`isBenignShutdownTimerError`) and lets the exit finish; normal-operation crashes still surface Electron's dialog. No file-watching behavior change. |
| `scripts/fuses.test.mjs` (`chmodNodePtySpawnHelper`, `ensurePackedMediaBinaries`) | 5/9 cases fail on Windows host with `expected 420 to be 438` (decimal `0o644` vs `0o666`). Windows `fs.chmodSync` is effectively a no-op for POSIX modes; the suite is a pure POSIX-mode contract test. Workspace mode masked this (long-running `npm run test 2>&1 \| tail` returns tail's exit code, not vitest's). Discovered 2026-06-04 while attempting Phase C coverage measurement for the lens-review enhancement plan. | 2026-06-04 | ✅ resolved | — | `describe.skipIf(process.platform === 'win32')` added to both top-level describes (2026-06-04) — these exercise the `afterPack` macOS/Linux chmod helper, no Windows code path is tested. ubuntu CI still covers them. Unblocks `npm run test:cov` on Windows hosts. |

## Follow-up audit candidates

Areas likely to contain more Windows-host flakes. Scan once Phase 6 #167
enables `windows-latest` CI (so we can attribute failures without needing
local Windows hardware):

- **`src/main/services/watcher/**`** — chokidar primitive shared with the
  directory-watcher e2e flake. More tests that assume inotify-class latency.
- **`src/main/services/GitWatcherService.ts` + `GitPollingService.ts`** — fs
  polling intervals, retry/backoff windows. Sensitive to NTFS open-syscall
  latency.
- **Any test using `waitForIpcComplete` with short timeouts** — IPC race
  surface. Grep for `waitForIpcComplete.*\{.*timeout.*\}`.
- **`src/main/services/TerminalService.ts`** — ConPTY spawn on Windows has
  different startup timing than POSIX pty.
- **`src/main/services/ScreenshotService.ts`** — once Phase 3 #164 lands,
  cross-platform capture timing. Add tests with Windows budget from day one.
- **Tests with `{ timeout: NNNN }` overrides** — grep for these; each is a
  tacit acknowledgement that the test is slow. Review whether mocking or
  fake timers can eliminate the need.

## Remediation patterns cheat-sheet

**Wall-clock `waitFor` with tight timeout → fake timers**

Before:
```typescript
await waitFor(() => expect(el).toHaveFocus(), { timeout: 100 })
```

After:
```typescript
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => vi.useRealTimers())

// ...
act(() => { vi.advanceTimersByTime(ACTUAL_COMPONENT_DELAY_MS + 1) })
expect(el).toHaveFocus()
```

Established in: `useGitStatus.test.ts:262`, `ContextMenu.test.tsx:116`,
`SettingsOverlay.test.tsx:217` (post-#172).

**Real-disk stress test → module-level `fs/promises` mock**

Split the slow test into `<Source>.<concern>.test.ts` with `vi.mock('fs/promises', ...)`
at module scope. See `docs/windows/contributing.md` § "Test-file split policy".

Established in: `WhisperModelManager.downgrade.test.ts` (Phase 4),
`FileService.copyItem.limit.test.ts` (post-#172).

**E2E latency budget → per-platform constant + `retries: 0`**

```typescript
test.describe.configure({ retries: 0 })  // budgets must not be retried
const BUDGET_MS = process.platform === 'win32' ? WIN_BUDGET : POSIX_BUDGET
await loc.waitFor({ state: 'visible', timeout: BUDGET_MS })
expect(elapsed).toBeLessThan(BUDGET_MS)
```

Move NFR regression signal to a fake-timer integration test (`*.pipeline.test.ts`)
where Defender noise can't invalidate the budget.

Established in: `e2e/visual-regression.e2e.ts:35` (platform baselines),
`e2e/directory-watcher.e2e.ts:33` (post-#172).

**Backing-array pattern O(n²) under stress → offset-based deque**

Replace `this.buffer = this.buffer.slice(N)` with `bufferOffset += N` + periodic
compaction. See `src/main/services/watcher/ThrottledWorker.ts` post-#173.

## How to update this file

When a new flake surfaces:

1. Add a 🟡 row immediately with test path, observed symptom, date.
2. If a fix lands, move to ✅ and link the commit/issue.
3. If it reproduces in CI, upgrade to 🔴 and file a tracking issue.
4. When all rows are ✅ or 🚫, the page is "settled" — quarterly re-scan
   against the audit-candidate list is the next cadence.

## See also

- [`implementation-plan.md`](implementation-plan.md) §"Phase 6 — Polish & DX" item #4
- [`contributing.md`](contributing.md) §"Test-file split policy"
- [`../known-issues.md`](../known-issues.md) §"Directory watcher latency on Windows"
- [Main remediation issue #172](https://github.com/qodeca/erfana/issues/172)
- [Phase 6 tracking #167](https://github.com/qodeca/erfana/issues/167)
- [Deferred items meta #168](https://github.com/qodeca/erfana/issues/168)

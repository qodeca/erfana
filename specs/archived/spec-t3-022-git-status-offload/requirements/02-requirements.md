# Requirements

## Functional requirements

### FR-001: Worker thread for statusMatrix

The `GitStatusService` MUST execute `isomorphic-git statusMatrix()` in a dedicated `worker_threads` Worker, not on the main Electron thread.

- The worker MUST be created once per `GitStatusService` lifetime (persistent worker, not per-call)
- Communication MUST use `MessagePort` with structured clone for `GitStatusResponse` data
- The existing per-project operation queue (`operationQueues` Map) MUST be preserved to prevent concurrent git operations
- The worker MUST implement the `IGitStatusWorker` interface defined in `src/main/interfaces/`
- The service MUST accept the worker as a constructor dependency to enable test injection
- Worker errors MUST be caught and surfaced as `GitStatusResponse.error` (same contract as current error handling)
- Worker crashes MUST trigger automatic restart with the existing restart pattern

### FR-002: Cache parameter for statusMatrix

The `statusMatrix()` call MUST pass a `cache` object parameter that persists across calls for the same project.

- A new cache MUST be created when the project path changes
- The cache MUST be cleared when the project is closed
- This change requires no API modifications and provides significant performance improvement for repeated calls (isomorphic-git benchmarks show >2x speedup on cached runs)
- The cache MUST be stored in a private `statusCache` field on the service instance
- The service MUST expose a `dispose()` method that clears the cache and terminates the worker thread

### FR-003: Repo size guard

Before calling `statusMatrix()`, the service MUST check the `.git/index` file size as a proxy for tracked file count.

- The threshold MUST be configurable via a constant (default: 5 MB, approximately 50K tracked files)
- If `.git/index` exceeds the threshold, the service MUST use the native git fallback (FR-004) instead of `statusMatrix()`
- The service MUST perform its own `fs.stat()` on `.git/index` to check file size (the `GitPollingService.hasIndexChanged()` method is private and stateful – not reusable)
- The guard MUST log which strategy was selected (debug level)

### FR-004: Native git fallback

When the repo size guard triggers, the service MUST fall back to native `git status --porcelain -z --no-renames` via `execFile`.

- The fallback MUST produce the same `GitStatusResponse` shape as the isomorphic-git path
- The `--no-renames` flag MUST be used to maintain behavioral parity with isomorphic-git (which never produces `renamed` status)
- Branch detection MUST use `git rev-parse --abbrev-ref HEAD` (or `git symbolic-ref --short HEAD`)
- The fallback MUST handle the case where `git` is not available on PATH (fall back to isomorphic-git in worker)
- The `git` binary MUST be resolved to an absolute path at first use (e.g., via `execFile('which', ['git'])`) and cached as `NATIVE_GIT_PATH`. Do not rely on PATH resolution for subsequent calls.
- Untracked file listing MUST use `-unormal` (folder-level, not individual files) for performance. With `-unormal`, untracked entries are directory-level (e.g., `new-folder/`) rather than individual files. This is an intentional behavioral difference for large repos – the performance benefit (~100x) outweighs the reduced untracked file granularity.
- The `execFile` call MUST set `maxBuffer: 5242880` (5 MB) to prevent memory exhaustion from repos with extremely large change sets
- The native git commands MUST also run in the worker thread (not on main thread)

The porcelain output parser MUST map XY status codes to `GitDisplayStatus` and `staged` as follows:

| XY code | GitDisplayStatus | staged |
|---------|-----------------|--------|
| `M ` | modified | true |
| ` M` | modified | false |
| `MM` | modified | false (worktree takes precedence) |
| `A ` | staged | true |
| `AM` | staged | true |
| `D ` | deleted | true |
| ` D` | deleted | false |
| `??` | untracked | false |
| `!!` | (ignored – skip) | – |
| `UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD` | conflicted | false |

Unknown XY codes MUST be skipped with a warning log (not crash).

### FR-005: Timing instrumentation

All git status operations MUST log their execution time.

- The strategy MUST be represented as a `GitStatusStrategy` union type (`'isomorphic-git' | 'native-git'`)
- Log format: `GitStatus: {strategy} completed in {duration}ms ({fileCount} files)` at info level
- Strategy values: `isomorphic-git`, `native-git`
- This enables future performance benchmarking and threshold tuning

## Non-functional requirements

### NFR-001: Main-thread responsiveness

The main Electron thread MUST NOT block for more than 50ms during any git status operation, regardless of repository size.

### NFR-002: IPC contract stability

The `GitStatusResponse` type, `git:state-changed` broadcast, `git:poll-triggered` broadcast, and all Zod schemas in `src/shared/ipc/git-schema.ts` and `git-watcher-schema.ts` MUST remain unchanged.

### NFR-003: Worker lifecycle

- The worker MUST be created lazily (first git status call, not at app startup)
- The worker MUST be terminated when all projects are closed or the app is shutting down
- Worker creation failure MUST fall back to main-thread execution with a warning log

### NFR-004: Error resilience

- Worker crashes MUST NOT crash the main process
- A crashed worker MUST be automatically restarted on next `getStatus()` call
- Native git fallback MUST NOT hang – use a 10-second timeout on `execFile`
- If `execFile` times out (10 seconds), the service MUST return a `GitStatusResponse` with the `error` field set (not fall back to isomorphic-git, which would also be slow for the same repo)
- A circuit breaker MUST limit worker restarts: after 3 consecutive crashes for the same project within 60 seconds, the worker MUST be disabled for that project and `getStatus()` MUST return a `GitStatusResponse` with the `error` field set

### NFR-005: Testing

- Unit tests MUST mock the worker interface (not spawn real workers)
- Integration test SHOULD verify worker communication round-trip
- Existing `GitStatusService.test.ts` test assertions (expected `GitStatusResponse` output) MUST remain unchanged. Test setup MAY change to inject a mock `IGitStatusWorker` instead of mocking `isomorphic-git` at the module level.

### NFR-006: Build integration

- The worker script MUST be bundled by electron-vite as a separate entry point
- The worker MUST NOT require changes to the preload or renderer build
- The worker entry point MUST be added to `electron.vite.config.ts` via `main.build.rollupOptions.input`:
  ```ts
  {
    index: resolve('src/main/index.ts'),
    'git-status.worker': resolve('src/main/services/workers/git-status.worker.ts')
  }
  ```
- In production (ASAR), the worker path resolves via `path.join(__dirname, 'git-status.worker.js')`. Verify path resolution in both dev and packaged builds.

### NFR-007: Security

- `execFile` MUST use array arguments (never `shell: true`)
- The `git` binary path MUST be resolved to an absolute path at first use and cached (see FR-004)
- The worker MUST only accept project paths that have already passed `validateProjectPath()` in the IPC handler

## Naming contracts

| Entity | Name | Location |
|--------|------|----------|
| Worker file | `git-status.worker.ts` | `src/main/services/workers/` |
| Worker interface | `IGitStatusWorker` | `src/main/interfaces/` |
| Size guard constant | `GIT_INDEX_SIZE_THRESHOLD` | `src/main/services/GitStatusService.ts` |
| Strategy type | `GitStatusStrategy` | `src/main/services/GitStatusService.ts` |
| Git binary path | `NATIVE_GIT_PATH` | `src/main/services/GitStatusService.ts` |
| Cache holder | `statusCache` (private field) | `GitStatusService` |
| Timing log prefix | `GitStatus:` | Logger output |

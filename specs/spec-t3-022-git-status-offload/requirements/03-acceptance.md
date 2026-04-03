# Acceptance criteria

## AC-001: Main-thread block eliminated

**Given** a repository with 50K+ tracked files (e.g., escape-fitness)
**When** git status is requested via `git:getStatus` IPC
**Then** the main thread blocks for less than 50ms (measured via performance.now() around the IPC handler)
**And** the git status response is delivered within 5 seconds

## AC-002: Worker thread active

**Given** the app is running with a project open
**When** git status is requested
**Then** the status computation runs in a worker thread (verified by absence of main-thread blocking in performance trace)
**And** the worker thread is reused across calls (not created per-call)

## AC-003: Cache improves repeated calls

**Given** a medium-sized repository (~5K files)
**When** git status is called twice in succession
**Then** the second call completes at least 2x faster than the first (cache hit)

## AC-004: Repo size guard activates

**Given** a repository with `.git/index` larger than `GIT_INDEX_SIZE_THRESHOLD` (default 5 MB)
**When** git status is requested
**Then** the service uses native `git status --porcelain` instead of `statusMatrix()`
**And** the log shows `GitStatus: native-git completed in {duration}ms`

## AC-005: Native git fallback produces correct response

**Given** the native git fallback is active
**When** git status is requested
**Then** the response has the same `GitStatusResponse` shape as the isomorphic-git path
**And** branch name, file statuses (modified, untracked, deleted, staged), and counts are correct
**And** untracked entries may be directory-level (e.g., `new-folder/`) when native git fallback uses `-unormal` – this is an accepted behavioral difference for large repos

## AC-006: Git unavailable graceful degradation

**Given** `git` is not available on PATH
**When** the repo size guard would trigger native git fallback
**Then** the service falls back to isomorphic-git in the worker thread
**And** a warning is logged: "Native git not available, using isomorphic-git"

## AC-007: Worker crash recovery

**Given** the worker thread crashes during a git status operation
**When** the next git status is requested
**Then** a new worker is created automatically
**And** the status response is returned successfully
**And** no error is visible to the user (internal recovery)

## AC-008: IPC contract unchanged

**Given** the existing renderer code that calls `api.git.getStatus()`
**When** the worker thread migration is deployed
**Then** the renderer code requires zero modifications
**And** all existing IPC schemas validate without changes

## AC-009: Timing instrumentation present

**Given** any git status operation completes
**Then** a log entry shows: `GitStatus: {strategy} completed in {duration}ms ({fileCount} files)`
**Where** strategy is one of: `isomorphic-git`, `native-git`

## AC-010: Existing tests pass

**Given** the worker thread migration is complete
**When** `npm run test` is executed
**Then** all existing tests in `GitStatusService.test.ts`, `git-handlers.test.ts`, and `GitWatcherService.pipeline.test.ts` pass without modification to test assertions

## AC-011: Worker cleanup on shutdown

**Given** the app is shutting down or the last project is closed
**When** the `dispose()` method is called
**Then** the worker thread terminates within 1 second
**And** no orphan worker threads remain

## AC-012: Cache lifecycle on project switch

**Given** a project is open and git status has been called (cache is warm)
**When** the project is closed and a new project is opened
**Then** a new cache is created for the new project (verified by first-call timing comparable to initial cold call)
**And** the previous project's cache is cleared (no memory leak)

## AC-013: Circuit breaker limits worker restarts

**Given** the worker has crashed 3 times within 60 seconds for the same project
**When** git status is requested again for that project
**Then** `getStatus()` returns a `GitStatusResponse` with the `error` field set
**And** no new worker is spawned for that project
**And** the log shows a circuit breaker activation message

## Definition of done

- [ ] All AC-001 through AC-013 pass
- [ ] Worker thread created and terminated correctly (no leaked threads)
- [ ] Performance comparison documented (before/after timing for small, medium, large repos)
- [ ] `GIT_INDEX_SIZE_THRESHOLD` constant added to `src/main/services/GitStatusService.ts`
- [ ] Worker entry point builds correctly via electron-vite
- [ ] No changes to shared IPC schemas or preload bridge
- [ ] `git` binary resolved to absolute path, not PATH-dependent
- [ ] Timing logs visible in `~/.erfana/logs/main.log`

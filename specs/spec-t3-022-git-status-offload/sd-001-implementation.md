# Design: Git status worker thread offloading

**Spec**: T3-022 | **Issue**: #147 | **Complexity**: complex

## Overview

Offload `isomorphic-git statusMatrix()` from the main Electron thread to a dedicated `worker_threads` Worker. Add a repo-size guard that switches to native `git status --porcelain` for large repos (>.git/index 5 MB). Add statusMatrix cache, circuit breaker for worker crashes, and timing instrumentation.

This is the first `worker_threads` usage in the codebase. The worker is persistent (created once, reused), lazily initialized, and bundled as a separate Rollup entry point via electron-vite.

## Architecture

```
IPC handler (git-handlers.ts)
  --> GitStatusService.getStatus(path)
        --> selectStrategy(path)  -- checks .git/index size
        --> worker.execute({ type, projectPath, ... })
              |
              v
        [Worker Thread: git-status.worker.ts]
              |- 'isomorphic-git': runs statusMatrix() with cache
              |- 'native-git': runs execFile('git', [...]) + parses porcelain
              |
              v
        <-- result via MessagePort (structured clone)
```

## Step-by-step implementation plan

### Step 1: Create IGitStatusWorker interface

**File**: `src/main/interfaces/IGitStatusWorker.ts` (create)

```ts
import type { GitStatusResponse } from '../../shared/ipc/git-schema'

export type GitStatusStrategy = 'isomorphic-git' | 'native-git'

export interface GitWorkerRequest {
  type: GitStatusStrategy
  projectPath: string
  /** Only used by native-git strategy */
  gitBinaryPath?: string
}

export interface IGitStatusWorker {
  /**
   * Execute a git status operation in the worker thread.
   * Returns the same GitStatusResponse shape regardless of strategy.
   */
  execute(request: GitWorkerRequest): Promise<GitStatusResponse>

  /**
   * Clear the statusMatrix cache (e.g., on project switch).
   */
  clearCache(): void

  /**
   * Terminate the worker thread.
   */
  terminate(): Promise<void>

  /**
   * Whether the worker is alive and ready.
   */
  isAlive(): boolean
}
```

**Rationale**: Follows the existing interface pattern (JSDoc, exported from `src/main/interfaces/`). The `execute()` method unifies both strategies behind a single call – the worker decides how to execute based on `type`. `clearCache()` is a fire-and-forget message (no response needed).

**Test**: N/A (interface only)

### Step 2: Create the worker script

**File**: `src/main/services/workers/git-status.worker.ts` (create)

This file runs inside a `worker_threads` Worker. It listens for messages from the parent and responds via `parentPort`.

**Message protocol**:

Parent --> Worker:
```ts
{ id: number, type: 'execute', payload: GitWorkerRequest }
{ id: number, type: 'clear-cache' }
```

Worker --> Parent:
```ts
{ id: number, type: 'result', payload: GitStatusResponse }
{ id: number, type: 'error', error: string }
{ id: number, type: 'ack' } // for clear-cache
```

**Key logic**:

- `isomorphic-git` path: Runs `git.statusMatrix({ fs, dir, cache })` with a module-level `statusCache: Map<string, object>` keyed by projectPath. Runs `git.currentBranch()` and `git.resolveRef()` for branch info. Maps the matrix rows to `GitFileEntry[]` (same logic as current `executeGetStatus()`). Applies `GIT_STATUS_CAP`.
- `native-git` path: Runs `execFile(gitBinaryPath, ['status', '--porcelain', '-z', '--no-renames', '-unormal'], { cwd: projectPath, timeout: 10_000, maxBuffer: 5_242_880 })`. Parses NUL-delimited output. Runs `execFile(gitBinaryPath, ['rev-parse', '--abbrev-ref', 'HEAD'], ...)` for branch. Handles detached HEAD (`HEAD` literal -> resolve short hash via `git rev-parse --short HEAD`).
- `clear-cache` message: Deletes all entries from `statusCache` map.
- All errors caught and returned as `{ type: 'error', error: message }`.

**Porcelain parser** (extracted as `parsePorcelainOutput(output: string, projectPath: string)`):

- Split on `\0` (NUL-separated due to `-z` flag)
- Each entry: first 2 chars = XY status code, chars [3..] = file path
- Map XY to `GitDisplayStatus` + `staged` per the table in FR-004
- Skip empty entries and `!!` (ignored files)
- Log warning for unknown XY codes
- Apply `GIT_STATUS_CAP`

**Test**: Unit tests in `src/main/services/workers/git-status.worker.test.ts` for the porcelain parser (extracted as a pure function). Worker communication tested via mock in Step 4.

### Step 3: Add build configuration for worker entry point

**File**: `electron.vite.config.ts` (modify)

Add `rollupOptions.input` to the `main` section:

```ts
main: {
  build: {
    minify: true,
    rollupOptions: {
      input: {
        index: resolve('src/main/index.ts'),
        'git-status.worker': resolve('src/main/services/workers/git-status.worker.ts')
      }
    }
  }
}
```

**Rationale**: Per NFR-006, the worker must be a separate entry point so it gets bundled as `git-status.worker.js` alongside `index.js` in the output directory. `__dirname` in the main process then resolves to the same directory.

**Test**: `npm run build` should produce `out/main/git-status.worker.js`.

### Step 4: Create GitStatusWorkerAdapter (IGitStatusWorker implementation)

**File**: `src/main/services/GitStatusWorkerAdapter.ts` (create)

This is the main-thread adapter that wraps the `worker_threads.Worker` and implements `IGitStatusWorker`.

**Key design decisions**:

- **Lazy creation**: Worker is not created until first `execute()` call (NFR-003).
- **Request/response correlation**: Uses an incrementing `requestId` counter and a `Map<number, { resolve, reject }>` for pending requests. The worker sends back `{ id, type: 'result'|'error', ... }`.
- **Worker path resolution**: `path.join(__dirname, 'git-status.worker.js')` works in both dev (electron-vite serves from out/) and production (ASAR).
- **Error handling**: Worker `'error'` event rejects all pending requests and marks worker as dead. Worker `'exit'` event does the same.
- **clearCache()**: Posts `{ id, type: 'clear-cache' }` – fire-and-forget (resolves on ack but caller doesn't wait).
- **terminate()**: Calls `worker.terminate()`, resolves pending promises with error.
- **isAlive()**: Returns `true` if worker exists and has not exited.
- **Restart on next call**: If `isAlive()` is false when `execute()` is called, create a new worker.

```ts
export class GitStatusWorkerAdapter implements IGitStatusWorker {
  private worker: Worker | null = null
  private requestId = 0
  private pending = new Map<number, { resolve: Function, reject: Function }>()
  private workerPath: string

  constructor(workerPath?: string) {
    this.workerPath = workerPath ?? join(__dirname, 'git-status.worker.js')
  }
  // ...
}
```

**Test**: `src/main/services/GitStatusWorkerAdapter.test.ts` – mock `worker_threads.Worker` constructor, verify message passing, error handling, lazy creation, terminate behavior.

### Step 5: Add constants to shared/constants.ts

**File**: `src/shared/constants.ts` (modify)

Add a new `GIT_STATUS` section:

```ts
export const GIT_STATUS = {
  /** .git/index size threshold for native git fallback (5 MB ~ 50K files) */
  INDEX_SIZE_THRESHOLD: 5 * 1024 * 1024,
  /** Timeout for native git execFile calls (ms) */
  NATIVE_GIT_TIMEOUT: 10_000,
  /** Max buffer for native git output (5 MB) */
  NATIVE_GIT_MAX_BUFFER: 5 * 1024 * 1024,
  /** Circuit breaker: max crashes before disabling worker for a project */
  CIRCUIT_BREAKER_MAX_CRASHES: 3,
  /** Circuit breaker: window in ms (crashes within this window count) */
  CIRCUIT_BREAKER_WINDOW_MS: 60_000,
} as const
```

**Rationale**: Follows the existing pattern of `SCREENSHOT`, `CAMERA`, `TRANSCRIPTION` etc. in `constants.ts`. The spec says `GIT_INDEX_SIZE_THRESHOLD` in `GitStatusService.ts`, but since all other threshold constants live in `constants.ts`, we'll export `GIT_STATUS.INDEX_SIZE_THRESHOLD` from constants and re-export it as `GIT_INDEX_SIZE_THRESHOLD` in `GitStatusService.ts` for spec compliance.

### Step 6: Refactor GitStatusService

**File**: `src/main/services/GitStatusService.ts` (modify – major refactor)

**Changes**:

1. **Constructor accepts IGitStatusWorker** (DI):
   ```ts
   constructor(worker?: IGitStatusWorker) {
     this.worker = worker ?? new GitStatusWorkerAdapter()
   }
   ```

2. **Add private fields**:
   - `statusCache` – not used directly (cache lives in worker), but `clearCache()` delegates to worker
   - `nativeGitPath: string | null = null` – resolved lazily
   - `circuitBreaker: Map<string, { crashes: number[], disabled: boolean }>` – per-project

3. **New executeGetStatus() flow**:
   ```
   a. Check .git directory exists (keep existing stat check)
   b. Stat .git/index -> determine strategy (isomorphic-git vs native-git)
   c. If native-git: resolve git binary path (once, cached)
   d. Check circuit breaker for this project
   e. Call worker.execute({ type: strategy, projectPath, gitBinaryPath })
   f. On worker crash: record in circuit breaker, restart worker, return error response
   g. Log timing with strategy tag
   ```

4. **Strategy selection** (`selectStrategy(projectPath: string): Promise<GitStatusStrategy>`):
   ```ts
   private async selectStrategy(projectPath: string): Promise<GitStatusStrategy> {
     try {
       const indexPath = join(projectPath, '.git', 'index')
       const indexStat = await stat(indexPath)
       if (indexStat.size > GIT_INDEX_SIZE_THRESHOLD) {
         // Check if native git is available
         if (await this.resolveGitPath()) {
           logger.debug('GitStatus: using native-git (index size exceeds threshold)', {
             indexSize: indexStat.size, threshold: GIT_INDEX_SIZE_THRESHOLD
           })
           return 'native-git'
         }
         logger.warn('GitStatus: native git not available, using isomorphic-git')
       }
     } catch {
       // .git/index doesn't exist or can't be read – use default
     }
     return 'isomorphic-git'
   }
   ```

5. **Git binary resolution** (`resolveGitPath(): Promise<string | null>`):
   ```ts
   private async resolveGitPath(): Promise<string | null> {
     if (this.nativeGitPath !== null) return this.nativeGitPath
     try {
       const { stdout } = await execFilePromise('which', ['git'])
       this.nativeGitPath = stdout.trim()
       return this.nativeGitPath
     } catch {
       this.nativeGitPath = '' // empty string = not available, don't retry
       return null
     }
   }
   ```
   Note: On Windows, use `where` instead of `which`. But since the current codebase uses macOS patterns (screencapture, etc.), we can start with `which` and add Windows support later.

6. **Circuit breaker**:
   ```ts
   private isCircuitOpen(projectPath: string): boolean {
     const state = this.circuitBreaker.get(projectPath)
     if (!state || !state.disabled) return false
     return true
   }

   private recordCrash(projectPath: string): void {
     const now = Date.now()
     let state = this.circuitBreaker.get(projectPath)
     if (!state) {
       state = { crashes: [], disabled: false }
       this.circuitBreaker.set(projectPath, state)
     }
     state.crashes.push(now)
     // Remove crashes outside the window
     state.crashes = state.crashes.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS)
     if (state.crashes.length >= CIRCUIT_BREAKER_MAX_CRASHES) {
       state.disabled = true
       logger.error('GitStatus: circuit breaker activated', { projectPath, crashes: state.crashes.length })
     }
   }
   ```

7. **dispose() method**:
   ```ts
   async dispose(): Promise<void> {
     this.worker?.clearCache()
     await this.worker?.terminate()
     this.operationQueues.clear()
     this.circuitBreaker.clear()
   }
   ```

8. **Keep operation queue** – the per-project queue is preserved. The queue serializes calls to the worker for the same project.

9. **Re-export constants** for spec compliance:
   ```ts
   export const GIT_INDEX_SIZE_THRESHOLD = GIT_STATUS.INDEX_SIZE_THRESHOLD
   export type { GitStatusStrategy } from '../interfaces/IGitStatusWorker'
   ```

10. **Factory update**:
    ```ts
    export function createGitStatusService(worker?: IGitStatusWorker): GitStatusService {
      return new GitStatusService(worker)
    }
    ```

### Step 7: Wire dispose() in app lifecycle

**File**: `src/main/index.ts` (modify)

Add `gitStatusService.dispose()` to the `before-quit` handler:

```ts
import { gitStatusService } from './services/GitStatusService'
// ...
app.on('before-quit', async () => {
  // ... existing dispose calls ...
  await gitStatusService.dispose()
})
```

**Also** import the singleton at the top of index.ts (currently it's only imported transitively via git-handlers.ts).

### Step 8: Update git-handlers.ts for interface typing

**File**: `src/main/ipc/git-handlers.ts` (minor modify)

The DI parameter type changes from `GitStatusService` class to accept any object with `getStatus()`. However, since `GitStatusService` is a concrete class and the handler already uses it, minimal change is needed – just ensure the import of the type still works. The function signature stays the same since `GitStatusService` now has `dispose()`.

### Step 9: Update existing tests

**File**: `src/main/services/GitStatusService.test.ts` (modify)

The existing tests mock `isomorphic-git` at module level. After refactoring, `GitStatusService` no longer calls isomorphic-git directly – it delegates to the worker. Tests need to:

1. Provide a mock `IGitStatusWorker` to the constructor
2. Keep the same test assertions (AC-010)
3. The mock worker's `execute()` returns pre-built `GitStatusResponse` objects

The test setup changes but assertions remain identical. New test sections:
- Strategy selection (mock `.git/index` stat)
- Circuit breaker behavior
- Worker crash recovery
- Cache clearing on dispose
- Native git path resolution

**File**: `src/main/ipc/git-handlers.test.ts` (no changes needed)

The handler test mocks `GitStatusService` at module level, so it remains unaffected.

### Step 10: Create worker unit tests

**File**: `src/main/services/workers/git-status.worker.test.ts` (create)

Test the porcelain parser as a pure function (export it separately for testability):

- Maps `M ` to modified/staged
- Maps ` M` to modified/unstaged
- Maps `??` to untracked
- Maps `D ` to deleted/staged
- Maps ` D` to deleted/unstaged
- Maps conflict codes to conflicted
- Skips `!!` entries
- Warns on unknown codes
- Handles empty output
- Applies GIT_STATUS_CAP
- Handles NUL-delimited splitting correctly

### Step 11: Create adapter unit tests

**File**: `src/main/services/GitStatusWorkerAdapter.test.ts` (create)

Mock `worker_threads.Worker`:
- Lazy worker creation on first execute()
- Message correlation (request/response by id)
- Worker error event rejects pending promises
- Worker exit event marks as not alive
- terminate() calls worker.terminate()
- clearCache() sends clear-cache message
- Restart on next execute() after crash

## File change summary

| File | Action | Description |
|------|--------|-------------|
| `src/main/interfaces/IGitStatusWorker.ts` | create | Worker interface + message types |
| `src/main/services/workers/git-status.worker.ts` | create | Worker thread script |
| `src/main/services/GitStatusWorkerAdapter.ts` | create | Main-thread adapter wrapping Worker |
| `src/main/services/GitStatusService.ts` | modify | DI, strategy selection, circuit breaker, dispose() |
| `src/shared/constants.ts` | modify | Add GIT_STATUS constants section |
| `electron.vite.config.ts` | modify | Add worker entry point to rollupOptions |
| `src/main/index.ts` | modify | Wire gitStatusService.dispose() in before-quit |
| `src/main/ipc/git-handlers.ts` | modify | Minor – ensure imports still work |
| `src/main/services/GitStatusService.test.ts` | modify | Switch to mock IGitStatusWorker, add new test sections |
| `src/main/services/workers/git-status.worker.test.ts` | create | Porcelain parser unit tests |
| `src/main/services/GitStatusWorkerAdapter.test.ts` | create | Adapter unit tests with mocked Worker |

## Risks

### 1. Worker bundling path resolution (likelihood: medium, impact: high)

The worker path `join(__dirname, 'git-status.worker.js')` must resolve correctly in both dev mode (electron-vite dev server) and production (ASAR). electron-vite may place the worker output in a different directory.

**Mitigation**: Test both `npm run dev` and `npm run build:mac` during implementation. Log the resolved worker path at debug level. Fall back to main-thread execution if worker creation fails (NFR-003).

### 2. isomorphic-git in worker thread (likelihood: low, impact: high)

isomorphic-git uses Node.js `fs` module. In a `worker_threads` Worker, `fs` is available, but some edge cases around `ASAR` file paths might differ. The `fs` import in the worker is the real `fs`, not Electron's patched `fs`.

**Mitigation**: The worker operates on project directories, not ASAR contents. isomorphic-git reads `.git/` which is always on real filesystem. No ASAR conflict expected.

### 3. Structured clone limitations (likelihood: low, impact: low)

`GitStatusResponse` contains only serializable data (strings, numbers, booleans, plain arrays/objects). No functions or class instances. Structured clone should work without issues.

### 4. `which` command not available on Windows (likelihood: medium, impact: low)

The `which` command is Unix-only. Windows uses `where`.

**Mitigation**: Add platform check: `process.platform === 'win32' ? 'where' : 'which'`. The codebase currently has macOS-specific code (screenshot, etc.) so this is low priority but should be handled.

### 5. Test migration complexity (likelihood: medium, impact: medium)

Existing GitStatusService tests mock isomorphic-git at module level. After refactoring, the service delegates to the worker. Tests must change setup (inject mock worker) but keep the same assertions (AC-010).

**Mitigation**: The mock IGitStatusWorker's `execute()` can be configured to return the exact same `GitStatusResponse` objects the tests currently expect. Assertion lines remain identical.

## Verification criteria

- [ ] `npm run test` passes – all existing tests green (AC-010)
- [ ] `npm run build` produces `out/main/git-status.worker.js`
- [ ] `npm run dev` starts without errors, git status works in UI
- [ ] Log output shows `GitStatus: isomorphic-git completed in Xms` for normal repos
- [ ] For repos with large .git/index (>5 MB), log shows `GitStatus: native-git completed in Xms`
- [ ] Worker thread visible in Activity Monitor / process list
- [ ] `dispose()` terminates worker (no orphan threads)
- [ ] Circuit breaker activates after 3 crashes in 60s (verified via test)
- [ ] Cache improves repeated call performance (verified via timing logs)
- [ ] No changes to `src/shared/ipc/git-schema.ts` or preload

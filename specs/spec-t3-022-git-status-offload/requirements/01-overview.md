# Git status thread offloading

## Problem statement

Erfana's `GitStatusService` calls `isomorphic-git statusMatrix()` on Electron's main thread (line 129 of `src/main/services/GitStatusService.ts`). For large repositories (e.g., escape-fitness: 56,750 files, 11GB .git with Git LFS), this blocks the Node.js event loop for 5–30 seconds per call, freezing all IPC communication. The UI becomes completely unresponsive – terminal I/O stops, file operations queue, and settings calls block.

The existing `GIT_STATUS_CAP = 10000` limits output but does not prevent the expensive scan. Hidden folder patterns (`.erfana/settings.json`) only affect the tree UI and directory watcher – `statusMatrix()` always reads the full `.git/index`.

## Objective

Eliminate main-thread blocking during git status operations so that the UI remains responsive regardless of repository size.

## Success criteria

- Main-thread block time < 50ms for git status operations on any repo size
- Zero breaking changes to the existing IPC contract (`GitStatusResponse`, `git:state-changed`, `git:poll-triggered`)
- Git status results still delivered to renderer within 5 seconds (existing polling interval)

## Scope

**In scope:**
- Worker thread migration for `statusMatrix()` (via Node.js `worker_threads`)
- Repo size guard based on `.git/index` file size
- Native `git status --porcelain` fallback for oversized repos
- `cache` parameter addition to `statusMatrix()` calls (quick win)

**Out of scope:**
- Bundling native git binary (dugite-native) – not needed, relies on system git
- Changes to GitWatcherService or GitPollingService trigger logic
- Renderer-side changes (worker is internal to GitStatusService)
- Scoped `filepaths` filter for `statusMatrix()` (requires IPC contract changes to pass changed file paths from watcher – tracked as future optimization)
- React memoization (separate issue #149)
- Tree virtualization (separate issue #150)
- EMFILE cascade fix (separate issue #146)

## Architecture context

The git status pipeline flows:
1. **Trigger:** GitWatcherService (chokidar on .git/ files) or GitPollingService (.git/index mtime check)
2. **IPC broadcast:** `git:state-changed` or `git:poll-triggered`
3. **Renderer hook:** `useGitStatus` (debounce + cooldown + visibility gating)
4. **IPC invoke:** `git:getStatus` → `GitStatusService.getStatus()` → **`statusMatrix()` blocks main thread**
5. **Store update:** `useGitStore` (Zustand) → ProjectTree re-render

This spec modifies step 4 only. Steps 1-3 and 5 remain unchanged.

## Related issues

- #147 – feat: Offload git status to worker thread for large repositories
- #146 – fix: EMFILE cascade in DirectoryWatcherService restart logic
- #148 – fix: GitWatcherService silently fails to start for large repos
- #105 – Add performance benchmarks for readDirectory and watcher init at scale

## Research findings

- **VS Code** uses native `git status -z -uall` via child process, not isomorphic-git. Has 5,000 file threshold for degraded features.
- **GitHub Desktop** bundles native git via `dugite-native`, explicitly avoided isomorphic-git for production.
- **isomorphic-git `cache` parameter** reduces repeated calls from 2min to <8sec (biggest quick win).
- **`worker_threads`** preferred over `utilityProcess` because isomorphic-git is pure JS (no native modules), lower overhead, and easier data transfer.
- **`git status --porcelain`** with `--untracked-files=no` completes in ~110ms even on massive repos (vs 5-30s for statusMatrix on 56K files).

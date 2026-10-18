# Design – Issue #211: large projects on Windows (native watcher, exclude list, watcher after first read)

> **Status:** implemented on `fix/211-large-project-windows-stall` (W0–W16; the W17 manual Windows run is still to be recorded). Revised after review rounds 1 and 2 and amended with the W0 spike results (section 12). Where the code and this note differ, the code and the docs listed in section 11 are authoritative – for example, the native watcher's `ready` log line is `Native directory watcher ready`, and the merged exclude list compiles with twice the per-source caps (512 entries, 8,192 characters).
> **Issue:** #211 · **Branch:** `fix/211-large-project-windows-stall` · **Base:** `develop`
> **Inputs:** the user-confirmed requirements (option B, AC1–AC8), the Phase 3 discovery map and the W0 spike ([`docs/spikes/211-windows-fs-watch.md`](../spikes/211-windows-fs-watch.md)). Line numbers are as of `631d97eb`.
> **Layout note:** [`README.md`](README.md) in this folder asks for a folder per *designed feature* with screens and states. This is an architecture note with no screens, so it follows the single-file notes beside it (`216-…`, `47-…`).

## 1. Summary

On a Windows project of about 222,000 entries the first tree takes 148 s and file open, git status and later refreshes stall. Three causes, three fixes:

1. **Windows watching is replaced.** chokidar 3.6.0 opens one `fs.watch` handle per folder and scans the whole project while the first tree read runs. On Windows each project now gets **one watcher** built on Node's own `fs.watch`: a small, bounded set of native handles, planned so that excluded, hidden and ignored folders – at the top level, along exclude paths, and wherever the first tree read met them – get no handle at all. macOS and Linux stay on chokidar 3.6.0.
2. **A new `files.exclude` list** (global `~/.erfana/settings.json` plus project `.erfana/settings.json`, which adds to it) takes a folder out completely: not read, not shown, not watched, and changes inside it do nothing.
3. **Nothing competes with the first read.** The directory watcher starts only after the first tree read settles, and a watcher batch whose paths are all excluded, hidden or ignored never reaches the renderer – so it triggers neither a tree re-read nor a git refresh.

## 2. Problem recap (verified in source)

- `DirectoryWatcherService.watchDirectory` (`src/main/services/DirectoryWatcherService.ts:209-224`) calls `chokidar.watch(root)` with no platform branch; chokidar v3 on Windows walks every folder and opens one non-recursive `fs.watch` per folder.
- The renderer starts the watcher at once: `initialLoadCompleteRef` is set to `true` on mount (`src/renderer/src/hooks/useProjectManagement.ts:166-170`), so `shouldStartWatcher` (`useDirectoryWatcher.logic.ts:17`) never waits for the first read (`useProjectManagement.ts:201`). chokidar's scan and the tree walk share libuv's default four-thread pool.
- `queueEvent` (`DirectoryWatcherService.ts:558-595`) has no path filter: a hidden-but-watched path (`.git/index.lock`, created by every git write) reaches `processEvents` and is broadcast. The renderer re-reads the whole tree **and** refreshes git on every `directory-watch:changed` (`useDirectoryWatcher.ts:87-102`, `useGitStatus.ts:252`).
- The ignore check (`DirectoryWatcherService.ts:95-103`) is a substring test on the **absolute** path, so a project that itself lives under a folder named `build`, `out`, `dist`… is never watched.
- The only tree walk is `FileService._readDirectoryInternal` (`src/main/services/FileService.ts:260-309`): sequential, skips entries whose name is in `hiddenPatterns`, treats a symlink `Dirent` as a leaf (`:278`), no other exclusion.
- Only `unlinkDir` prunes the events under a deleted folder (`watcher/EventCoalescer.ts:95`); every `unlink` goes through `AtomicSaveDetector` (`DirectoryWatcherService.ts:580`), which waits and then runs one unthrottled `stat` per path (`watcher/AtomicSaveDetector.ts:128`).
- `restartWatcher` removes the map entry before re-watching (`DirectoryWatcherService.ts:943`), so when the attempts run out `notifyWebContents` finds no entry (`:661-662`) and `directory-watch:restart-failed` (`:973`) is never delivered – pre-existing.
- No code awaits the watcher's `ready` (grep over `src/main`): AC5 is about contention, not an explicit wait.

## 3. Decisions

**D0 – The spike (W0) is done.** Measured on this host under Electron 39.8.10 (Node 22.22.1, **libuv 1.51.0**), recorded in `docs/spikes/211-windows-fs-watch.md`. Verdict: proceed with `fs.watch` recursive; `@parcel/watcher` is not needed. D1, D2, D3 and D15 below use its measurements; the changes are listed in section 12.

**D1 – Windows backend: one watcher per project on `fs.watch`, with a split plan.** The owner asked for "one Windows watcher for the whole project"; requirements put built-in `fs.watch` first and `@parcel/watcher` only if needed. libuv's Windows watcher reads `ReadDirectoryChangesW` into a 4 KB buffer (about 40–45 notifications of 40-character names, W0) and re-arms it only after the JS callbacks for that batch have run. With the main thread busy, a burst of 20 or more files is lost whole and reported as **one** `change` with a `null` filename, which can only be answered with a full re-read. One `NativeRecursiveWatcher` per project therefore keeps dropped churn out of every buffer:
- the root is watched **non-recursively**; every direct child folder of a *split folder* that is not dropped (D4) gets **one recursive** watch, unless it is itself a split folder, where the rule repeats one level down; dropped children get no handle;
- split folders = the root plus each proper ancestor of a *split path*. Split paths are (1) the **path-type** exclude entries, then (2) the **walk hints**: the dropped folders (excluded, hidden or ignored) at two or more segments deep that the last completed root tree walk met – `packages/a/node_modules`, `a/b/test-tmp` from `**/test-tmp`, `src/dist`. The walk visits every folder anyway, so a hint costs one drop test and no I/O. Hints are read when the watcher plans (start, restart); every completed root walk replaces them;
- **caps:** at most 64 path-entry split paths and 64 hints, each at most 16 segments deep, and at most 512 handles. Past a cap the folder keeps one recursive watch (its events are still dropped by D4) and `ready` logs `planCapped: true`;
- the plan reads folders with `readdir({ withFileTypes: true })` and confirms a link-typed entry with `lstat`; symbolic links and junctions are leaves – never split, never watched. W0 confirmed that junctions, directory symlinks and file symlinks are all link-typed in `readdir` and `lstat`, and that a recursive watch does not report inside them;
- every handle is opened on a path under `fs.realpathSync.native(root)` – not `fs.realpathSync`, which keeps the 8.3 short form. A short-name watch aborts the process on libuv 1.52.x (fixed in 1.53.0); Electron 39's libuv 1.51.0 is not affected (W0), so this only guards the next Electron upgrade, at no cost. Emitted paths are joined onto the caller's root string;
- every watch map, split-folder listing and path-entry lookup is keyed by the folded name when the platform is case-insensitive, so `Src` → `src` re-lists instead of opening a second watch, and `.Local/test-tmp` still splits `.local`.

Handles ≈ 1 + top-level folders + the siblings along split paths (tens to a few hundred), against one per folder (tens of thousands) under chokidar. Contingency: if W17 records overflow resyncs that break AC3 under ordinary work, switch this backend to `@parcel/watcher` behind the same seam (D6) in a follow-up issue.

**D2 – Event mapping by `lstat`, bounded.** `fs.watch` reports only `rename`/`change` plus a name relative to the watched folder. The consumers need `add`/`addDir`/`unlink`/`unlinkDir`/`change`. Each surviving raw event is classified by one `lstat` (no symlink follow) in a queue with **at most 2 stats in flight** (half of libuv's default pool, so file open and the tree walk keep slots – AC2), per-path de-duplication (`rename` wins over `change`) and a **10,000-path backlog cap**. Removals are collapsed, because only `unlinkDir` prunes a deleted folder's children downstream (and W0 saw a deleted folder's own removals only partly reported):
- a `rename` for a path that has queued descendants jumps the queue; if it is gone, the classifier emits one `unlinkDir` and drops the queued descendants without a stat, and any path later queued under it is dropped the same way until the queue drains;
- a gone path is reported as `unlinkDir` when it was a known folder (an open watch, an entry of a split-folder listing, an emitted `addDir`, or it had queued descendants), otherwise `unlink`;
- a resync (D3) clears the queue – the re-read covers it;
- native `unlink` events skip `AtomicSaveDetector` in `queueEvent`: the `lstat` already confirmed the absence, a rename-style save is de-duplicated into one `lstat` or coalesced (`unlink` + `add` → `change`), and a large delete can no longer start one unthrottled `stat` per file.

**Renamed watched folder.** W0: renaming a watched folder succeeds, and its handle **follows the moved folder**, reporting new changes under the old name. So a raw `rename` from a parent watch for a name that has an open watch **retires that watch synchronously** in the callback: its later events are dropped at the first line of its callback. Once the old name is classified, the retired handle is closed – gone → `unlinkDir` + close every watch under it; a readable directory at the old name (renamed back, or a new folder) → a fresh watch per the plan, then a resync. The new name arrives as its own `rename` and is planned like a folder at start: `addDir` once its watch is open (a split folder gets its non-recursive watch and its children planned; a dropped name gets no handle).

| Raw event | `lstat` result | Emitted |
|---|---|---|
| `rename` | file or symlink | `add` |
| `rename` | directory | `addDir`; for a direct child of a split folder, only **after** its watch is open – the tree re-read that follows picks up whatever was created before |
| `rename` | `ENOENT` / `ENOTDIR` | `unlink` or `unlinkDir` (above) + close every watch at or under it |
| `rename` | `EPERM` / `EBUSY` on a path with an open watch – *defensive: not seen on this host (W0), kept for other file systems and Windows versions* | close that watch, then the D15 re-check: only a **readable directory** re-opens (within the D15 cap) and resyncs; anything else means gone → `unlinkDir` + close every watch under it, no re-open |
| `rename` | other error (AV or sync locks) | `add` |
| `change` | file | `change` |
| `change` | directory | dropped (folder timestamp noise) |
| `change` | `ENOENT` | dropped (the removal arrives as `rename`) |
| `change` | other error | `change` |

**D3 – Lost events.** A `null` filename is how Node surfaces libuv's buffer overflow. W0: with the main thread busy, each lost burst arrives as **exactly one** `null`; with it idle, a 5,000-file burst gave 63–123 `null`s in about 2.5 s, with 15–35 % of names still arriving in between; the watch keeps working after an overflow, so no re-open is needed.
- On a **split folder's** (non-recursive) watch: re-list that folder, diff against its listing, emit only the differences. The listing is updated on every classified `rename` in that folder, so the diff never reports stale adds or removes.
- On a **recursive** watch, or when the backlog cap trips: request a *resync*, debounced **1 s quiet, 5 s maximum wait** (confirmed by W0: a whole 5,000-file burst of `null`s collapses into one resync about 1 s after it ends). The service answers a resync with one `catchUp` refresh; while paused it records it in the pause episode instead (D13). Names that still arrive during the burst are classified as usual.
- The resync reason is a closed set (`overflow`, `backlog`, `watch-error`, `reopen`); resync and error log lines carry the reason, `err.code` and counts – never a Node error message, which contains absolute paths.

**D4 – Filter before any work.** Order on Windows: `fs.watch` callback → **handle retired or closed? return** → self-event check (D15) → overflow check → **project-relative** POSIX path → **drop test** (exclude, hidden, ignore, depth) → classify queue → emit → `queueEvent` → session guard → **drop test again (backstop, both backends)** → pause drop accounting → metrics → atomic-save (chokidar only) / throttle → coalesce → broadcast. A dropped path is never `lstat`ed, never counted as a missed change while paused, and never broadcast. Relative paths are taken against the current **project root** (the same base as the tree walk), not the watch root, so a watch on a subfolder applies the same list; a path outside the project is dropped (fail closed). On chokidar the same drop test is the `ignored` option, so excluded and hidden folders are not watched at all.

**D5 – `directoryWatchDepth` on Windows** is honoured by filtering events deeper than the setting (a path with *n* segments is dropped when *n* − 1 > depth – chokidar's semantics). Handles stay recursive.

**D6 – Backend seam and escape hatch.** New `selectDirectoryWatchBackend(platform, env)` in `watcher/directoryWatchBackend.ts`: `win32` → `native-recursive`, otherwise `chokidar`; `ERFANA_DIRECTORY_WATCHER=chokidar` forces chokidar (support and diagnosis only – no setting, no UI). `DirectoryWatcherService` takes an optional constructor option `{ backend }` that defaults to the selector, reads it once and logs the choice at the first watch; W13 constructs the service with `{ backend: 'native-recursive' }`. `tests/setup/setupTests.main.ts` mocks the module wholesale to return `chokidar` – the same precedent as its `senderValidation` default – so every chokidar-mocking suite behaves identically on a Windows host; the module's own test uses `vi.unmock`.

**D7 – Where the list lives, and who merges it.** A new top-level section `"files": { "exclude": [] }` in both files (VS Code users know `files.exclude`; a section keeps the global file's shape). Both parse **leniently** with one shared schema: a non-array becomes `[]`, a non-string entry becomes `''` (kept, so indexes still point at the user's line), a malformed section falls back to defaults. A bad entry therefore never resets the global file (its corruption handler replaces *everything*, `GlobalSettingsService.ts:207-211`) and never blocks a project from opening (`ProjectSettingsService` throws on any schema failure). `ProjectSettingsService` owns the merge, next to the pattern merging it already does (`resolvePatterns`, `ProjectSettingsService.ts:120-138`): it gets the global list through a provider set once in `file-handlers.ts` (default `() => []`) and resolves `excludePatterns` – global then project, each validated, de-duplicated – plus `excludeRejections: { source, index, reason }[]`. The project list only adds (no replace mode). `ProjectService` logs and applies; it gains no constructor argument.

**D8 – Entry semantics.**
- Normalisation: trim; `\` → `/`; collapse repeated `/`; drop a leading `./`, **one leading `/`** (root-anchored, as `.gitignore` users write it), a trailing `/` and a trailing `/**`.
- Rejected with a reason (logged by index, never by value): blank; a drive or UNC path (`C:…`, `//…`); a `..` segment; a control character (U+0000–U+001F) or one of `< > : " |`; no character other than `*`, `?`, `/` (`*`, `**` would hide the project); longer than 256 characters; more than 8 wildcards (`*`, `?`) or more than 4 `**` segments; past the 256th entry or the 4,096th character of a source.
- `.erfana` and everything under it is **never excluded**, from either source: the file that explains what is hidden stays reachable in the tree.
- **Path entry** (no `*` or `?`): a project-relative path; matches that path and everything under it. `tmp` means the root-level `tmp` only. Path entries sit in a set of (folded) paths; a test looks up the path and each ancestor.
- **Pattern entry** (contains `*` or `?`): matched against the project-relative path; `*` = any run of characters except `/`, `?` = one such character, `**` as a whole segment = zero or more segments. Matching the path **or any ancestor** excludes it (so `**/test-tmp` removes the folder and all inside), tested in one pass that accepts when the pattern ends at any segment boundary. The tree walk tests only the entry itself, since an excluded folder is never entered. `*.log` is root-level only; `**/*.log` is anywhere. `[`, `{`, `!` are literal (Next.js `[id]` folders stay addressable).
- Case-insensitive where the platform is (`getPlatformConfig().caseSensitive`: Windows and macOS insensitive, Linux sensitive). Paths are compared with `/` separators on every platform.

**D9 – In-house matcher, no regex, no new dependency, bounded work.** `picomatch` is only transitive (via chokidar 3) and would bring a lockfile change (the `npm install` lock-rewrite hazard in `CLAUDE.md`), a licence-compliance entry and gitignore-like features we do not want to promise. More important: a cloned repo's `.erfana/settings.json` is untrusted input, and a hostile pattern such as `*a*a*a*a*b` against long names costs polynomial work on the main thread. The matcher is a segment DP with a two-pointer star matcher and no `RegExp`, bounded twice:
- every `isExcluded` call has a **hard budget of 20,000 character comparisons**: past it the path counts as not excluded (fail open – shown and watched) and `matcherBudgetExceeded` is counted in the walk's `completed` line and the watcher health line;
- a **tripwire** per compiled matcher (one per project open): after **100** budget overruns, the matcher switches its pattern entries off for the rest of that project session – path entries keep working – and logs one `warn` (`Exclude patterns disabled: match budget exceeded`, counts only).

With the D8 caps a real list stays far below the budget; W1 proves both bounds.

**D10 – Scope of the list.** Excluded paths are skipped by the tree walk (without reading them), by both watcher backends and by the event filter. **Git status does not honour it:** it reports the repository (`git status -uall`, `git-status.worker.ts:305-309`), `.gitignore` is the tool for that, and threading `:(exclude)` pathspecs through two strategies is separate work. AC2's git-status bound therefore assumes the excluded folder is also gitignored (this repository ignores `.local/`); W17 records it. The per-file watcher of an open file inside an excluded folder keeps working (separate service).

**D11 – When changes apply:** at the next project open. The global file is read once at app start (the service has no file watcher) and the project file at every switch, as for `tree.hiddenPatterns` today. Live re-apply would need a watcher restart plus a re-read for a list with no UI – not worth it.

**D12 – Watcher after the first tree read.** `useProjectManagement` gains a `firstReadPending` state and redefines `initialLoadComplete` as `projectPath !== null && !firstReadPending` (the always-true ref and `shouldMarkInitialLoadComplete` go). `true` is set in the same synchronous block as `setProjectPath(newPath)` in the `project:changed` listener, before the `await`, so the render that remounts `ProjectTree` never starts a watcher early. It is cleared when that load settles – **success or failure**, so a failed first read can still self-heal through the watcher – in the current scope; when a superseding reload settles; on close; and in `setProjectPathAndScope` **only** in the branch where the path changes and no pending load is superseded (`useProjectManagement.ts:121-132`, the `setLoading(false)` branch – the main-side no-op re-open, which sends no `project:changed`). The same-path branch never clears it, so an IPC reply that lands while the listener's read is pending keeps the gate closed. #208 single-flight is untouched; a pause or resume before the watcher exists is already a no-op.

**D13 – What reaches the renderer.** A batch whose events were all dropped is never broadcast (D4), so it cannot start a tree re-read or a git refresh (AC4). Dropped paths also stop counting as missed changes while paused – correct, since they are invisible. `PauseEpisode.recordUnknownDrop()` counts a resync during a pause as one uncovered structural drop; a completed read by the pausing window that *began after it* covers it, as for any drop (#210). Every broadcast batch still re-reads the tree, as today (see section 10 for content-only batches).

**D14 – Hidden and ignore patterns in the watcher are evaluated on the project-relative path.** Hidden: any path segment equal to a hidden name (the tree's exact rule, so the tree and the watcher agree). Ignore: the existing substring rule (`('/' + rel).includes('/' + pattern)`), now also matching `.yarn/cache` on Windows and no longer tripping on the project's own parent folders. The `out` matches `outline` substring defect is left as is (section 10).

**D15 – A watched folder's own removal on Windows.** W0 (libuv 1.51.0): deleting a watched folder – in-process or from another process, child or root – makes its own handle emit `rename` with the folder's **absolute path in Node's namespaced form** (`\\?\C:\…`, or `\\?\UNC\server\share\…`), never the basename and never an `error`. libuv emits it only when the watched directory is delete-pending, then re-arms, which fails again at once: the event **repeats about 65,000–72,000 times a second, one core at 100 % on the main thread, until the handle is closed**, and re-creating the folder does not stop it. The name is gone at once (`lstat` → `ENOENT`), the parent is removable and the name can be re-created, but the old handle never sees the new folder. So:
- **Self-event test, first in the callback after the retired check:** strip the prefix (`\\?\UNC\` → `\\`, `\\?\` → ``), fold when case-insensitive, and compare with the handle's own watched path (the realpath form). Only an absolute filename is tested; a relative one is never joined as absolute.
- **On the first self-event, synchronously inside the callback:** mark the handle retired and call `close()`, before any `lstat`, timer, queue entry or log line. Every later self-event from the flood returns at the retired check – O(1), no allocation – so a flood that arrives before the close takes effect cannot queue work. Then schedule **one** re-check.
- **Re-check after a close** (also used by the D2 `EPERM`/`EBUSY` row, the renamed-folder rule and a watch that reports an error): one `lstat`. Only a **readable directory** – necessarily a new folder the old handle cannot see – opens a fresh watch per the plan and requests a resync. `ENOENT` (the measured case), `ENOTDIR`, `EPERM` or any other error means **gone**: a child watch emits `unlinkDir` (covering its only partly reported removals) and closes every watch under it; the root closes every handle and emits an `error` with code `ENOENT`, which takes the existing restart path. Nothing is ever kept on the old handle.
- **Re-open cap:** at most 3 re-opens per path in 60 s. Past it the path is left unwatched, one resync is requested and a rate-limited `warn` logs the count, so a watch that keeps failing cannot loop on the main thread. A folder left unwatched – by the cap, or treated as gone while it is in fact still there – is shown by the tree re-read that follows and watched again at the next restart or project open.
- **Defensive paths, not seen on this host:** an `error` event with `EPERM` on any watch runs the same close and re-check; the D2 `EPERM`/`EBUSY` row stays. The basename form was never seen and is not handled – if an Electron upgrade changes the shape, W14 fails.
- The constructor resolves the root with `realpathSync.native` and watches it synchronously, so it throws `ENOENT` when the root is missing – and reports an `EPERM` on the root as `ENOENT` (defensive) – and restarts fail fast. When the attempts run out on `ENOENT`, `restartWatcher` sends `directory-watch:project-deleted` (not `restart-failed`) through D16. chokidar closes its own handle after a few self-events (W0: 18, then 2 % CPU), so macOS and today's behaviour are unaffected.

**D16 – Restart outcomes reach the renderer.** A private `notifyIds(webContentsIds, channel, data)` sends to the captured ids without needing the map entry; `restartWatcher` uses it for `restart-failed` and `project-deleted`. This also fixes the pre-existing lost `restart-failed`.

## 4. Flow after the change

```
main  switchProject: stop watchers → ProjectSettingsService.loadSettings (merges files.exclude: global + project)
      → log rejections → filter = new ProjectPathFilter(root, { exclude, hidden, ignore })
      → FileService.setHiddenPatterns / setPathFilter(filter) → DirectoryWatcherService.setPathFilter(filter) → project:changed
rend  listener: setProjectPath + firstReadPending=true → file:readDirectory → apply → firstReadPending=false
main  root walk: skips excluded/hidden, records walk hints on the filter
      useGitStatus starts at once (unchanged)            useDirectoryWatcher starts only now
main  watchDirectory: backend from the constructor option (D6)
        win32  → NativeRecursiveWatcher(realpath root, { shouldDrop, splitPaths + hints }) – plan, then 'ready'
        other  → chokidar.watch(root, { …unchanged, ignored: shouldDrop })
      events → queueEvent (drop test → pause → throttle) → processEvents → renderer (tree re-read + git refresh)
```

## 5. Component changes

**Shared schema – `src/shared/ipc/files-exclude-schema.ts` (new).** `ExcludeListSchema = z.array(z.string().catch('')).catch([])`; `FilesSettingsSchema = z.object({ exclude: ExcludeListSchema }).catch(() => ({ exclude: [] }))`. `project-settings-schema.ts` adds `files: FilesSettingsSchema.optional()` and `ResolvedProjectSettings.excludePatterns: string[]` plus `excludeRejections`; `global-settings-schema.ts` adds `files: FilesSettingsSchema` (missing → `{ exclude: [] }`, written to disk with the defaults).

**Matcher – `src/main/utils/excludeMatcher.ts` (new, pure).** `normalizeExcludeEntry`, `validateExcludeEntries(entries) → { accepted, rejected: { index, reason }[] }`, `compileExcludeMatcher(entries, { caseSensitive, onPatternsDisabled? })` – which validates itself, so an unvalidated entry can never reach the matcher – `→ { size, pathEntries, isExcluded(rel), isEntryExcluded(rel), budgetExceeded, patternsDisabled }`, `EMPTY_EXCLUDE_MATCHER`, and the D8/D9 constants (including the budget and the tripwire count). `isExcluded('')` is always false; so is any path at or under `.erfana`.

**Path filter – `src/main/utils/projectPathFilter.ts` (new).** `toRootRelative(root, absPath)` → `''`, a `/`-separated relative path, or `null` when outside (built on `isLexicallyInside`, `src/main/utils/projectConfinement.ts:53`). `ProjectPathFilter(root, { exclude, hiddenPatterns, ignorePatterns, caseSensitive })` with `isExcluded`, `isHidden`, `isIgnored`, `shouldDrop(rel | null)` (true for `null`, never for `''`), `splitPaths()` (the path entries, capped) and the walk hints: `replaceWalkHints(list)` / `getWalkHints()` (capped at 64). A new filter per project open means fresh hints and a fresh tripwire per project.

**FileService.** `setPathFilter(filter)`; `performRead` snapshots it with the hidden patterns and computes the walk's base as the project-relative path of `dirPath` (`''` for the root; no exclusion when there is no project or `dirPath` is outside it). `_readDirectoryInternal` carries the parent's relative path and skips an excluded entry – file or folder – before building a node (`isEntryExcluded`), so an excluded folder is never read. A walk whose base is the project root collects every folder at two or more segments that it skips or that `shouldDrop` marks, and on completion calls `replaceWalkHints`. The `completed` line gains `excludePatternCount`, `excludedEntryCount`, `walkHintCount`, `matcherBudgetExceeded`. `IFileService` gains the setter.

**Settings and project open.** `ProjectSettingsService` gains `setGlobalExcludeProvider(fn)` (wired in `file-handlers.ts` to `globalSettingsService.getSetting('files').exclude`) and resolves the merged list and rejections per D7 (defaults: `[]`). In step 8 of `switchProject`, `ProjectService` logs one `warn` per source with rejections (`{ source, rejected: [{ index, reason }] }`, no values), builds one `ProjectPathFilter` and hands the same instance to `fileService.setPathFilter` and `directoryWatcherService.setPathFilter` (which replaces `setIgnorePatterns`). `Project switch: settings loaded` gains `excludePatternCount`.

**DirectoryWatcherService.** New private state: `watchBackend` (constructor option, D6) and `pathFilter` (default: the default ignore and hidden lists, no exclude). `shouldIgnorePath` is replaced by `shouldDropAbs(abs)` / `shouldDropRel(rel, depth?)` against the project root (D4). `watchDirectory` builds the backend per D1/D6, passes `splitPaths()` + `getWalkHints()` to the native watcher and registers `resync` next to the existing listeners (chokidar never emits it); the chokidar options object is unchanged except `ignored`. `queueEvent` runs the drop backstop right after the session guard and skips `AtomicSaveDetector` for native events (D2). New `handleResync(dirPath, reason)`: guards, `recordNativeResync`, then `pauseEpisode.recordUnknownDrop()` when paused or `sendCompensatingRefresh` otherwise; a rate-limited `info` line with the reason. `ready` on the native backend logs `{ recursiveWatches, splitFolders, walkHints, planCapped, elapsedMs }`. `restartWatcher` per D15/D16. Private names the suites reach into – `watchedDirectories`, `switchVersion`, `processEvents`, `queueEvent`, `pendingRestarts`, `restartAttempts` and the `WatchedDirectory` fields – keep their names; `WatchedDirectory.watcher` is typed as the new `DirectoryWatchHandle` (`on(…)`, `close(): Promise<void>`), which chokidar's `FSWatcher` satisfies.

**Native backend – `watcher/NativeEventClassifier.ts` and `watcher/NativeRecursiveWatcher.ts` (new).**
- `NativeEventClassifier(options: { lstat, isKnownFolder, maxInFlight = 2, maxPending = 10_000, caseSensitive, onEvent, onBacklogOverflow })` – the D2 queue: `enqueue(abs, 'rename' | 'change')`, de-duplication, removal collapse and queue jump, re-queue of a path that changes while in flight, `clear()` (on resync), `dispose()`.
- `NativeRecursiveWatcher extends EventEmitter implements DirectoryWatchHandle` – `constructor(root, { shouldDrop(rel), splitPaths, caseSensitive, caps?, fsWatch?, lstat?, readdir?, realpathNative?, now?, resyncQuietMs = 1000, resyncMaxWaitMs = 5000, reopenLimit = 3, reopenWindowMs = 60_000 })`. It resolves and watches the root synchronously (throws on failure), plans asynchronously (D1), keeps a listing for each split folder (D3), maps events per D2, handles lost events per D3. Each handle record carries a `retired` flag that its callback checks first (D4); self-events (D15), renamed watched folders (D2) and watch errors retire and close the handle synchronously, then run the one D15 re-check, which opens a fresh watch only for a readable directory within the re-open cap. It emits `add`, `addDir`, `unlink`, `unlinkDir`, `change` with absolute paths under the caller's root, plus `error`, `ready`, `resync(reason)`; `getPlanStats()` feeds the ready log line. `close()` closes every handle, disposes the queue and clears timers; nothing is emitted after it.

**Backend seam – `watcher/directoryWatchBackend.ts` (new).** Exports only `selectDirectoryWatchBackend` and the types `DirectoryWatchBackend` and `DirectoryWatchHandle`, so the global mock stays trivial. The watcher barrel `watcher/index.ts` re-exports the new modules.

**PauseEpisode** gains `recordUnknownDrop()`. **WatcherMetrics** gains `recordEventFiltered`, `recordNativeOverflow`, `recordNativeResync`, `recordMatcherBudgetExceeded` and snapshot fields `eventsFiltered`, `nativeOverflows`, `nativeResyncs`, `matcherBudgetExceeded`; the health line logs them and counts `nativeResyncs > 0` as stress (`warn`).

**Renderer.** `useProjectManagement.ts`, `useProjectManagement.logic.ts` and `IProjectManagement.ts` implement D12. `useDirectoryWatcher`, `useGitStatus` and the preload bridge are unchanged.

**Proof lines for AC8** (all counts and durations, never paths): `Project switch: settings loaded` (`excludePatternCount`), `FileService: readDirectory completed` (`durationMs`, `excludedEntryCount`, `walkHintCount`), renderer `File tree loaded` / `File tree refreshed`, `Directory watcher backend selected`, native `ready` (plan size, `planCapped`, `elapsedMs`), `DirectoryWatcher health` (`eventsFiltered`, `nativeOverflows`, `nativeResyncs`), and the absence of `Directory changed` and `readDirectory started` lines during excluded churn.

## 6. Work items (ordered; each lands with its tests)

| # | Work item | Files | Tests |
|---|---|---|---|
| W0 | Spike on this host (D0) – **done** | `docs/spikes/211-windows-fs-watch.md` | – (measurements recorded; verdict: proceed with `fs.watch`) |
| W1 | Exclude matcher (D8, D9) | `excludeMatcher.ts` | `excludeMatcher.test.ts`: normalisation incl. one leading `/`, every rejection reason (control characters, `<>:"\|`, wildcard and `**` caps, 256/4,096 caps), path vs pattern, `**` at start/middle, ancestor rule in one pass, `.erfana` never excluded, case modes, compile validates; **budget:** 256 hostile entries × 10,000 hostile 255-character names finish in under 2 s on the Linux CI runner, and a pathological pair stops at the budget and counts it; **tripwire:** after 100 overruns pattern entries stop matching (and stop costing), path entries still match, the callback fires once |
| W2 | `files.exclude` schema + settings merge (D7) | `files-exclude-schema.ts`, `project-settings-schema.ts`, `global-settings-schema.ts`, `ProjectSettingsService.ts`, `file-handlers.ts` | new schema test; global schema test (defaults, typed literals gain `files`); `GlobalSettingsService.test.ts` – a file with `"files": 42` keeps its other values and makes no backup; `ProjectSettingsService.test.ts` – global-then-project merge with de-dupe, rejections by source and index, default provider, a malformed `files` does not throw |
| W3 | Tree walk skips excluded entries, records hints (AC1, D1) | `FileService.ts`, `IFileService.ts` | `FileService.readDirectory.exclude.test.ts` (real temp folder; `fs/promises.readdir` spied): excluded folder never read, pattern and file entries, outside-project read unaffected, snapshot per walk, hints recorded for nested hidden/ignored/excluded folders only on root walks and capped, new log fields |
| W4 | Path filter (D4, D14) | `projectPathFilter.ts` | `projectPathFilter.test.ts`: relative path on POSIX and Windows-style input, `C:\proj-x` is not inside `C:\proj`, outside → dropped, hidden segment rule, ignore rule root-relative (`/x/build/proj` still watched), a subfolder watch uses project-relative paths, exclude delegation, root never dropped, hint cap |
| W5 | Watcher filtering on the current backend (D4, D13, AC4) | `DirectoryWatcherService.ts`, `IDirectoryWatcherService.ts`, `WatcherMetrics.ts` | `DirectoryWatcherService.filter.test.ts`: `ignored` covers exclude/hidden/ignore; dropped events never reach `recordDrop` (no catch-up) nor `eventsReceived`; an all-dropped burst sends nothing; `setPathFilter` replaces the filter. `WatcherMetrics.test.ts`, `DirectoryWatcherService.health.test.ts` for the new fields |
| W6 | Apply on project open (D7, D11) | `ProjectService.ts` | `ProjectService.switching.test.ts`: one `warn` per source by index and reason with no value, the same filter instance reaches both services, hidden patterns still set; `ProjectService.test.ts` mocks move to `setPathFilter` |
| W7 | *Deferred (review A9)* – content-only batches skipping the tree re-read | – | – (section 10) |
| W8 | Watcher starts after the first read (D12, AC5) | `useProjectManagement.ts`, `useProjectManagement.logic.ts`, `IProjectManagement.ts` | new `useProjectManagement.watcherGate.test.ts`: false while the first read is pending, true after success and after failure, stays false for a superseded load, stays false when the IPC reply lands while the listener read is pending, true after the no-op re-open, false after close; update `noAutoLoad`, `logic` (drop `shouldMarkInitialLoadComplete`), `ProjectTree.timing` (read deferred → `start` only after it resolves) and `ProjectTree.switching` (wait for `start`) |
| W9 | Backend seam + test default (D6) | `directoryWatchBackend.ts`, `watcher/index.ts`, `tests/setup/setupTests.main.ts` | `directoryWatchBackend.test.ts` (`vi.unmock`): win32 → native, darwin/linux → chokidar, env override, unknown env value ignored |
| W10 | Unknown drop in a pause (D13) | `PauseEpisode.ts` | `PauseEpisode.test.ts`: counts once, covered by a later completed owner read, ignored after the cap forced catch-up |
| W11 | Classification queue (D2) | `NativeEventClassifier.ts` | `NativeEventClassifier.test.ts`: table of D2 incl. the defensive `EPERM` row, never more than 2 `lstat` in flight, de-dupe, in-flight re-queue, backlog callback, `clear()`; **deleting a 1,000-file folder** (a partial set of child renames, then the folder's, slow `lstat`) → at most a handful of stats and one `unlinkDir`; case-folded keys; nothing after `dispose` |
| W12 | Native watcher (D1, D2, D3, D15) | `NativeRecursiveWatcher.ts` | `NativeRecursiveWatcher.test.ts` with injected `fsWatch`/`lstat`/`readdir`/`realpathNative`/`now` and fake timers: plan shape (no handle for `.git`, `node_modules`, an excluded chain, a hinted nested `node_modules`, a junction, directory or file symlink child), caps → `planCapped`, handles opened on the realpath while events carry the caller's root, dropped paths never `lstat`ed, backslash names → POSIX relative paths, new top-level folder: `addDir` only after its watch opens, case-only rename re-lists without a second watch, split listing follows renames; **overflow:** split-folder `null` re-lists without resync; many recursive `null`s within the debounce → exactly one resync; the watch stays open after an overflow; backlog → one resync; **self-event:** `\\?\`-prefixed and `\\?\UNC\`-prefixed absolute paths match (child and root); on the first one the handle is closed inside the same callback before any `lstat`; **10,000 further self-events delivered before the close takes effect → no `lstat`, no timer, no queue entry, no log**; one re-check: `ENOENT` → `unlinkDir` (root: `ENOENT` error), readable new folder → fresh watch + resync; a relative filename equal to the basename is an ordinary child event; **renamed watched child:** the parent's `rename old` retires the old handle at once (its later events, reported under the old name, are dropped), `unlinkDir old`, `addDir new` after the new watch opens, a rename to a dropped name gets no watch, a rename to a split-folder name is planned as one; **defensive:** `EPERM` persisting after a close → no re-open; a watch that keeps erroring on a readable folder → at most 3 re-opens in 60 s, then no further `fsWatch` call and one resync; `ready` after the plan, silent after `close` |
| W13 | Wire the native backend (AC1, AC3, AC6) | `DirectoryWatcherService.ts` | `DirectoryWatcherService.native.test.ts` (`NativeRecursiveWatcher` mocked, service built with `{ backend: 'native-recursive' }`): constructed with the root, split paths, hints and the depth-aware predicate, chokidar untouched; listeners route to `queueEvent`; native `unlink` bypasses `AtomicSaveDetector`; resync unpaused → one `catchUp` send, paused → catch-up at resume unless a later read covers it; `watchDirectory` resolves without waiting for `ready`; `ENOENT` restarts exhaust → `project-deleted` is sent after the map entry is gone (D16), other errors → `restart-failed` |
| W14 | Real-filesystem check on Windows | – | `NativeRecursiveWatcher.win32.test.ts` (`describe.runIf(process.platform === 'win32')`, temp folder resolved with `realpath.native`, `vi.waitFor` only), expectations from W0: add/remove/rename of a file and a folder reported; 200 files churned in an excluded path produce no event and no `lstat`; a new top-level folder is watched; **deleting a watched top-level folder** → one `unlinkDir`, its handle closed after at most a few self-events (a raw-event counter stays below 100 across 500 ms), `lstat` `ENOENT`, and a folder re-created under the same name is watched afresh (a file written there is reported); **renaming a watched top-level folder** → a file written in the renamed folder is reported under the **new** path, none under the old; a 1,000-file burst from a child process yields at most two resyncs and the watch still reports a later file; deleting the watched root yields an `ENOENT` error; a junction child gets no handle; close before cleanup |
| W15 | End-to-end (local) | `e2e/directory-watcher.e2e.ts` | new test: project with `.erfana/settings.json` excluding `scratch`; `scratch` absent from the tree; files churned into `scratch` from the terminal; a file created in `visible/` appears within the existing budget; `scratch` still absent |
| W16 | Documentation | see section 11 | `npm run check:links` |
| W17 | Manual Windows run (AC8) | `docs/performance/211-large-project-windows-run.md` | the 222k project with and without the exclusion: first-tree time, file open and git status during the first read (and whether the excluded folder is gitignored), visible file under excluded churn, re-read count during churn, `nativeOverflows` during ordinary work (`git checkout`, a build), CPU after deleting a watched top-level folder, with the log excerpts listed in section 5 – user names and absolute paths scrubbed |

## 7. Test strategy

| Category | Harness | Where it runs |
|---|---|---|
| Unit – main and shared | Vitest (`main` project, node); pure modules tested directly; the native watcher and the classifier via injected `fs` functions and fake timers; service tests seed `watchedDirectories` as today | Linux CI (`Unit tests`, `Coverage`), Windows host and the advisory `Windows checks` job |
| Unit – renderer | Vitest + Testing Library (`renderer` project), `window.api` mocks | same |
| Integration – real filesystem | `NativeRecursiveWatcher.win32.test.ts`, gated to win32, condition-based waits | this Windows host and `Windows checks` only |
| End-to-end | Playwright + Electron, `e2e/directory-watcher.e2e.ts` (existing test plus W15) | locally, `npm run test:e2e`, on Windows (native backend) and, where available, macOS (chokidar) – e2e stays out of CI |
| Manual | W17 procedure on the 222k-entry project | Windows, recorded in `docs/performance/` |

- Coverage: ≥ 90 % lines for `excludeMatcher`, `projectPathFilter`, `NativeEventClassifier`, `files-exclude-schema`; ≥ 85 % for `NativeRecursiveWatcher`. No new per-file floor in `vitest.main.ts`.
- Must stay green unchanged (AC6): the #70 single-file watcher suites, `DirectoryWatcherService.pipeline` (#210, NFR latency), `.listeners`, `.depth`, `.concurrency`, `WatcherResilience`, `FileService.readDirectory.singleFlight` (#208), `useProjectManagement.refreshSingleFlight`, `withWatcherPause`, `useFileWatcher` (autosave), `useDirectoryWatcher`.
- Local gate before push: `npm run lint && npm run lint:css && npm run design -- --check && npm run typecheck && npm run test:ci` on this Windows host (`test:cov` cannot pass on Windows), `npx electron-vite build`; CI runs `test:cov` on Linux.

## 8. Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| R1 Overflow in a recursive watch under churn *inside a visible folder, or in a dropped folder the plan does not know* (created after open, or past a cap) still costs a full re-read | medium / medium | split plan with path entries and walk hints keeps known dropped churn out of every buffer; split-folder overflow is a cheap re-list; resync is debounced and #208 caps reads at one plus one; `nativeOverflows` / `nativeResyncs` in the health line; residual stated in section 9 |
| R2 A deleted watched folder floods its handle with self-events (W0: about 70,000 a second, one core) until the handle closes | certain if unhandled / high | D15 retires and closes the handle synchronously on the first self-event, and the retired check drops the rest in O(1); W12 floods 10,000 events before the close; W14 counts raw events on a real delete; W17 checks CPU after a delete |
| R3 Ordinary bursts (`git checkout`, a build) overflow the 4 KB buffer of a recursive watch on a visible folder | high (W0: 20 files with a busy main thread) / low | such a burst re-reads the tree anyway; the debounce turns its `null`s into one resync; the watch keeps working after an overflow (W0); W17 records `nativeOverflows` |
| R4 Changes made during the first read in folders already read, or before the plan opened their watch, show only on the next change or a manual refresh (pre-existing; chokidar's scan had the same gap) | medium / low | accepted and documented; any later event re-reads the whole tree |
| R5 The global mock hides the platform choice from unit tests | low / medium | selection test with `vi.unmock`, native wiring test, win32 real-filesystem suite, e2e on Windows |
| R6 macOS behaviour change: hidden folders (`.git`) are no longer watched | low / low | `GitWatcherService` already owns `.git` state (existing suites) |
| R7 AC1's 30 s depends on the rest of the tree and a cold cache | medium / medium | measured in W17; if missed, a 2-way parallel walk is the contained lever, weighed against AC2, otherwise #150 |
| R8 A cloned repo's settings hide files or ship a hostile pattern | low / medium | parity with the existing `tree.hiddenPatterns`, which can already hide any name; `.erfana` never excluded; no regex; entry, character and wildcard caps; per-call match budget plus a per-session tripwire; lenient parse never blocks opening; rejected entries logged without values |
| R9 `ReadDirectoryChangesW` may report 8.3 short names, which a pattern entry does not match | low / low | W0 saw long relative names even on a short-name watch; at worst one extra refresh; path entries are not watched at all |
| R10 The watcher gate never opens on some open path | low / high | every path that sets `projectPath` clears `firstReadPending` (D12); W8 tests open, switch, close, superseded, reply-during-read and no-op re-open |
| R11 A later Electron changes the self-event shape or the deleted-folder behaviour | low / high | the shape is measured on libuv 1.51.0 (D15); the defensive `EPERM` paths stay; W14 fails on an upgrade that changes it |
| R12 A renamed watched folder keeps reporting under its old name (W0) | certain if unhandled / medium | D2 retires the old handle on the parent's `rename` and re-plans the new name; W12 unit case; W14 writes into a renamed folder |
| R13 A watch on an 8.3 short-name path aborts the process on libuv 1.52.x | low now (not on 1.51.0) / high at the next Electron upgrade | every handle opens under `realpathSync.native(root)` |

## 9. Acceptance-criteria traceability

| AC | Delivered by | Verified by |
|---|---|---|
| AC1 first tree ≤ ~30 s with exclusion; faster without it | W3 (excluded folder never read), W12/W13 (no chokidar scan on Windows), W8 (no concurrent watcher start) | W17 timings; W3 tests |
| AC2 file open ≤ ~2 s, git status ≤ ~3 s during the first read | W8, W12 (no scan, 2-stat cap, no self-event flood), W13 (no unthrottled removal stats) | W17 |
| AC3 visible new file ≤ ~5 s under excluded churn; tree never regresses | W12 (excluded and hinted paths unwatched), W5/W13 (filter, resync), #208 unchanged | W14, W15, W17; singleFlight suites |
| AC4 excluded/ignored/hidden-only churn never starts a full re-read | W5 (drop before accounting and broadcast; `ignored`), W3 + W12 (hints, drop before `lstat`, no handle) | W5, W12, W14 tests; W17 logs (no `readDirectory started`) |
| AC5 tree reads and git status do not wait for the watcher | W8; no code awaits `ready` (W13 test) | W8, W13 tests; W17 log order |
| AC6 no regression (macOS chokidar 3.6.0, #70/#208/#210, autosave) | W9 (suites keep chokidar), chokidar options unchanged but `ignored` | full suites; e2e on macOS where available |
| AC7 exclude list: path + pattern, global + project, schema-validated, unit-tested | W1, W2, W6 | W1, W2, W6 tests |
| AC8 documented manual Windows run + unit tests | W0, W16, W17 | `docs/spikes/211-windows-fs-watch.md`, `docs/performance/211-large-project-windows-run.md` |

**Remaining deviations – to show the owner at UAT.**
1. **AC3/AC4, partly.** A folder that becomes excluded, hidden or ignored *after* the project opened – typically a new nested `node_modules` from `npm install`, or a new folder matching a pattern such as `**/tmp` – and dropped folders beyond the caps (64 hints, 512 handles) still sit inside a Windows watch until the next project open. Their changes are still ignored one by one, but a heavy burst there can overflow Windows' change buffer; Erfana then cannot tell where the lost changes were and re-reads the whole tree, about once per burst (one second after it ends, or every 5 s while it lasts). Everything excluded by path, and every dropped folder present when the project opened, is unaffected. Reopening the project clears it.
2. **AC2 assumes the excluded folder is also gitignored.** The exclude list hides folders from the tree and the watcher, not from git status; an excluded folder that git still tracks or sees as untracked keeps costing git time.
3. **"One Windows watcher for the whole project"** is delivered as one watcher per project that uses a small, bounded set of Windows handles (tens, at most 512) rather than a single handle, so excluded folders can be left out entirely.
4. **`.erfana` cannot be excluded.** A small exception to "excluded folders become invisible", so the settings that hide things stay findable.
5. **Hostile patterns fail open.** A pattern so costly that it exceeds the per-path match budget does not hide that path, and after 100 such overruns in one project session all pattern entries are switched off until the project is reopened (path entries keep working; one warning in the log). Real-world lists never reach it.
6. **A folder that keeps failing to be watched is left unwatched** until the next restart or project open (after 3 re-opens in 60 s, or when Windows reports it as gone while it is in fact still there). The tree still shows it correctly after the next re-read; only live updates from inside it pause.

## 10. Out of scope

- Lazy or incremental tree loading, virtualization, cancelable or parallel reads – [#150](https://github.com/qodeca/erfana/issues/150) (a parallel walk only as the R7 lever).
- An `@parcel/watcher` backend – W0 found it unnecessary; contingency under D1 only if W17 shows AC3 broken by overflow.
- Re-planning the Windows watch at runtime when a dropped folder appears after open (deviation 1).
- Content-only batches skipping the tree re-read (a `structural` flag on `directory-watch:changed`) – beyond the requirements; follow-up issue (review A9).
- A tree indicator that the project's exclude list hid something – new UI with a design-system card; `tree.hiddenPatterns` has the same gap today (review S4).
- A size cap on `.erfana/settings.json` before parsing, and a payload schema for `directory-watch:start` limited to the project root – pre-existing (reviews S5, S8); `watchDirectory` already refuses paths outside the project (`DirectoryWatcherService.ts:179`).
- A Settings overlay control for the exclude list, and live reload of hand edits to `~/.erfana/settings.json`.
- Git status honouring the exclude list (D10).
- Word-boundary matching for `watcher.ignoreList` (`out` still matches `outline`) – follow-up issue.
- Any macOS or Linux backend change; chokidar stays pinned at 3.6.0.
- `file:getLastProjectPath` setting a project without loading its settings (no renderer caller), and pattern rollback after a failed switch – pre-existing.
- Adding an exclude entry to this repository's own `.erfana/settings.json` – the owner's choice.

## 11. Planned files

Create: `src/main/utils/excludeMatcher.ts`, `src/main/utils/excludeMatcher.test.ts`, `src/main/utils/projectPathFilter.ts`, `src/main/utils/projectPathFilter.test.ts`, `src/shared/ipc/files-exclude-schema.ts`, `src/shared/ipc/files-exclude-schema.test.ts`, `src/main/services/FileService.readDirectory.exclude.test.ts`, `src/main/services/DirectoryWatcherService.filter.test.ts`, `src/main/services/watcher/directoryWatchBackend.ts`, `src/main/services/watcher/directoryWatchBackend.test.ts`, `src/main/services/watcher/NativeEventClassifier.ts`, `src/main/services/watcher/NativeEventClassifier.test.ts`, `src/main/services/watcher/NativeRecursiveWatcher.ts`, `src/main/services/watcher/NativeRecursiveWatcher.test.ts`, `src/main/services/watcher/NativeRecursiveWatcher.win32.test.ts`, `src/main/services/DirectoryWatcherService.native.test.ts`, `src/renderer/src/hooks/useProjectManagement.watcherGate.test.ts`, `docs/spikes/211-windows-fs-watch.md` (done), `docs/performance/211-large-project-windows-run.md`, `docs/designs/211-large-project-windows-watcher.md` (this file).

Modify – source: `src/shared/ipc/project-settings-schema.ts`, `src/shared/ipc/global-settings-schema.ts`, `src/main/services/ProjectSettingsService.ts`, `src/main/interfaces/IProjectSettingsService.ts`, `src/main/services/FileService.ts`, `src/main/interfaces/IFileService.ts`, `src/main/interfaces/IDirectoryWatcherService.ts`, `src/main/services/DirectoryWatcherService.ts`, `src/main/services/watcher/WatcherMetrics.ts`, `src/main/services/watcher/PauseEpisode.ts`, `src/main/services/watcher/index.ts`, `src/main/services/ProjectService.ts`, `src/main/ipc/file-handlers.ts`, `src/renderer/src/interfaces/IProjectManagement.ts`, `src/renderer/src/hooks/useProjectManagement.ts`, `src/renderer/src/hooks/useProjectManagement.logic.ts`.

Modify – tests and setup: `tests/setup/setupTests.main.ts`, `src/shared/ipc/global-settings-schema.test.ts`, `src/main/services/GlobalSettingsService.test.ts`, `src/main/services/ProjectSettingsService.test.ts`, `src/main/services/ProjectService.test.ts`, `src/main/services/ProjectService.switching.test.ts`, `src/main/services/watcher/WatcherMetrics.test.ts`, `src/main/services/watcher/PauseEpisode.test.ts`, `src/main/services/DirectoryWatcherService.health.test.ts`, `src/renderer/src/hooks/useProjectManagement.logic.test.ts`, `src/renderer/src/hooks/useProjectManagement.noAutoLoad.test.ts`, `src/renderer/src/components/ProjectTree/ProjectTree.timing.test.tsx`, `src/renderer/src/components/ProjectTree/ProjectTree.switching.test.tsx`, `e2e/directory-watcher.e2e.ts`.

Modify – docs: `docs/file-watching/README.md` (backends, split plan and walk hints, filter order, exclude list, resync, watcher after first read, depth on Windows, env override), `docs/file-watching/technical-details.md` (limits and caps, lost events with the W0 numbers, deleted- and renamed-folder handling and the re-open cap, classification queue), `docs/file-watching/patterns-and-testing.md` (new suites), `docs/logging.md` (new health fields and lines, the tripwire warning), `docs/user-guide/reference/settings.md` (`files.exclude`, project and global, `.erfana` rule, entry limits), `docs/user-guide/feature-inventory.md` (TREE-15, SET-11), `docs/settings.md` (storage, lenient parse), `docs/known-issues.md` (Windows latency entry, large-repository workaround → `files.exclude`, the section 9 deviations), `docs/large-project-performance-plan.md` (#211 section), `docs/CHANGELOG.md` (Unreleased: Fixed + Added + Internal), `docs/api-services.md` (`setPathFilter` replaces `setIgnorePatterns`, backends), `docs/troubleshooting.md` (the path-filter drop test replaces `shouldIgnorePath`), `docs/technical-debt.md` (the accepted QG-6, QG-7 and QG-8 items), `docs/README.md` (index entries for this note and the spike).

## 12. Review rounds (QG-4a) and spike amendments

### Round 1

Solution (H, M, L), security (S) and architecture (A) reviews. "Fixed" = HIGH, required; the rest were judged on cost against benefit.

| Id | Disposition | Where |
|---|---|---|
| H1, A2 | fixed – self-event handling, close before re-check, `EPERM` fallback (shape settled by W0, see amendments) | D15, D2 table, W12, W14, R11 |
| H2, A6 | fixed – walk hints split around nested dropped folders, with caps; residual stated | D1, W3, W12, section 9 (1) |
| S1 | fixed – entry, character, wildcard caps; set lookup for path entries; one-pass ancestors; per-call budget | D8, D9, W1 |
| A1 | fixed – removal collapse, queue jump, resync clears the queue, native `unlink` skips `AtomicSaveDetector` | D2, W11, W13 |
| A3 | fixed – every handle under `realpathSync.native(root)` | D1, R13, W12, W14 |
| M1 | fix | D12, W8 |
| M2 | fix – `addDir` only after the watch opens | D2 table, W12 |
| M3 | fix – folded keys | D1, W11, W12 |
| M4 | fix – stated as an AC2 assumption | D10, W17, section 9 (2) |
| L1 | fix – R3 raised; debounce confirmed by W0 | R3, D3 |
| L2 | fix | D3, W12 |
| L3, A11 | fix – links are leaves; `null` path dropped | D1, D4, W12, W14 |
| L4 | fix – one leading `/` is root-anchored | D8, W1 |
| S2 | fix – links are leaves via `Dirent` + `lstat`; a per-handle `realpath` check is not added (no handle is ever opened through a link) | D1, W12, W14 |
| S3 | fix | D1 caps |
| S4 | fix for `.erfana`; tree indicator accepted as tech debt (new UI, same gap as `tree.hiddenPatterns`) | D8, section 10 |
| S5 | fix for compile-validates; size cap accepted as tech debt (pre-existing) | section 5, section 10 |
| S6 | fix | D8, D4, W4 |
| S7 | fix | D3, W17 |
| S8 | accept as tech debt – pre-existing; paths outside the project are already refused | section 10 |
| A4 | fix – `notifyIds` | D16, W13 |
| A5 | fix – W0 spike (done) | D0, W0 |
| A7 | fix – merge in `ProjectSettingsService`, one `setPathFilter` | D7, section 5, W2, W6 |
| A8 | fix – constructor option; a separate factory module not worth it | D6, W13 |
| A9 | accept as tech debt – W7 deferred, beyond the requirements | section 10 |
| A10 | fix – project-relative paths | D4, W4 |

### Round 2

Re-verification confirmed H2, S1, A1 and A3 resolved, and H1/A2 resolved except N1.

| Id | Disposition | Where |
|---|---|---|
| N1 (HIGH) | fixed – one re-check after every close: only a readable directory re-opens; anything else counts as gone (`unlinkDir`, root → `ENOENT`), never re-opened; re-opens capped at 3 per path per 60 s, then one resync | D15, D2 table, section 5, W12, section 9 (6) |
| N2 | fix – per-session tripwire: after 100 budget overruns the matcher switches pattern entries off and logs once; a counter and a flag, closes the untrusted-input cost path | D9, section 5, W1, R8, section 9 (5) |

### Spike amendments (W0, libuv 1.51.0)

| # | Measured | Design change |
|---|---|---|
| 1 | A deleted watched folder: `rename` with a `\\?\`-prefixed absolute path, never basename or `EPERM`, about 70,000 a second until closed; `lstat` `ENOENT` at once | D15 rewritten: strip the prefix; retire and close synchronously on the first self-event, before any `lstat`; later ones return in O(1); then one re-check. The "AV lock, watch stays" branch and basename handling are removed; `EPERM` kept only as a defensive path. R2 rewritten (flood), R11 narrowed; W12 flood case; W14 expects `ENOENT` and a bounded raw-event count |
| 2 | A renamed watched folder's handle follows it and reports under the old name | D2 "Renamed watched folder": the parent's `rename` retires the old handle at once, the new name is planned like a folder at start; R12 added; W12 and W14 cases |
| 3 | Busy main thread: a 20+ burst arrives as exactly one `null`; idle: 63–123 `null`s per 5,000 files; the watch keeps working | D1 and D3 carry the numbers; 1 s / 5 s debounce confirmed (one resync per burst); no re-open after an overflow; W12 "many `null`s → one resync"; W14 burst case |
| 4 | No 8.3 abort on libuv 1.51.0 (a 1.52.x regression) | `realpathSync.native` kept as a free guard for the next Electron upgrade; R13 lowered |
| 5 | Junctions and both symlink kinds are link-typed; a recursive watch does not report inside them | D1's link rule confirmed; W12 covers all three link kinds |

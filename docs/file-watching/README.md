# File Watching & Auto-Refresh

Erfana automatically detects and responds to external file system changes using two complementary watching systems.

## Overview

**FileWatcherService**: Watches individual open files for content changes, surfaces editor reload/conflict UI
**DirectoryWatcherService**: Watches entire project directory for both structural changes (create/delete/rename) **and** in-place content changes (`fs.writeFile` in place), broadcasts `directory-watch:changed` for both

FileWatcherService uses [Chokidar](https://github.com/paulmillr/chokidar) on every platform. DirectoryWatcherService uses chokidar on macOS and Linux, and on Windows a native recursive watcher built on Node's own `fs.watch` ([#211](https://github.com/qodeca/erfana/issues/211)) – see [Watch backends](#watch-backends-211). Both share the debouncing and race-condition guards described below.

> **Chokidar is pinned to exact `3.6.0` (v3 line; do not upgrade to v4).** v3 uses a single macOS FSEvents stream (~0 file descriptors per watched file); v4 dropped FSEvents and watches each file via kqueue (one FD per file), which exhausts the process FD table on large projects and breaks spawning child processes – PDF export's hidden render window crashed with `Failed to initialize sandbox` on a 20k-file folder (commit `68cfab8` – pre-migration; no longer resolvable, that history was rewritten at the 2026-06 migration – shipped in v0.12.0). The rationale is also in the comment above `disableGlobbing` in the `chokidar.watch(...)` options of `DirectoryWatcherService.watchDirectory`.

---

## FileWatcherService (File Content Watching)

Monitors open files for external content modifications.

### Architecture

- **Library**: Chokidar (native fs events, not polling)
- **Debouncing**: 300ms (optimized for single file saves)
- **Events**: `change`, `unlink`, `error`
- **Scope**: Per-file watching (on-demand when file is opened)
- **Limit**: 100 files maximum, app-wide (security). The cap governs **new** map entries only — joining a path that is already watched can never fail on it (#70)
- **Symlinks**: `followSymlinks: false` — the watch is on the path itself, never on what a link at that path points at (#70)
- **Consumers**: two renderer hooks – `useFileWatcher` (Markdown editor, read/write) and `useFileChangeSubscription` (read-only surfaces, #70). Both hold a `fileWatchSlot`. Separately, the HTML preview keeps its own main-process pool, `src/main/services/preview/PreviewWatchPool.ts`, built on the same `createSingleFileWatcher` factory with a shorter write-finish wait and capped at 16 files per preview on top of the app-wide cap – see [HTML preview § Auto-refresh](../html-preview/README.md#auto-refresh)

### Use Cases

| Scenario | Behavior |
|----------|----------|
| File modified externally, no local changes | Auto-reload silently, show "Reloaded from disk" in toolbar (1s) |
| File modified externally, has unsaved changes | Show orange conflict bar with options |
| File replaced atomically (write temp + rename) | Surfaces as `file-watch:changed`, not a delete — see [Single-file watch internals](#single-file-watch-internals-70) |
| File deleted externally | Show red warning banner, keep editor state |
| Watch dies for any other reason | `file-watch:error` — the consumer shows a degraded state instead of silently going stale (#70) |
| Rapid changes (git operations) | Debounced to single reload |

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `file-watch:start` | Renderer → Main | Start watching specific file |
| `file-watch:stop` | Renderer → Main | Stop watching specific file |
| `file-watch:stopAll` | Renderer → Main | Drop every watch held by this window |
| `file-watch:pause` | Renderer → Main | Pause watching during save operation |
| `file-watch:resume` | Renderer → Main | Resume watching after save completes |
| `file-watch:stats` | Renderer → Main | Watcher diagnostics |
| `file-watch:changed` | Main → Renderer | Event: File content changed externally (**including** an atomic replace, #70) |
| `file-watch:deleted` | Main → Renderer | Event: File genuinely deleted externally |
| `file-watch:error` | Main → Renderer | Event: chokidar error, **or** the watch died and cannot be re-armed (#70) |

### Implementation Location

- **Service**: `src/main/services/FileWatcherService.ts`
- **Watch factory**: `src/main/services/watcher/singleFileWatch.ts` (`SINGLE_FILE_WATCH_OPTIONS` + `createSingleFileWatcher`, #70)
- **Unlink branch**: `src/main/services/watcher/atomicRearm.ts` (atomic save vs genuine delete, #70)
- **Subscription counting**: `src/main/services/watcher/SubscriberCounter.ts` (#70)
- **Send loop**: `src/main/services/watcher/watchNotifier.ts` (#70)
- **IPC Handlers**: `src/main/ipc/file-watcher-handlers.ts`
- **Renderer Hooks**:
  - `src/renderer/src/hooks/useFileWatcher.ts` (editor: echo detection, external change handling, `notifySaveComplete` action)
  - `src/renderer/src/hooks/useFileChangeSubscription.ts` (read-only surfaces, #70)
  - `src/renderer/src/hooks/fileWatchSlot.ts` (shared acquire/release slot, #70)
- **Integration**: `src/renderer/src/components/Panels/MarkdownEditorPanel.tsx`, `src/renderer/src/components/Panels/ImageViewerPanel/`
- **UI Component**: `src/renderer/src/components/FileConflictNotification/`

### Self-Save Echo Detection (v0.9.1)

The `useFileWatcher` hook prevents autosave-triggered file change events from being treated as external modifications. Three-layer defense:

1. **`isSavingRef` guard** – Set during save operations, suppresses all change events while a save is in-flight
2. **Content comparison (`isEchoEvent`)** – Compares incoming file content against `pendingSavedContentsRef`, a `Set` of recently saved content strings (a set, not a single ref, because rapid successive saves can leave several echoes in flight). Both sides are CRLF-normalized before comparison, so a self-save echo that arrives after the saving flag clears is still recognised. The set is cleared on reload, keep-local, file switch, and after a match
3. **`hasLocalChangesRef`** – Ref mirror of `hasLocalChanges` state (avoids stale closures); if the user has local changes, external reload is suppressed

The `MarkdownEditorPanel` coordinates via:
- Reading content from Monaco editor model (not React state) to avoid stale closure overwrites
- Calling `notifySaveComplete(savedContent)` after a successful write, which adds the content to `pendingSavedContentsRef`
- Post-save dirty re-detection: checks if Monaco buffer diverged from saved content during the save, re-marks as modified if so
- Save by panel id (#124): the panel registers its save, its conflict flag and an autosave hold in `services/editorSaveRegistry.ts` through `useEditorSaveRegistration`, so the HTML preview's tab move can save another tab when the user answers Save in the unsaved-changes prompt. The save is the panel's own `handleSave`, so every guard above still applies. While the prompt is open the move holds the tab's autosave (`cancelAutoSave`, re-armed by `signalChange` on release). It fails safe: a panel id with no entry, or a save that throws, answers `false`, and the move is abandoned with the edits kept in their tab

### Conflict Resolution UI

When a file has both external changes and unsaved local changes, an orange conflict bar appears with three options:

- **Reload from Disk**: Discard local changes, load external version
- **Keep My Version**: Ignore external changes, keep local edits
- **Dismiss**: Acknowledge conflict, decide later

**Wrap `reloadFromDisk`, never pass it as a bare `onClick` reference.** Its
signature is `reloadFromDisk(prefetchedContent?: string)`, so React hands a
click handler its synthetic mouse event as that first argument. Wiring
`onClick={onReload}` therefore adopted the event as the file's new content and
crashed the editor panel on the next render (`content.split is not a
function`). Write `onClick={() => onReload()}`.

TypeScript cannot catch a recurrence: a zero-argument signature is assignable
to a one-argument DOM handler. `reloadFromDisk` now also ignores any argument
that is not a string and re-reads from disk instead, but that guard is the
second line of defence, not a licence to skip the wrapper.

---

## Single-file watch internals (#70)

Issue #70 (a preview tab showing stale content forever) turned out to be three
independent defects. Two of them were in this service and therefore affected the
Markdown editor as well; the third was renderer-side.

### Atomic-save detection and watcher re-arm

A chokidar single-file watch is bound to the **inode** it opened. The dominant
agent / design-tool write pattern is *write a temp file, rename it over the
target*, which destroys that inode. Where the platform reports the rename as an
`unlink`, the old behaviour emitted `file-watch:deleted`, closed the watcher and
dropped the map entry — so every later edit was invisible until the tab was
closed and reopened.

`FileWatcherService` now runs one service-level `AtomicSaveDetector` (it already
keys pending deletes by path, and this service is 1 watcher : 1 path, so a
per-file detector would be a `Map` with one entry × 100 watches). The branch that
follows the detector's verdict lives in `watcher/atomicRearm.ts`:

| Verdict | Behaviour |
|---|---|
| File is back within the 100 ms window | Close the stale watcher, create a replacement through `createSingleFileWatcher`, mutate the existing entry in place, then **re-enter `handleFileChange`** |
| File still gone (one final `stat` confirms) | `file-watch:deleted`, close, drop the entry — today's behaviour |
| Session token bumped inside the window | `file-watch:error` (`WATCH_DEAD_SESSION_ENDED`), then drop — never a silent drop |
| Path no longer resolves inside the project | `file-watch:error` (`WATCH_DEAD_OUTSIDE_PROJECT`), then drop |
| `chokidar.watch()` throws on the replacement | `file-watch:error` (`WATCH_DEAD_REARM_FAILED`), then drop |
| Path vanishes between the existence check and `chokidar.watch()` | `file-watch:deleted` + drop, so no zombie entry holds a `MAX_WATCHED_FILES` slot |

Two design points that are easy to undo by accident:

- The re-arm calls **`handleFileChange`**, never `notifyWebContents` directly. A
  direct notify would skip `awaitWriteFinish.stabilityThreshold` (300 ms), the
  300 ms debounce and the `isPaused` check — so `rm x.md && <slow write> x.md`
  would tell the editor to reload a half-written file.
- The record is updated **in place**, so subscribers, `isPaused` and the map size
  survive. A re-arm can therefore never trip `MAX_WATCHED_FILES`.
- The path is re-checked for project confinement at re-arm time
  (`utils/projectConfinement.ts`). The entry check ran before somebody else
  replaced the file, so an in-project name can be a symlink out of the project by
  the time the replacement lands.

**Platform split — measured, not assumed.** On **macOS** (fsevents,
`usePolling: false`) chokidar v3 reports `mv tmp target` over a watched path as
**`change`**, not `unlink`, and the watch keeps working afterwards. The re-arm
branch is therefore **dormant on macOS**, and the ordinary debounced change path
is what carries the fix there. The branch matters on platforms that do report
`unlink`. This is pinned by
`src/main/services/watcher/singleFileWatch.rename.integration.test.ts`, which
drives the **real** production watcher factory against a real `rename` in
`os.tmpdir()` and asserts the disjunction: either `unlink` (the branch's premise)
or `change` *followed by a further change that still arrives* (proving the watch
survived). **Do not delete the re-arm branch as dead code** because it never
fires on a macOS box — and do not weaken that test to assert one platform's
answer, or a platform that reports `change` and then goes deaf would break the
fix silently.

### Subscriber counting

`WatchedFile.webContentsIds: Set<number>` became
`subscribers: SubscriberCounter` (`watcher/SubscriberCounter.ts`), a
`Map<number, number>`. A `Set` of window ids cannot represent **two consumers
inside one window** watching one path: the first `unwatchFile` removed the id and
closed the watcher out from under the second, which then went permanently deaf.

| Method | Semantics |
|---|---|
| `add(id)` | Increment (first add = 1) |
| `release(id)` | Decrement; delete the key at 0; returns how many windows still hold a subscription |
| `removeAll(id)` | Drop the key outright — the webContents itself is gone (window closed, dev refresh), so every subscription it held dies together |
| `has` / `size` / `countFor` / `totalSubscriptions` / `ids()` | Reads for `unwatchAll`, notification and diagnostics |

`unwatchFile` closes the chokidar watcher only when `release()` reaches 0;
`cleanupForWebContentsId` and `unwatchAll` use `removeAll`.

The guarantee is precisely "no `release` before the last one closes the watch" —
it holds only while every consumer that starts a watch releases it exactly once,
and while joining an existing watch cannot fail. That is why `watchFile` checks
`MAX_WATCHED_FILES` **after** the join branch: a refused join whose consumer
still released on unmount would decrement a count it never incremented.

### Renderer side: the read-only hook and the shared slot

- **`hooks/useFileChangeSubscription.ts`** — a read-only subscription for
  surfaces that only *display* a file. Deliberately **not** an option on
  `useFileWatcher`: that hook is structurally text-coupled (it reads the file as
  UTF-8 and hands a `string` to `onContentUpdate`), and its v0.9.1 echo/conflict
  machinery is dead weight for a surface that never writes. It returns
  `{ isReloading, isFileDeleted, isWatchUnavailable, unavailableReason,
  markReloaded, recover }`, depends on `[filePath]` only (callbacks live in
  refs), **never** calls `fileWatch.pause` / `resume` (those are global per path
  with no safety timeout, so a stuck pause would deafen every consumer of that
  path), and re-checks existence via `file:getStats` before reporting a delete.
  `classifyWatchStartFailure` maps a refused `start` to `'limit'` only for the
  watched-files cap, and `'watcher-error'` otherwise, so the UI never tells a
  user to close tabs for an unrelated fault.
- **`hooks/fileWatchSlot.ts`** — one consumer's hold on a main-process watch,
  used by **both** hooks. `window.api.fileWatch.start` is not idempotent (it
  increments a per-window count), so a consumer must send exactly as many stops
  as successful starts. The slot pairs an `isHeld` flag with a serialised
  operation queue, which makes three failure modes impossible: a double
  acquire (leaks a slot out of the 100 available until `start` refuses for every
  surface), an unmatched release (deafens whichever panel legitimately holds the
  count), and a stop overtaking its own start (leaks the slot permanently).
  `releaseFileWatch` is safe to call unconditionally in an effect cleanup.

---

## DirectoryWatcherService (Directory Watching)

Monitors entire project folder for structural changes (files/folders created, deleted, moved) **and** in-place content modifications (chokidar `change` events from `fs.writeFile` truncate-in-place, added in #241).

### Architecture

- **Backend**: chokidar 3.6.0 on macOS and Linux; one `NativeRecursiveWatcher` per project on Windows (#211) – see [Watch backends](#watch-backends-211)
- **Event Pipeline**: VS Code-inspired ThrottledWorker + EventCoalescer, the same for both backends
  - 75ms collection window for batching events
  - 200ms throttle between processing rounds
  - AtomicSaveDetector (100ms) for unlink events – chokidar only; the native backend has already confirmed a removal with `lstat`
- **Events**: `add`, `addDir`, `unlink`, `unlinkDir`, `change`
- **Scope**: Entire project directory (recursive), minus every excluded, hidden or ignored path – see [Watched files](#watched-files)
- **Start**: only after the project's first tree read settles (#211) – see [The watcher starts after the first tree read](#the-watcher-starts-after-the-first-tree-read-211)
- **Cleanup**: Automatic on window close and app quit

> The `change` event covers in-place file content modifications from any source – Monaco autosave, terminal commands (`sed`, `echo >>`), external editors, format-on-save scripts. It is what wakes `useGitStatus.debouncedRefresh()` so the Project Tree's git badges update after an edit without a manual refresh. Prior to this, only structural changes broadcast on this channel, so badges only updated after create/delete/rename – not after editing an existing file.

### Watched Files

Uses a **selective blacklist** approach (same as VS Code). Since #211 one project path filter, `ProjectPathFilter` (`src/main/utils/projectPathFilter.ts`), answers "is this path dropped?" for the tree walk and for both watcher backends, always on the **project-relative** path. A path is dropped when it is:

- **excluded** – matched by the `files.exclude` list (global plus project; merge and syntax: [Settings § Exclude list](../settings.md#exclude-list-filesexclude)). The tree does not show or read it and neither backend watches it;
- **hidden** – any path segment equals a `tree.hiddenPatterns` name (the tree's own rule; default `node_modules` and `.git`). Neither backend watches it;
- **ignored** – `/` + the relative path contains `/` + a `watcher.ignoreList` entry (default `DEFAULT_WATCHER_IGNORE_PATTERNS` in `src/shared/constants.ts`). The tree still shows it; neither backend watches it;
- **outside the project** – dropped, fail closed. The project root itself is never dropped.

Because the test runs on the project-relative path, a project that itself lives under a folder named `build`, `out` or `dist` is watched normally; before #211 the substring test ran on the absolute path and such a project was not watched at all. The ignore rule is still a substring test, so `out` also matches `outline` (a known limit).

**What IS watched:**
- Dotfolders: `.claude/`, `.github/`, `.vscode/`, `.idea/`
- Dotfiles: `.env`, `.gitignore`, `.npmrc`, etc.

This ensures AI agent file changes (e.g., Claude Code creating `.claude/commands/`) are immediately detected.

**What is NOT watched (performance):**
- `.git/` as a whole – it is a default hidden name, so since #211 chokidar no longer watches it either; `GitWatcherService` owns git state
- `node_modules/`, `.pnpm/`, `.yarn/cache/`, `bower_components/` - JS package managers
- `.venv/`, `venv/`, `.virtualenv/`, `.conda/` - Python virtual environments
- `dist/`, `build/`, `out/`, `.output/` - Build outputs
- `.next/`, `.nuxt/`, `.cache/`, `.parcel-cache/`, `.turbo/`, `.vite/` - Framework caches
- `coverage/`, `__pycache__/`, `.pytest_cache/`, `target/` - Test/build artifacts
- Anything in the project's `files.exclude` list

**Filter order.** On chokidar the drop test is the function-based `ignored` option, so a dropped folder is never scanned. On Windows it runs in the native watcher's callback before any `lstat`. Both backends then pass through the same backstop in `DirectoryWatcherService.queueEvent`, right after the session guard and **before** pause accounting and metrics: a dropped path is never counted as a missed change while paused, never counted as received (`eventsFiltered` counts it instead), and never broadcast. A burst of only dropped paths therefore sends nothing to the renderer, so it starts neither a tree re-read nor a git refresh.

`setPathFilter(filter)` replaces the filter; `ProjectService` builds a fresh one on every project open and hands the **same** instance to `FileService` and `DirectoryWatcherService`. Until then the default hidden and ignore lists apply, with no exclude list.

### Watch Depth (Performance)

The directory watcher supports an optional recursive depth cap to reduce load on very large projects.

- Config key: `directoryWatchDepth` (SettingsService)
- No UI control at the moment. Configure via preload settings API, e.g. in DevTools:
  - `await window.api.settings.setDirectoryWatchDepth(2)`
  - `await window.api.settings.setDirectoryWatchDepth(null)` for Unlimited
- Behavior: on chokidar it is the `depth` option. On Windows the native handles stay recursive and deeper events are dropped by the filter, with chokidar's rule (a path of *n* segments is dropped when *n* − 1 > depth). The watcher uses the new setting on the next start

Recommended:
- Start with "Unlimited"
- Use smaller depths when the tree is very large and deep

### Watch backends (#211)

`selectDirectoryWatchBackend(platform, env)` (`src/main/services/watcher/directoryWatchBackend.ts`) picks the backend: `native-recursive` on `win32`, `chokidar` everywhere else. `DirectoryWatcherService` reads it once, in its constructor (the optional `{ backend }` option overrides it, which the native wiring suite uses), and logs `Directory watcher backend selected` at the first watch. Both backends satisfy the same `DirectoryWatchHandle` seam (`on(...)`, `close(): Promise<void>`), so everything after the watcher – `queueEvent`, the throttle, the coalescer, pause, catch-up – is shared.

**Escape hatch.** `ERFANA_DIRECTORY_WATCHER=chokidar` in the environment Erfana starts with forces chokidar on every platform. It exists for support and diagnosis only: there is no setting and no UI. Only that exact value counts; any other non-empty value is ignored and logged as `Directory watcher override ignored: unknown value` (the value itself is not logged).

**Why Windows changed.** chokidar 3 on Windows opens one `fs.watch` handle per folder and scans the whole project while the first tree read runs. On a project of about 222,000 entries that meant tens of thousands of handles, and the scan competed with the tree walk for libuv's four-thread pool. The native backend holds a small, bounded set of handles instead, and none at all for excluded, hidden or ignored folders it knows about.

**The Windows plan** (`src/main/services/watcher/NativeRecursiveWatcher.ts`):

- The root is watched **non-recursively**. Every direct child folder of a *split folder* gets **one recursive** watch, unless it is itself a split folder, where the rule repeats one level down. A dropped child gets no handle at all, so its churn never fills a Windows change buffer.
- *Split folders* are the root plus every ancestor of a *split path*. Split paths are the **path entries** of the exclude list (`filter.splitPaths()`) and the **walk hints**: the dropped folders at two or more segments deep that the last completed root tree walk met – `packages/a/node_modules`, `src/dist`, `a/b/test-tmp` from `**/test-tmp`. The walk visits every folder anyway, so a hint costs no I/O. Hints are read when the watcher plans (start or restart).
- **Caps:** 64 path-entry split paths and 64 walk hints, each at most 16 segments deep, and at most **512 handles** per project. Past a cap a folder keeps one recursive watch (its events are still dropped by the filter), and the `Native directory watcher ready` line logs `planCapped: true`. A plan pass opens every direct child before it expands any split one, so the handle cap collapses a deeper folder, never a later sibling. A split folder whose listing fails (other than as gone) also keeps one recursive watch.
- **Links are never watched.** Junctions, directory symlinks and file symlinks are leaves: never split, never given a handle. An entry that `readdir` does not type as a plain file or folder is confirmed with `lstat`.
- Every handle is opened under `fs.realpathSync.native(root)`, never the 8.3 short form, which guards against a libuv 1.52.x abort on a short-name watch (Electron 39 ships libuv 1.51.0, which is not affected). Emitted paths are joined onto the caller's root string.
- Keys are folded to lower case (Windows is case-insensitive), so a case-only rename re-lists a folder instead of opening a second watch.

**Events.** `fs.watch` reports only `rename` or `change` plus a name. A raw event is dropped by the filter first; a surviving one is classified by one `lstat` in `NativeEventClassifier` (at most 2 in flight, a 10,000-path backlog) and emitted as `add`, `addDir`, `unlink`, `unlinkDir` or `change`. A new direct child folder of a split folder is reported (`addDir`) only once its own watch is open. Details, the mapping table and the deleted- and renamed-folder handling: [Technical details § The Windows native watcher](./technical-details.md#the-windows-native-watcher-211).

**Lost events → one debounced re-read.** Windows reports a full change buffer as a `null` filename. On a split folder's own (non-recursive) watch the folder is re-listed and only the differences are emitted. On a recursive watch, or when the classifier backlog trips, the watcher asks for a **resync**, debounced to 1 s of quiet and at most 5 s of waiting, so one burst costs one re-read. `DirectoryWatcherService.handleResync` answers it with one `catchUp: true` refresh – or, while paused, records it as one unknown drop in the pause episode, which the pausing window's next completed read covers (#210). The watch keeps working after an overflow; it is not re-opened.

### The watcher starts after the first tree read (#211)

`useProjectManagement` keeps a `firstReadPending` state, and `initialLoadComplete` – what `useDirectoryWatcher` waits for – is now `projectPath !== null && !firstReadPending`. The `project:changed` listener sets it in the same synchronous block as `setProjectPath`, so the render that remounts the tree never starts a watcher early. It is cleared when that first read settles, **success or failure** (a failed first read can still self-heal through the watcher), when a superseding reload settles, on close, and on main's no-op re-open. Before #211 the flag was `true` from mount, so chokidar's initial scan (or the new backend's plan) competed with the first tree read. Git status still starts at once. Neither the tree read nor git status ever waits for the watcher's `ready`.

One consequence, pre-existing in another form: a change made during the first read in a folder the walk has already passed, or before the watcher's plan has opened that folder's watch, shows up only with the next change or a manual refresh.

### Use Cases

| Scenario | Behavior |
|----------|----------|
| Create file externally | Tree updates automatically within 500ms |
| Delete folder externally | Tree updates, expanded folder state preserved |
| Edit file content (Monaco autosave or external edit) | Git status badge refreshes after autosave settles (~2.5–3 s total) |
| Git checkout (bulk changes) | Debounced to single refresh after changes settle |
| Internal CRUD (create/delete/rename) | Watcher paused, no double refresh |
| Another program (e.g. an agent in the terminal) adds or removes items while an internal CRUD runs | One catch-up refresh at resume; none when nothing outside changed or the operation's own refresh already showed it (#210) |
| Expand folders, make external changes | Folders remain expanded after refresh |
| Very large project keeps changing while the tree is being read | Changes are picked up by one follow-up read after the running one; reads never overlap and the tree never shows an older state (#208) |
| Something keeps writing inside an excluded, hidden or ignored folder | Nothing reaches the renderer: no tree re-read, no git refresh (#211) |
| A burst overflows a Windows change buffer | One debounced catch-up re-read about 1 s after the burst ends, at most every 5 s while it lasts (#211) |

**Tree refresh is coalesced (#208):** the tree refresh that a watcher event (or a file operation) triggers is single-flight. In the renderer, `refreshFiles` allows one read per project scope; in main, `FileService.readDirectory` allows one walk per path. Calls made while a read runs share one follow-up read that starts after it, so a burst costs at most two reads, and a result that is older than the tree on screen – or belongs to a project that is no longer open – is dropped. One consequence: a read that never finishes (an unreachable network drive) holds up every later read of that folder, and is logged as `readDirectory still running` after 60 s. See [Technical Details § Tree refresh is single-flight](./technical-details.md#tree-refresh-is-single-flight-208).

**Auto-resume safety timeout (v0.7.2, #103):** The PauseController includes a 10-second safety timeout. If `resume()` is not called within 10 s of `pause()` – for example due to a lost IPC message – the controller auto-resumes, logs a warning, discards the pause episode (below) and sends one compensating refresh, flagged `catchUp: true` (#210), to keep the tree in sync. This prevents the watcher from being permanently paused.

**Catch-up after a pause ([#210](https://github.com/qodeca/erfana/issues/210)):** a pause drops every event, so a change another program made after the operation's own tree read began, and before resume, used to stay invisible until the next unrelated refresh. The first pause now opens a pause episode (`watcher/PauseEpisode.ts`, pure) that lives until the full resume:

- Only structural drops count (`add`, `addDir`, `unlink`, `unlinkDir`); `change` never does – content edits do not alter the tree, and the operations refresh git status separately.
- The operation's own changes are filtered by kind: after success each mutation handler in `file-handlers.ts` reports what it changed through `noteInternalChange`. An `added` record filters only `add` / `addDir`, a `removed` one only `unlink` / `unlinkDir`, so a deletion inside a just-made copy still counts. Residual case: if Erfana copies, moves or renames a folder and another program adds a file inside that same folder after the refresh read began, that `add` is filtered as Erfana's own change and can still be missed until the next change or a manual refresh. Past 256 records the episode stops filtering and forces a catch-up.
- A successful read of the paused root by the window that paused covers every drop seen before that read began (`file:readDirectory` calls `beginTreeRead` first and commits only after the read resolves). A failed read, a subfolder read or another window's read covers nothing.
- At the full resume, one `directory-watch:changed` with `catchUp: true` goes out if any drop is left uncovered. Nested pauses share one episode, so they catch up once. The renderer lets a `catchUp` event through even when the next operation has already set its internal-operation flag, and `withWatcherPause` now clears that flag before resume on the error path too.

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `directory-watch:start` | Renderer → Main | Start watching project directory |
| `directory-watch:stop` | Renderer → Main | Stop watching directory |
| `directory-watch:pause` | Renderer → Main | Pause watching during internal CRUD |
| `directory-watch:resume` | Renderer → Main | Resume watching after CRUD completes |
| `directory-watch:stop-all` | Renderer → Main | Stop every directory watch held by the calling window (cleanup) |
| `directory-watch:get-stats` | Renderer → Main | Watcher statistics (debugging) |
| `directory-watch:changed` | Main → Renderer | Event: Directory structure changed |
| `directory-watch:project-deleted` | Main → Renderer | Event: Project folder deleted |
| `directory-watch:error` | Main → Renderer | Event: Watcher error (transient/permanent) |

### Implementation Location

- **Service**: `src/main/services/DirectoryWatcherService.ts`
- **IPC Handlers**: `src/main/ipc/directory-watcher-handlers.ts`
- **Renderer Hook**: `src/renderer/src/hooks/useDirectoryWatcher.ts` (lifecycle, event handling, AC-010 guard)
- **Pure Logic**: `src/renderer/src/hooks/useDirectoryWatcher.logic.ts` (state guards, message creation)
- **Pause Utility**: `src/renderer/src/components/ProjectTree/withWatcherPause.ts` (pause/resume wrapper)
- **Pause episode (#210)**: `src/main/services/watcher/PauseEpisode.ts` (drop counting, own-change filter, read coverage; `recordUnknownDrop()` for a resync during a pause, #211); hooks in `src/main/ipc/file-handlers.ts`
- **Path filter and exclude list (#211)**: `src/main/utils/projectPathFilter.ts` (`ProjectPathFilter`, `toRootRelative`, split paths and walk hints), `src/main/utils/excludeMatcher.ts` (the `files.exclude` matcher), `src/shared/ipc/files-exclude-schema.ts` (lenient schema); merged by `ProjectSettingsService`, applied by `ProjectService`
- **Backends (#211)**: `src/main/services/watcher/directoryWatchBackend.ts` (selector and `DirectoryWatchHandle` seam), `NativeRecursiveWatcher.ts` (Windows plan, lost events, self-events), `NativeEventClassifier.ts` (the `lstat` queue)
- **Watcher gate (#211)**: `firstReadPending` in `src/renderer/src/hooks/useProjectManagement.ts`
- **Tree refresh (single-flight, #208)**: `src/shared/coalescingRunner.ts`, used by `FileService.readDirectory` (`src/main/services/FileService.ts`) and `refreshFiles` in `src/renderer/src/hooks/useProjectManagement.ts`
- **Integration**: `src/renderer/src/components/ProjectTree/ProjectTree.tsx`
- **Component**: `src/renderer/src/components/ProjectTree/ProjectTreeNode.tsx` (controlled pattern)
- **Spec**: `specs/archived/spec-t3-016-project-tree-refresh/` (behavioral contract, archived)

### Expanded State Preservation

The file tree maintains a `Set<string>` of expanded folder paths. When the tree refreshes due to external changes, this state is preserved, ensuring folders remain expanded.

### Recoverable Project Deletion (ENOENT)

If the watched project folder is deleted or becomes unavailable mid‑session (ENOENT/no such file):

- Service broadcasts `directory-watch:project-deleted { dirPath }`
- Internally calls `stopAll()` (not `dispose()`), clearing watchers while keeping the service reusable
- User can select a new project without restarting the app

This avoids a non‑recoverable state after disruptive filesystem events.

### Auto-Restart on Transient Errors (v0.6.x)

The DirectoryWatcherService automatically recovers from transient filesystem errors using exponential backoff:

**Transient Errors (auto-restart):**
- `ENOENT` - File/directory temporarily unavailable
- `EMFILE` - Too many open files (system limit)
- `EACCES` - Temporary permission issue
- `ESTALE` - Stale file handle (NFS)

**Permanent Errors (no restart):**
- `ENOSPC` - No space left on device
- `EPERM` - Operation not permitted
- Other unrecoverable errors

**Backoff Strategy:**
- Initial delay: 800ms
- Multiplier: 2x per attempt
- Sequence: 800ms → 1600ms → 3200ms
- Max attempts: 3

After 3 failed restart attempts the service stops retrying and sends `directory-watch:restart-failed` – or `directory-watch:project-deleted` when the root is still missing (`ENOENT`). Since #211 both go to the windows captured when the restart was scheduled (`notifyIds`); before, the watch's map entry was already gone, so `restart-failed` was never delivered. The preload bridge still exposes no listener for `restart-failed` (see [API services](../api-services.md#directory-watchrecovered-and-directory-watchrestart-failed)). Restart statistics are tracked in `WatcherMetrics` for debugging.

**A watch that cannot start (#211):** the Windows backend watches the root synchronously in its constructor, so a missing root throws `ENOENT` at once (an `EPERM` on the root is reported as `ENOENT`). `watchDirectory` then schedules a restart before rethrowing, so a root that was briefly unavailable recovers and a deleted one ends in `directory-watch:project-deleted` once the attempts run out. A restart overtaken by `stopAll` (a project switch) sends nothing.

**EMFILE log deduplication**: Uses `RateLimitedLogger` (10s cooldown) to prevent EMFILE error log spam during cascading FD exhaustion. See `src/main/utils/RateLimitedLogger.ts`.

**Implementation:** `DirectoryWatcherService.ts`, `WatcherMetrics.ts`, `RateLimitedLogger.ts`

---

## GitWatcherService (Git State Watching) - v0.6.3

Monitors git repository state files for real-time status updates in the Project Tree.

### Architecture

- **Library**: Chokidar (native fs events)
- **Multi-path Watching**: Watches all git state files that affect status
- **Ready Timeout**: 5s (`WATCHER_READY_TIMEOUT_MS`) – if chokidar doesn't emit `ready` within timeout, watcher proceeds with timeout path; `raceResolved` guard prevents double-fire; diagnostic logging includes `elapsedMs`, `pathCount`, `timeoutMs`
- **Event Coalescing**: 150ms window to prevent refresh storms
- **Auto-recovery**: Exponential backoff (800ms, 1600ms, 3200ms)
- **Session Tokens**: Guards against stale events during project switches

### Watched Git Paths

| Path | Purpose |
|------|---------|
| `.git/index` | Staged changes (git add/reset) |
| `.git/HEAD` | Branch switches, detached HEAD |
| `.git/refs/heads/` | New branches, branch commits |
| `.git/FETCH_HEAD` | git fetch/pull operations |
| `.git/stash` | Stash push/pop operations |

### Use Cases

| Scenario | Behavior |
|----------|----------|
| git add/reset | Index change detected, status refreshed within ~750ms |
| git checkout branch | HEAD change detected, tree updates |
| External git CLI operations | Detected via index/refs changes |
| Rapid git operations | Coalesced to single refresh (150ms window) |
| Network/cloud drives | Falls back to GitPollingService |

### Window Cleanup (#106)

`cleanupForWebContentsId(id)` is called from `webContents.on('destroyed')` in `index.ts` to prevent stale git watchers from accumulating after window close or dev refresh.

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `git-watcher:start` | Renderer → Main | Start watching git state files |
| `git-watcher:stop` | Renderer → Main | Stop git watching |
| `git-watcher:status` | Renderer → Main | Get current watcher status |
| `git:state-changed` | Main → Renderer | Event: Git state changed |

### Implementation Location

- **Service**: `src/main/services/GitWatcherService.ts`
- **Interface**: `src/main/interfaces/IGitWatcherService.ts`
- **IPC Handlers**: `src/main/ipc/git-watcher-handlers.ts`
- **Schema**: `src/shared/ipc/git-watcher-schema.ts`
- **Integration**: `src/renderer/src/hooks/useGitStatus.ts`

---

## GitPollingService (Hybrid Polling Fallback) - v0.6.3

Provides polling-based git status detection as fallback for unreliable file system events.

### Architecture

- **Purpose**: Fallback for network drives, cloud sync, VMs
- **Default Interval**: 5 seconds (user-configurable 3-10s)
- **Coordination**: Skips if GitWatcherService active within 2 seconds
- **Index Hash**: Detects changes by hashing `.git/index` file

### Polling Strategy

**Hybrid Coordination**:
```
If GitWatcherService triggered within 2s → skip this poll
Otherwise → hash .git/index → compare → emit if changed
```

This prevents duplicate refreshes when file watching works, while ensuring detection on systems where it doesn't.

### Use Cases

| Scenario | Behavior |
|----------|----------|
| File watching works | Polling skips (coordinator reports recent activity) |
| Network/cloud drive | Polling detects changes every 5s |
| VM shared folders | Polling handles missing fsevents |
| User disables polling | Only file watching active |

### Configuration

Users can configure polling via Settings overlay:

| Setting | Default | Range |
|---------|---------|-------|
| `gitStatus.pollingEnabled` | `true` | boolean |
| `gitStatus.pollingInterval` | `5000` | 3000-10000ms |

### Window Cleanup (#106)

`cleanupForWebContentsId(id)` is called from `webContents.on('destroyed')` in `index.ts` (synchronous) to stop polling for the destroyed window.

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `git-polling:start` | Renderer → Main | Start polling |
| `git-polling:stop` | Renderer → Main | Stop polling |
| `git-polling:set-interval` | Renderer → Main | Update the polling interval at runtime |
| `git-polling:set-enabled` | Renderer → Main | Enable/disable at runtime |
| `git:poll-triggered` | Main → Renderer | Event: Poll detected changes (`GIT_EVENT_CHANNELS.POLL_TRIGGERED` in `src/shared/ipc/git-watcher-channels.ts`) |

### Implementation Location

- **Service**: `src/main/services/GitPollingService.ts`
- **IPC Handlers**: `src/main/ipc/git-watcher-handlers.ts`
- **Settings Schema**: `src/shared/ipc/global-settings-schema.ts`
- **Settings UI**: `src/renderer/src/components/Settings/SettingsOverlay.tsx`

---

## GitEventCoalescer (Git Event Coalescing) - v0.6.3

Specialized event coalescer for git state changes.

### Purpose

Git operations often touch multiple files rapidly (e.g., `git checkout` modifies index, HEAD, and refs). The GitEventCoalescer merges these into a single status refresh.

### Configuration

- **Window**: 150ms (`DEFAULT_COALESCE_WINDOW_MS`)
- **Deduplication**: Multiple events within window → single refresh

### Implementation

- **File**: `src/main/services/watcher/GitEventCoalescer.ts`
- **Tests**: `src/main/services/watcher/GitEventCoalescer.test.ts`

---

## VS Code-Inspired Performance Optimizations (v0.4.6)

The DirectoryWatcherService includes performance optimizations inspired by VS Code's file watching implementation.

### Watcher Components

Located in `src/main/services/watcher/`:

**EventCoalescer** (`EventCoalescer.ts`)
- Deduplicates and collapses redundant events
- 5 coalescing rules:
  - CREATE + DELETE → ∅ (cancel out)
  - DELETE + CREATE → CHANGE
  - Multiple CHANGEs → single CHANGE
  - etc.
- Prevents cascade effects from atomic save operations

**ThrottledWorker** (`ThrottledWorker.ts`)
- 75ms collection window for batching events
- 200ms throttle between processing rounds
- 500-event chunks to prevent UI blocking
- Queue management with 30,000-event buffer cap + FIFO overflow
- **Backing structure**: offset-based deque (`buffer: T[]` + `bufferOffset: number`). Push + evict + chunk consumption are amortized O(1). Periodic compaction reclaims underlying array memory when ≥half of slots are wasted head (floor 1024 to avoid thrash). Prior implementation used `this.buffer = this.buffer.slice(n)` which allocated a fresh array per eviction — fine at low burst rate but O(n²) + heavy GC under sustained overflow (30 k × 30 k element copies during a 60 k-event stress burst). See #173 / `docs/windows/known-flakes.md` for the story.

**AtomicSaveDetector** (`AtomicSaveDetector.ts`)
- Detects write-to-temp-then-rename save patterns
- 100ms delay to distinguish atomic saves from deletes
- Prevents false "file deleted" events from editors that use atomic saves

**WatcherMetrics** (`WatcherMetrics.ts`)
- Throughput tracking (events/second)
- Latency measurement (event-to-process time)
- Coalesce efficiency (events removed by coalescing)
- Useful for debugging and performance monitoring

**PlatformConfig** (`PlatformConfig.ts`)
- Platform-specific handling (macOS, Linux, Windows)
- FSEvents configuration on macOS
- inotify handling on Linux

### DirectoryWatcherService Integration

The service integrates these components:
- ThrottledWorker replaces simple debounce for chunked processing
- EventCoalescer runs before event delivery
- AtomicSaveDetector distinguishes save vs delete
- WatcherMetrics available for monitoring
- 30,000 event buffer limit with FIFO overflow

### Files

- `src/main/services/watcher/` - All watcher optimization modules
- Watcher unit tests in `src/main/services/watcher/*.test.ts`
- Directory pipeline integration tests in `src/main/services/DirectoryWatcherService.pipeline.test.ts` (26 tests, 9 of them the #210 catch-up)
- Git pipeline integration tests in `src/main/services/GitWatcherService.pipeline.test.ts` (22 tests, #99)
  - Covers AC-004 (git add), AC-005 (git commit), AC-006 (git checkout), AC-018 (coalescer dedup)
  - Additional: all 5 event types, correlation ID, WatcherMetrics, disposal guards, circuit breaker
- Watcher resilience tests in `src/main/services/WatcherResilience.test.ts` (14 tests, #100)
  - AC-011 (polling fallback), AC-015 (redundant polling suppression), AC-016 (exponential backoff restart)
- Window visibility gating tests in `src/renderer/src/hooks/useGitStatus.test.ts` – 5 of the file's 38 tests cover the visibility-gating case (#102)
  - AC-012: git status refreshes dropped while hidden, single catch-up on restore, cooldown respected
- Event buffer overflow tests in `src/main/services/watcher/ThrottledWorker.test.ts` (24 tests, #102 + #173)
  - AC-017: 30,000-event cap, FIFO eviction, no crash/hang, post-burst recovery
  - Offset-deque coverage: 60 k-event stress burst runs in <1 s cross-platform after the refactor
- 016-NFR-001 main-process latency integration tests in `DirectoryWatcherService.pipeline.test.ts`
  - Isolates chokidar + Defender noise via fake timers; asserts <200 ms virtual latency for single add + atomic-save flows
- Hook tests in `src/renderer/src/hooks/useDirectoryWatcher.test.ts` (14 tests)
- Pause/resume tests in `src/renderer/src/components/ProjectTree/withWatcherPause.test.ts` (18 tests)
- Project switching tests in `src/main/services/ProjectService.switching.test.ts` (20 tests, #101)
  - Session token guards, step ordering, in-flight event handling during project switches
- Renderer switching tests in `src/renderer/src/components/ProjectTree/ProjectTree.switching.test.tsx` (11 tests, #101)
  - Tree clearing, new project loading, stale event rejection, git status updates
- Exclude list, path filter, Windows backend and watcher gate (#211): see [Patterns & Testing § Large projects on Windows](./patterns-and-testing.md#large-projects-on-windows-211)

---

## Symlinks

- Watchers do not follow symlinks (security)
- **The Windows directory watcher never opens a handle on a link** (#211): junctions, directory symlinks and file symlinks are leaves in its plan, and a recursive `fs.watch` does not report inside them (measured in the [W0 spike](../spikes/211-windows-fs-watch.md))
- **Single-file watches set `followSymlinks: false` explicitly** (`watcher/singleFileWatch.ts`, added in #70). chokidar v3 defaults this to `true`, so a link planted inside the project would otherwise make the watcher — and the automatic re-read behind it — track an out-of-project target
- Symlinked entries are flagged in the Project Tree with a small chain icon and tooltip
- Operations on symlink targets remain subject to project boundary checks. Since #70 the read handlers enforce that with `fs.realpath` on both ends rather than by comparing path text — see [API Services § Path confinement](../api-services.md#path-confinement-for-the-file-read-ipc-handlers)

---

## Documentation Structure

This documentation is split into focused files for optimal Claude Code context usage:

- **[README.md](./README.md)** (this file) - Overview and service architecture
- **[Patterns & Testing](./patterns-and-testing.md)** - Implementation patterns, session tokens, test scenarios
- **[Technical Details](./technical-details.md)** - Performance, security, edge cases, integration points

---

See: [Architecture](../architecture.md) | [IPC Patterns](../ipc-patterns.md) | [Development Tasks](../development-tasks.md)

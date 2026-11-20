# File Watching & Auto-Refresh

Erfana automatically detects and responds to external file system changes using two complementary watching systems.

## Overview

**FileWatcherService**: Watches individual open files for content changes, surfaces editor reload/conflict UI
**DirectoryWatcherService**: Watches entire project directory for both structural changes (create/delete/rename) **and** in-place content changes (`fs.writeFile` in place), broadcasts `directory-watch:changed` for both

FileWatcherService uses [Chokidar](https://github.com/paulmillr/chokidar) on every platform. DirectoryWatcherService uses chokidar on Linux, and on Windows and macOS a native recursive watcher built on Node's own `fs.watch` ([#211](https://github.com/qodeca/erfana/issues/211)) – see [Watch backends](#watch-backends-211). Both share the debouncing and race-condition guards described below.

> **Chokidar is pinned to exact `5.0.0`.** chokidar 3 pulled `braces` (GHSA-vfj7-8cjw-p6xm, no patched release) into the production tree. chokidar 4+ has no globbing (a name such as `[draft] {v2}.md` is literal) and no macOS FSEvents: it watches each file via kqueue / `fs.watch` (one FD per file), which exhausts the process FD table on large projects and breaks spawning child processes – PDF export's hidden render window crashed with `Failed to initialize sandbox` on a 20k-file folder (the reason for the earlier 3.6.0 pin, commit `68cfab8` – pre-migration; no longer resolvable, that history was rewritten at the 2026-06 migration – shipped in v0.12.0). That is why the project directory watcher on macOS runs on the native backend instead; single-file watches stay on chokidar. The rationale is also in the comment in the `chokidar.watch(...)` options of `createChokidarWatcher` (`src/main/services/watcher/directoryWatchBuilders.ts`).

---

## FileWatcherService (File Content Watching)

Monitors open files for external content modifications.

### Architecture

- **Library**: Chokidar (native fs events, not polling)
- **Write-finish wait**: per profile – 75 ms for an editor tab (`TIMING_PROFILES` in `src/shared/freshness/timingProfiles.ts`); no main-side debounce since #478
- **Events**: `change`, `unlink`, `error`
- **Scope**: Per-file watching (on-demand when file is opened)
- **Limit**: 100 files for editor and image tabs, app-wide (the `tabs` bucket in `WATCH_BUCKETS`, #478). The cap counts files, not subscriptions — joining a file that is already watched can never fail on it; a subscribe past it waits in a first-in, first-out line (up to 200) and starts when a slot frees
- **Symlinks**: `followSymlinks: false` — the watch is on the path itself, never on what a link at that path points at (#70)
- **Consumers**: every tab type that shows file content follows its file through the one watch layer and the shared freshness tracker (#478) – see [Following a file: the freshness capability](#following-a-file-the-freshness-capability-478). Renderer adapters: `useFileWatcher` (Markdown editor, read/write), `useFileChangeSubscription` (image viewer, read-only) and the Markdown preview's image store. Main-side adapters: the HTML preview's page file and its sub-files (`PreviewWatchPool`, one in-process owner per view, `preview` profile) and the comment watches. Each subscription has a `watchId` its consumer makes up, so no consumer can release another's – see [HTML preview § Auto-refresh](../html-preview/README.md#auto-refresh)

### Use Cases

| Scenario | Behavior |
|----------|----------|
| File modified externally, no local changes | Auto-reload silently, show "Reloaded from disk" in toolbar (1s) |
| File modified externally, has unsaved changes | Show orange conflict bar with options |
| File replaced atomically (write temp + rename) | Surfaces as a `changed` event, not a delete — see [Single-file watch internals](#single-file-watch-internals-70) |
| Erfana's own save of a document or of `~/.erfana/settings.json` | Crash-safe: `atomicWriteText` / `atomicWriteJSON` (`src/main/utils/atomicWrite.ts`) write a same-folder temp file named `.erfana-tmp-<uuid>` (settings use `.<uuid>.tmp`), fsync it, then rename it over the target – so the editor's own save is the atomic-replace row above. Symlinked, hard-linked, read-only, foreign-owned files and mounts that cannot rename are written in place instead. `.erfana-tmp-*` is dropped by `shouldDropRel` in `watcher/DirectoryWatcherCore.ts` (both backends) and skipped by the tree walk, so it never shows in the tree or triggers a reload; temp files older than 10 minutes left by a crash are swept in the background when a project opens (`atomicTempSweep.ts`) |
| File deleted externally | The deleted notice ("… was deleted, renamed or moved on disk.") with **Restore file** and **Close tab** in the editor, **Close tab** in the image viewer (#478 F14); the editor keeps its text. Autosave stays off while the tab shows the deleted state (`shouldAutosave` in `components/Panels/autosaveGate.ts`), so typing never writes the file back; only the tab's own Cmd/Ctrl+S or **Restore file** does, and autosave resumes when the notice goes away (#460) |
| Deleted file comes back (branch switch, merge) | The delete ended the watch, so while a tab shows the deleted state its tracker probes for the file on a back-off of 0.5 s up to 2 s (`DELETED_PROBE_BACKOFF` in `src/shared/freshness/timingProfiles.ts`; one probe at a time, stopped when the tab closes or the file is back). When it is back the tracker subscribes again and reads it: an unedited editor tab shows the file; a tab the user typed in while deleted gets the conflict bar instead (no conflict if the file already holds the buffer's text); an image tab shows the new image. The HTML preview does the same main-side in `previewEntryWatch.ts`: it re-opens the page's watcher and reports a change, so the page reloads and leaves the failed state. A probe, not the project watcher's `add`, because that watcher does not see excluded, hidden or ignored folders or files outside the project (#450) |
| Parent folder renamed, moved or deleted externally | Same as a delete: banner, `(deleted)` in the tab. A single-file chokidar watch hears nothing when its parent folder is renamed, so the project watcher's removals are forwarded to `FileWatcherService.handleAncestorRemovals` (both backends), which runs the affected watch through the normal unlink branch, existence re-check included. A removal that lands while the project watch is paused for one of the app's own operations is forwarded when the pause ends (`PauseEpisode.externalRemovals`, kept as the top-most removed folder). The operation's own removals are left out when it noted them (`noteInternalChange`, usually after their events arrived). Past 256 remembered removals the deepest are folded into their folder, and the open files under that folder are checked on disk instead of being reported; after a resync, or past the internal-change cap, the same check covers the whole watch (`checkWatchedFilesUnder`, which skips the paths the operation removed itself) (#252) |
| Folder above an open file renamed or deleted where the project watcher cannot see | Same banner. The project watcher never reports an excluded, hidden or ignored folder (`dist`, `node_modules`, a `files.exclude` entry), so `FileWatcherService` re-checks the files `DirectoryWatcherService.reportsRemovalsAbove` cannot speak for (`watcher/unseenWatchProbe.ts`, #252): only this session's files inside the project, one `stat` at a time with a 1 s time box (a timeout counts as present), every 2 s plus the last round's duration, and only while some open file is unseen. A file is reported after two rounds in a row found it gone, and never while the app's own operation is removing it. Here only ENOENT/ENOTDIR count as gone, and a locked or unreadable file (EBUSY, EPERM, EACCES, EIO) is still there (`watcher/pathPresence.ts`) |
| An open file that cannot be read when its unlink arrives | It counts as still there and the watch is re-armed, as with the probe. The exception is Windows: a file deleted while another process holds it open answers EPERM or EBUSY until the last handle closes ("delete pending"). On win32 only, the unlink branch asks such a file again after 250 ms (`isPresentAfterSettle`): one that clears is re-armed, one that answers EPERM or EBUSY again ends as **deleted** – keeping a watch on it would stop its folder being deleted. A replacement that cannot be resolved because it is gone is also a delete, never `WATCH_DEAD_OUTSIDE_PROJECT` (#252) |
| Save fails (any reason) | One error toast with the reason (wording from `formatSaveError` in `utils/errorUtils.ts`); the tab stays dirty and the buffer keeps the edit. A failing autosave repeats the toast only when the reason changes (reset when the panel switches file). A save by id through `editorSaveRegistry` shows no panel toast – its caller toasts on `false` |
| **Restore file** (or Cmd/Ctrl+S) when the folder is gone | Only the tab's own **Cmd/Ctrl+S** or **Restore file** of a tab already in the deleted state passes `createParentDirs`, so main recreates the missing folders (inside the project only, nearest existing ancestor checked canonically like `resolveInsideProject` – `file/restoreParentDirectory.ts`) and writes the file back at its original path. An autosave does not run at all while the tab is in the deleted state: the file can come back (a branch switch) before the next probe sees it, and an autosave in that gap would overwrite it with no conflict choice (#450, #460); autosave resumes once the deleted state clears. A save by id (e.g. the preview-move unsaved-changes prompt) never recreates a folder; it fails with the toast instead. If the project folder itself is gone the reason says so. A restore writes with no stamp check (there is no file to compare – F7), and the tracker subscribes again with a new `watchId`, so later outside edits reach the tab without reopening it (#252) |
| Watch dies for any other reason | An `ended` event with its reason. The tracker restarts the watch once on its own; if that is refused too, the tab shows "Auto-refresh stopped for … Changes on disk no longer show here." with **Reload** – never a silent stale tab (#70, #464, #478 G5). Reload subscribes again and reads the file (the editor holds the conflict instead when it has unsaved edits). A project that closed ends the watch quietly |
| File briefly missing or locked mid-write (delete-then-rename writer, `git checkout`, antivirus on Windows) | The change waits in `watcher/writeFinishGate.ts`, not in chokidar's `awaitWriteFinish`: chokidar 5.0.0 kept a dead "pending write" entry when its size check hit ENOENT/EPERM and swallowed every later change for the path. The gate counts a failed check as "still being written" and always ends a wait (at most 5 s), so the next change is always reported (#464). A change reported at that cap is marked forced: the file may still be being written, so the tab's tracker waits for it to settle before it reads and never shows it half-written (#478, P3) |
| File replaced by an atomic save (temp file, then rename over it) | The watch is re-armed on the new file and the change is read at once: unlike a change at the gate's cap, it is not marked forced. **Known limit** (#478, P3 trade-off): a writer that deletes the file and then streams the new one slowly can show a partial version for a moment; its next change, held by the write gate until the writes settle, corrects it. Settling here would add about 75 ms to every atomic save, the main agent write path |
| Path from a terminal link (`C:/proj/a.md`, `c:\proj\a.md`, an 8.3 short name or a junction on Windows) | Accepted: the subscribe's lexical precheck compares resolved paths case-blind on Windows (not a string prefix), expands a local 8.3 short-name spelling of the project folder once (`ipc/confinement/lexicalPrecheck.ts`), and `armWatch` keys the watch by the file's real path – so every spelling of the same file shares one watch (#464, #478 G6). UNC and device paths are still refused before any file-system call |
| One of two windows watching the same file closes | The other keeps its changes: subscriptions are owned per window (`webContents` id + `watchId`), and a closing, reloading or navigating window drops only its own (`FileWatcherService.dropOwner`, wired in `index.ts` by `wireWatchOwner`). The native watch closes only when its last subscription goes (#464, #478 G2) |
| Rapid changes (git operations) | Throttled: at most one read per 250 ms per tab, and the last change is always read |
| More tabs open than the watch cap | The tab past the cap is queued and shows the watch-limit notice ("Too many files are open to follow this one live. …", no Reload); it updates when you switch to it, and the notice clears by itself when a slot frees and the watch starts (#478 G9) |

### IPC Channels

Names in `src/shared/ipc/file-watch-channels.ts`, payloads in `src/shared/ipc/file-watch-schema.ts` (#478). Every request is one strict object.

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `file-watch:subscribe` | Renderer → Main | Start following a file: `{ watchId, filePath, profile }` → `started` (with the file's stamp and `liveRefresh`), `queued` or `refused` with a code. Confined to the open project |
| `file-watch:unsubscribe` | Renderer → Main | Stop one subscription (`{ watchId }`); a foreign or unknown id is a no-op |
| `file-watch:pauseWatch` | Renderer → Main | Pause one subscription around an own save; it ends by itself after `pauseMaxMs` |
| `file-watch:resumeWatch` | Renderer → Main | End that pause; answers whether a change was missed |
| `file-watch:probe` | Renderer → Main | Is the file still the version named? (`same`, `changed`, `missing`, …) |
| `file-watch:readText` | Renderer → Main | The classified text read (`ok`, `too-large`, `binary`, `encoding`, `missing`, `unreadable`; a path outside the project answers `outside-project`) |
| `file-watch:writeText` | Renderer → Main | The checked text write: with `expectedStamp` it writes only if the file is still that version |
| `file-watch:stats` | Renderer → Main | Watcher diagnostics |
| `file-watch:event` | Main → Renderer | An event for one subscription: `changed`, `deleted`, `started`, `restarted` or `ended` with a reason – sent only to the window that owns it |
| `file-watch:check` | Main → Renderer | Check every tracker now (power resume) |

### Implementation Location

- **Service**: `src/main/services/FileWatcherService.ts`
- **Watch factory**: `src/main/services/watcher/singleFileWatch.ts` (`SINGLE_FILE_WATCH_OPTIONS` + `createSingleFileWatcher`, #70)
- **Unlink branch**: `src/main/services/watcher/atomicRearm.ts` (atomic save vs genuine delete, #70)
- **Subscriptions and buckets**: `src/main/services/watcher/watchSubscriptions.ts`, `watchBuckets.ts` (#478)
- **Arming, health round and suspension**: `watcher/armWatch.ts` (the one place a watcher is created or re-created), `watchHealthRound.ts`, `watchSuspension.ts`; `FileWatcherService` extends `watcher/FileWatchCore.ts` (#478)
- **Disk helpers and main-side consumers**: `src/main/services/freshness/` – `fileStamp.ts`, `probeFile.ts`, `textRead.ts`, `textWrite.ts`, `volumeKind.ts`, `mainFreshnessSource.ts`, `mainTrackedWatch.ts` (#478)
- **Send loop**: `src/main/services/watcher/watchNotifier.ts` (#70)
- **IPC Handlers**: `src/main/ipc/file-watcher-handlers.ts`
- **Shared core**: `src/shared/freshness/` – `FreshnessTracker` (following, catching up, retries, the deleted-state probe, restarts), `saveAddOn.ts` (the editor's save), timing in `timingProfiles.ts` (#478)
- **Renderer**:
  - `src/renderer/src/services/freshness/` – the IPC source and the window's freshness environment (#478)
  - `src/renderer/src/hooks/useFreshness.ts` – one tracker per tab
  - `src/renderer/src/hooks/useFileWatcher.ts` (editor adapter: update rule, save, blocked content)
  - `src/renderer/src/hooks/useFileChangeSubscription.ts` (image viewer adapter)
- **Integration**: `src/renderer/src/components/Panels/MarkdownEditorPanel.tsx`, `src/renderer/src/components/Panels/ImageViewerPanel/`
- **UI Component**: `src/renderer/src/components/FileConflictNotification/` – `selectNotice` picks the panel's one notice (deleted > conflict > content unavailable > watch stopped > queued > limited); `FreshnessNotice` renders it and an always-mounted `role="status"` region announces it in the active tab only (#478 F13)

### Following a file: the freshness capability (#478)

Every tab type that shows file content follows its file through one capability. The reasons and the rejected alternatives are in [ADR 0013](../adrs/0013-one-freshness-capability.md); this section is the working description.

**Layers.** A tab's adapter supplies only an update rule (how to read, whether to read now, what to do with what was read). The shared core in `src/shared/freshness/` (`FreshnessTracker`) does the rest: subscribe, catch up, retry, confirm a delete, restart, check. It talks to a source – IPC from the renderer (`file-watch:*`), an in-process owner in main – and `FileWatcherService` is the only watch layer behind both. The tracker holds one state object per tab, `{ watch, content }`, and every notice reads only that:

- `watch`: `active` (live: full or limited), `queued` (waiting for a slot) or `stopped` with a reason (`restart-failed`, `watcher-error`, `outside-project`, `unsupported`, `project-closed`)
- `content`: `fresh`, `changed` (held as a conflict, or deferred while the tab is hidden), `deleted`, or `unavailable` with a reason (`too-large`, `binary`, `unsupported-encoding`, `unreadable`)

**Timing profiles.** All waits live in `TIMING_PROFILES` in `src/shared/freshness/timingProfiles.ts`; a consumer names a profile and never sets a number. The IPC profile enum is built from the same keys.

| Profile | Used by | Settle / poll / gate cap (ms) | Tracker throttle (ms) | Delete confirmed after (ms) | Deleted-file probe (ms) | Limited poll (ms) | Watch bucket |
|---|---|---|---|---|---|---|---|
| `editor` | Markdown editor | 75 / 25 / 5000 | 250 | 500 | 500, backing off to 2000 | 2000 | `tabs`: 100 in all |
| `image` | Image viewer | 75 / 25 / 5000 | 250 | 500 | 500, backing off to 2000 | 2000 | `tabs`: 100 in all |
| `preview` | HTML preview page and sub-files | 50 / 25 / 5000 | 0 (the pool's 30 ms coalesce) | 500 | 500, backing off to 2000 | 2000 | `preview`: 16 per view, 64 in all |
| `dependent` | Markdown preview images | 75 / 25 / 5000 | 250 | – | – | – | `dependent`: 8 per owner group, 32 in all |
| `comments` | Comment watches | 75 / 25 / 5000 | 250 | 500 | 500, backing off to 2000 | – | `comments`: 64 |

Every profile retries a failed read three times, after 100, 300 and 900 ms. Only the editor pauses a subscription around its own save, for at most 10 s. `FRESHNESS_LIMITS` in the same file holds the limits that do not vary by profile: a 100 ms atomic-save window, a waitlist of 200 per bucket, no hashing above 16 MiB, 256 cached hashes, a 10 MiB editor text limit, a 2 s ready timeout and a 2 s health round.

**Total delay.** For an editor or image tab the wait before a write shows is the 75 ms gate plus up to one 25 ms poll, then the IPC hop, the read and the render – expected 130–200 ms at the median, asserted at p50 ≤ 250 ms and p95 ≤ 400 ms (`e2e/file-freshness-latency.timing.e2e.ts`, Windows, run locally). The throttle is leading plus trailing: the first change of a burst is read at once, and during a burst the tab moves at most every 250 ms and always ends on the last version. The HTML preview is the 50 ms gate plus its 30 ms coalesce; its reference speed is kept.

**Reads settle first.** A read that is not the immediate answer to a change event waits until two probes one settle apart show the same size and modified time, then reads and checks the file did not move meanwhile – during the read, and between the last probe and the read (`busy` reschedules and is not a failed read). The immediate answer to a change reads at once, but only keeps what it read if the file is still at the stamp main's write gate saw the writes settle at (sent with the change); otherwise it settles too, so a new writer that started before the change reached the tab is never shown half-written. That covers the catch-up after a subscribe, the safety net, a file coming back, and a change the write gate released at its 5 s cap (marked forced). The wait is capped at the same 5 s: a file that has not held still by then is not read, and the attempt counts as a failed read, retried after 100, 300 and 900 ms with a fresh settle each time (`settleRead.ts`). So a writer that streams for longer than 5 s still ends with the complete text on screen once it stops, and never a partial one. A file that never holds still – or a path main cannot resolve, such as a dead network share – shows "cannot be read right now" after about 21 s, until a later change or check finds it still.

**Safety net.** `tracker.check` compares the tab with the disk when a tab is shown, when the window gets focus, after a power resume, after a save, and every 2 s while a tab on a network or WSL volume (`liveRefresh: limited`) is visible. It probes against the last stamp (size, modified and change times, file id, and a SHA-256 up to 16 MiB) and does nothing when the content is the same, so showing a tab or focusing the window never reloads it, re-renders it or moves the cursor. A copy that keeps the modified time differs in the hash and is caught. A hidden image tab marks the change as deferred and reads the file when it is shown again.

**Watch ends are always told.** A project switch suspends the watchers just before it commits and ends every old subscription after it; a failed project open resumes them, so the open tabs follow again. A window reload drops that window's subscriptions when the page navigates, so repeated reloads do not use up the cap. After a power resume every watch is re-armed, a health round runs, and every tracker checks. The health round (every 2 s, one `lstat` at a time) compares each watch's file identity with the one it was armed on, because a folder that is deleted and created again can reach the project watcher as a single `change` and leave the single-file watch deaf. A watch that ends for another reason is restarted once by the tracker; if that fails too the tab shows the stopped notice.

**Notices.** A panel shows one notice, by priority: deleted, conflict, content unavailable, watch stopped, watch queued, limited. `selectNotice` (`components/FileConflictNotification/freshnessNoticeCopy.ts`) holds every sentence.

| State | Text (the file name is filled in) | Buttons | Editor |
|---|---|---|---|
| Deleted | "… was deleted, renamed or moved on disk." | **Restore file** (editor), **Close tab** | stays editable; Save restores |
| Conflict | "… changed on disk." or, after an autosave was given up, "Not saved – … changed on disk since it was last read." | **Reload from Disk**, **Keep My Version**, Dismiss (icon button, same as Keep My Version) | stays editable |
| Too large | "… is too large to show here (size; limit 10 MB)." plus the last-good-read sentence; the image viewer says 50 MB | **Reload** | read-only, autosave off |
| Binary, UTF-16/32 | "… no longer contains text Erfana can show." / "… now uses a text encoding Erfana cannot show (UTF-16 or UTF-32)." | none – the next write is picked up | read-only, autosave off |
| Unreadable | "… cannot be read right now (it may be locked or access is denied)." | **Reload** | read-only, autosave off |
| Stopped | "Auto-refresh stopped for …. Changes on disk no longer show here." (or "… can no longer be followed: it now resolves outside the project." / "… it is not a regular file.") | **Reload** | stays editable |
| Queued | "Too many files are open to follow this one live. It updates when you switch to it, and follows live again when a slot frees." | none | stays editable |
| Limited | "Live refresh is limited for files on network drives and WSL. Erfana checks for changes when you switch to this tab or window." | Dismiss (hides it for this tab) | stays editable |

A stopped notice for a project that is closing is not shown. The panel's single `role="status"` region announces a notice only while the panel is the active tab. When a notice closes, focus is not returned to the editor or image viewer (known gap F36, [technical debt #72](../technical-debt.md#72-known-limits-and-accepted-trade-offs-from-478-2026-11)).

**How to add a tab type.**

1. Write an adapter that gives the tracker an update rule: `read` (returns a version and its stamp), `readNow` (false while the tab is hidden), `apply` (`applied` or `held`) and `onState`. In the renderer build the tracker with `useFreshness`; in main use `createTrackedFileWatch` (`src/main/services/freshness/mainTrackedWatch.ts`) on a source from `createMainFreshnessSource`.
2. Pick an existing profile in `TIMING_PROFILES`, or add one (its bucket decides the cap). Never put a timing number in the adapter.
3. A read-only adapter must not import `saveAddOn` or `PausableSource`; an import test fails when it does.
4. Show the tab's state through `selectNotice` and `FreshnessNotice`, so the priority, the wording and the status region stay the same.
5. Add one short test file that calls `describeFreshnessContract` with a harness for the adapter (`src/shared/freshness/__test__/freshnessContract.ts`). A scenario the adapter cannot meet is skipped in the harness with a reason. No change to the core is needed.

### Own saves (#478)

The editor's save goes through the save add-on (`src/shared/freshness/saveAddOn.ts`), so the tab's own write is never taken for an outside change and an outside change during the save is never lost:

1. **The pause belongs to the save** – the tab pauses only its own subscription (`file-watch:pauseWatch`, by `watchId`) around the write; another tab on the same file keeps hearing changes (L5), and a pause a dropped page never released ends by itself (G2)
2. **Own-save identity is the written stamp** – main answers the write with the stamp it wrote, and the tracker adopts it, so the echo of that write is silent; the text is never compared, so an outside revert to text the tab saved earlier is shown (L3). Only an autosave sends `expectedStamp`, and never in the deleted state: if the file changed since the tab last read it, main writes nothing and the conflict bar says "Not saved – … changed on disk since it was last read." (F16)
3. **`hasLocalChangesRef`** – the editor's update rule reads the tab's edited flag through a ref (no stale closures); an edited tab holds a change as the conflict instead of taking it, and a keystroke during the read counts as an edit

After the write the subscription resumes; a change it missed while paused is checked at once (L1). A change that arrives during a save is delivered after it, never dropped; if another check is running when the save's check arrives, it runs once more afterwards.

**Where main checks the disk.** An autosave's `file-watch:writeText` carries the stamp the tab last read. Main compares the file's stat with it (an exact match is "unchanged", no hashing; only a mismatch hashes and compares content, so a touch-only write is not a conflict) right before the rename, again before each rename retry, and before an in-place write (symlink, hard link, read-only or foreign-owned file, or the fallback after a failed rename). When the file changed, nothing is written and the tab shows the "Not saved" conflict.

**Known limits** ([ADR 0013](../adrs/0013-one-freshness-capability.md)):

- **No file lock.** An outside write that lands in the gap of one `lstat` plus one `rename` after the last check is overwritten by the autosave. The check is repeated before every retry and in-place write to keep the gap to two system calls.
- **The stat after the rename.** The stamp returned for a save is taken from the final path after the commit, plus the hash of the bytes written. A write that lands between the rename and that `stat` is not taken for the tab's own: the check after every save hashes the real file, finds a hash that differs from the one written, and shows the change. Editor files are at most 10 MiB, so they are always hashed.
- **The atomic-save re-arm reads without the write-finish wait** (see the Use Cases table above).

The `MarkdownEditorPanel` coordinates via:
- Reading content from Monaco editor model (not React state) to avoid stale closure overwrites
- Calling `watch.save({ content, trigger, generation })`, which runs the save add-on above
- Post-save dirty re-detection: checks if Monaco buffer diverged from saved content during the save, re-marks as modified if so
- The editor is uncontrolled (`MonacoMarkdownEditor` mounts with `defaultValue`, never `value`): it owns its buffer, and a new `content` reaches it only as an outside change – a reload, an accepted external change, the conflict bar's "Reload from Disk". `utils/monacoValueSync.ts` tells those apart from the editor's own `onChange` echo (which can lag the buffer by a few keys under load and must never be written back) and applies them as one minimal `pushEditOperations` edit, so the cursor and the undo stack survive and no `onChange` fires. Taking the disk's text also clears the tab's dirty dot (`setEditorDirty(panelId, false)` in `handleContentUpdateFromWatcher`)
- **Undo after "Reload from Disk" brings the discarded edit back.** The reload is its own undo step, so Cmd+Z right after it restores the local text the user chose to discard – the same as a revert in VS Code. That undo is an ordinary user edit: the tab turns dirty again and autosave writes the restored text over the reloaded file about two seconds later
- Save by panel id (#124): the panel registers its save, its conflict flag and an autosave hold in `services/editorSaveRegistry.ts` through `useEditorSaveRegistration`, so the HTML preview's tab move can save another tab when the user answers Save in the unsaved-changes prompt. The save is the panel's own `handleSave`, so every guard above still applies. While the prompt is open the move holds the tab's autosave (`cancelAutoSave`, re-armed by `signalChange` on release). It fails safe: a panel id with no entry, or a save that throws, answers `false`, and the move is abandoned with the edits kept in their tab

### Conflict Resolution UI

When a file has both external changes and unsaved local changes, an orange conflict bar appears with three options:

- **Reload from Disk**: Discard local changes, load external version
- **Keep My Version**: Ignore external changes, keep local edits
- **Dismiss**: Works exactly like **Keep My Version** – the bar goes away and autosave writes the local text over the outside change about 2 seconds later. It does **not** postpone the decision. Its accessible name says so: "Dismiss – keeps your version" (owner decision, #478 N6)

The conflict bar is the `conflict` entry of the panel's one freshness notice (`selectNotice`). Its buttons call the adapter's `reloadFromDisk`, `keepLocal` and `dismissConflict` (Dismiss is exactly Keep My Version), each wrapped by `FreshnessNotice` so a click event is never passed on as an argument. Reload from Disk discards the buffer for the disk's text; the panel keeps the cursor and scroll (F15).

---

## Single-file watch internals (#70)

Issue #70 (a preview tab showing stale content forever) turned out to be three
independent defects. Two of them were in this service and therefore affected the
Markdown editor as well; the third was renderer-side.

### Atomic-save detection and watcher re-arm

A chokidar single-file watch is bound to the **inode** it opened. The dominant
agent / design-tool write pattern is *write a temp file, rename it over the
target*, which destroys that inode. Where the platform reports the rename as an
`unlink`, the old behaviour reported a delete, closed the watcher and
dropped the map entry — so every later edit was invisible until the tab was
closed and reopened.

`FileWatcherService` runs one service-level `AtomicSaveDetector` (it already
keys pending deletes by path, and this service is 1 watcher : 1 path, so a
per-file detector would be a `Map` with one entry × 100 watches). The branch that
follows the detector's verdict lives in `watcher/atomicRearm.ts`; the re-arm itself is `armWatch`:

| Verdict | Behaviour |
|---|---|
| File is back within the 100 ms window | `armWatch` closes the stale watcher, re-checks confinement and creates a replacement through `createSingleFileWatcher`; the existing entry is updated in place, then a plain `changed` is emitted at once – **without** the write-finish wait (see the known limit in the table above) |
| File still gone (one final `stat` confirms) | `deleted` to every subscription on the file, close, drop the entry |
| Session token bumped inside the window | `ended` (`project-switch`), then drop — never a silent drop |
| Path no longer resolves inside the project | `ended` (`outside-project`), then drop |
| `chokidar.watch()` throws on the replacement | `ended` (`watcher-error`), then drop |
| The watch is stopped, replaced or the service disposed while a check waits on the disk (on Windows the check can wait 250 ms for a second look) | Nothing. The detector keeps each pending check until its verdict is delivered, so `cancelPending`, `stopAll` and `dispose` also stop one already running, and the re-arm re-checks that its entry is still the watched one. A late verdict never reaches, re-arms or drops a newer watch on the same path (#252) |
| Path vanishes between the existence check and `chokidar.watch()` | `deleted` + drop, so no zombie entry holds a watch slot |

Three design points that are easy to undo by accident:

- The re-arm goes through the service's change path (`emitChange`), never straight to
  the window, so each subscription's pause and the per-subscription delivery still
  apply. That path does **not** run the write-finish wait: a re-arm change is plain,
  not forced, and the tab reads it at once. Only a read that finds the file moving
  settles first. The cost of this choice is the known limit in the Use Cases table
  above (`rm x.md && <slow write> x.md` can show a partial file for a moment),
  accepted in [ADR 0013](../adrs/0013-one-freshness-capability.md).
- The record is updated **in place**, so subscriptions, their pauses and the map size
  survive. A re-arm can therefore never trip a bucket cap.
- The path is re-checked for project confinement at every arm, by `armWatch`:
  `realpath`, then the inside-the-project test, then "a regular file". The entry
  check ran before somebody else replaced the file, so an in-project name can be a
  symlink out of the project by the time the replacement lands. A link to another
  in-project file passes and keeps following.

**Platform split — measured, not assumed.** On **macOS** an older chokidar
(version 3, with fsevents) reported `mv tmp target` over a watched path as
**`change`**, not `unlink`, and the watch kept working afterwards. That was
measured then; chokidar 5 runs a macOS single-file watch on `fs.watch`, so the
answer may differ – the test below asserts the
disjunction either way. The re-arm
branch may therefore never fire on macOS, and the ordinary change path
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

### Subscriptions (#478)

Each consumer subscribes with a `watchId` of its own (`watcher/watchSubscriptions.ts`), owned by its window or by an in-process owner. One chokidar watch serves every subscription on a file, and it closes when the last subscription on it goes; a window that closes or reloads drops all of its subscriptions together (`cleanupForWebContentsId`). Events go per subscription, so two tabs on one file each hear a change, and one tab's pause or release never touches another's.

A join must never fail on the cap: an entry it joins is already counted. That is why the bucket check is
told whether a subscribe joins a file that is already watched: a join takes no
slot, so the cap never refuses it. A subscribe past the cap is `queued` (a waitlist of up to 200) and gets `started` when a slot frees; past the waitlist it is refused with `WATCH_FAILED`.

### Released around a project-tree delete (#486)

On Windows a handle anywhere **below** a folder blocks renaming it, and the Recycle Bin moves a folder by renaming it (so does the in-use probe, `services/file/entryProbe.ts`). Erfana holds such handles itself: a single-file watch (libuv watches a file through its folder) and the native directory watcher's handles on a split folder's children (a folder that holds a hidden, ignored or excluded subfolder). A watcher pause closes none of them. So `file:deleteFile` / `file:deleteFolder` run the trash, the probe and the permanent removal inside `releasingWatches` (`services/file/releaseWatchesAround.ts`), after the confinement and `FileService` checks pass:

- **Release.** `FileWatcherService.releaseUnder(realPath)` (`watcher/watchReleases.ts`) closes the watcher of every entry at or below the path – the path itself too, so a file's own watch – matched as entries are keyed: real paths under the session's case rule (`C:\Proj\A` covers `c:\proj\a\x.md` on Windows). The entries and subscriptions stay, suspended as for a project switch, so nothing reaches a tab meanwhile. `DirectoryWatcherService.releaseUnder(realPath)` closes the native handles strictly below the folder (`watcher/releasableWatchHandles.ts`, the native watcher's `fsWatch`); the folder's own handle stays, so its removal is still heard.
- **Re-arm**, after the removal succeeded or failed. Each held entry goes through `armWatch` again: a file still there gets `restarted` (the tracker's catch-up check – it shows a change only if the disk differs); a file gone takes the genuine-delete branch (`atomicRearm.endUnarmed`: `deleted`, the watch dropped), so the tab shows the deleted notice with Restore file and Close tab, and follows the file again if it comes back. A directory handle whose folder is gone stays closed quietly – its removal reaches the watcher through the folder above, never as an error; one still there is opened again and reported as lost events (a `null` file name), so the watcher re-lists or resyncs what it may have missed.
- **Concurrency.** Releases nest: an entry is held while any delete covers it and re-armed when the last one ends. A subscribe for a file under a release waits for it (at most 30 s) before it resolves and stamps the file, and an entry created under a release is held from the start, so no handle opens mid-delete. A window closed meanwhile drops its subscriptions as usual and nothing is re-armed for it; a project switch that is suspending takes over the held entries. A failed project switch's resume skips entries a delete still holds; the release re-arms them when it ends.
- **Time box.** Each release and each re-arm has 2 s (`WATCH_RELEASE_TIMEOUT_MS`): a release that does not answer does not hold the delete up (its re-arm runs once it answers), and a slow re-arm goes on in the background; closing each watcher is itself bounded (`HOLD_TIMEOUT_MS`, 1 s), so a close that never settles cannot keep a release active. Log lines carry `redactPath` / `redactedLogError` only.

Only handles **other programs** hold – a terminal whose working folder is inside, an editor with a file open – still answer `IN_USE`. Not covered: the chokidar backend (Linux, where such handles do not block a rename, and the `ERFANA_DIRECTORY_WATCHER=chokidar` support override on Windows). The e2e trash stub removes with `rm`, which these handles do not block, so it records how many were open under each entry when it was asked (`handlesAtTrash`); `releaseWatchesAround.win32.test.ts` proves the move with real handles.

### Renderer side: one tracker per tab

- **`hooks/useFreshness.ts`** – builds the tab's `FreshnessTracker` once the
  first read is in (`ready`, with that read's stamp as the baseline, so a write
  before the watch was live is caught up – G3), registers it for window focus
  and power-resume checks, and disposes it with the tab. The state it returns,
  `{ watch, content }`, is what every notice reads.
- **`hooks/useFileWatcher.ts`** and **`hooks/useFileChangeSubscription.ts`** –
  the editor's and the image viewer's update rules: how to read, whether to read
  now (a hidden image tab marks the change and reads when shown), and what to do
  with what was read. The image adapter never pauses: a viewer never saves.
- A refused subscribe is the stopped notice, never the watch-limit one: only a
  `queued` tab shows the watch-limit notice, so the UI never tells a user to
  close tabs for an unrelated fault.

---

## DirectoryWatcherService (Directory Watching)

Monitors entire project folder for structural changes (files/folders created, deleted, moved) **and** in-place content modifications (chokidar `change` events from `fs.writeFile` truncate-in-place, added in #241).

### Architecture

- **Backend**: chokidar 5.0.0 on Linux; one `NativeRecursiveWatcher` per project on Windows (#211) and macOS – see [Watch backends](#watch-backends-211)
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
- **ignored** – `/` + the relative path contains `/` + a `watcher.ignoreList` entry (default `DEFAULT_WATCHER_IGNORE_PATTERNS` in `src/shared/constants.ts`). The tree still shows it; neither backend watches it. A folder that matches an entry on whole segments (`dist`, `src/dist`, `.yarn/cache` – not `outline` for `out`) is a **lazy** row: the walk does not read it, and the tree reads one level of it when it is expanded (see [the lazy tree walk note](../performance/2026-10-22-lazy-tree-walk.md));
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

**Filter order.** On chokidar the drop test is the function-based `ignored` option, so a dropped folder is never scanned. On the native backend (Windows, macOS) it runs in the native watcher's callback before any `lstat`. Both backends then pass through the same backstop in `DirectoryWatcherService.queueEvent`, right after the session guard and **before** pause accounting and metrics: a dropped path is never counted as a missed change while paused, never counted as received (`eventsFiltered` counts it instead), and never broadcast. A burst of only dropped paths therefore sends nothing to the renderer, so it starts neither a tree re-read nor a git refresh.

`setPathFilter(filter)` replaces the filter; `ProjectService` builds a fresh one on every project open and hands the **same** instance to `FileService` and `DirectoryWatcherService`. Until then the default hidden and ignore lists apply, with no exclude list.

### Watch Depth (Performance)

The directory watcher supports an optional recursive depth cap to reduce load on very large projects.

- Config key: `directoryWatchDepth` (SettingsService)
- No UI control at the moment. Configure via preload settings API, e.g. in DevTools:
  - `await window.api.settings.setDirectoryWatchDepth(2)`
  - `await window.api.settings.setDirectoryWatchDepth(null)` for Unlimited
- Behavior: on chokidar it is the `depth` option. On the native backend (Windows, macOS) the handles stay recursive and deeper events are dropped by the filter, with chokidar's rule (a path of *n* segments is dropped when *n* − 1 > depth). The watcher uses the new setting on the next start

Recommended:
- Start with "Unlimited"
- Use smaller depths when the tree is very large and deep

### Watch backends (#211)

`selectDirectoryWatchBackend(platform, env)` (`src/main/services/watcher/directoryWatchBackend.ts`) picks the backend: `native-recursive` on `win32` and `darwin`, `chokidar` on Linux. `DirectoryWatcherService` reads it once, in its constructor (the optional `{ backend }` option overrides it, which the native wiring suite uses), and logs `Directory watcher backend selected` at the first watch. Both backends satisfy the same `DirectoryWatchHandle` seam (`on(...)`, `close(): Promise<void>`), so everything after the watcher – `queueEvent`, the throttle, the coalescer, pause, catch-up – is shared.

**Escape hatch.** `ERFANA_DIRECTORY_WATCHER=chokidar` in the environment Erfana starts with forces chokidar on every platform. It exists for support and diagnosis only: there is no setting and no UI. Only that exact value counts; any other non-empty value is ignored and logged as `Directory watcher override ignored: unknown value` (the value itself is not logged).

**Why Windows changed.** chokidar 3 on Windows opens one `fs.watch` handle per folder and scans the whole project while the first tree read runs. On a project of about 222,000 entries that meant tens of thousands of handles, and the scan competed with the tree walk for libuv's four-thread pool. The native backend holds a small, bounded set of handles instead, and none at all for excluded, hidden or ignored folders it knows about.

**Why macOS changed.** chokidar 4+ dropped FSEvents and opens one file descriptor per watched file, which on a large project exhausts the FD table and breaks child-process spawns such as PDF export's render window. Node's recursive `fs.watch` is served by FSEvents on macOS (~0 FDs per file), so the project watcher uses the native backend there too, with the same plan below. **Not yet verified on a real Mac:** macOS behaviour is covered by unit tests with a fake file system and the Linux CI run only.

**Path rules per platform.** `NativeRecursiveWatcher` takes a `platform` option (default `process.platform`). On `win32` a backslash in a reported name is a separator and a `\\?\` / `\\?\UNC\` prefix is stripped; elsewhere only `/` separates and a backslash is an ordinary file-name character.

**The Windows plan** (`src/main/services/watcher/NativeRecursiveWatcher.ts`):

- The root is watched **non-recursively**. Every direct child folder of a *split folder* gets **one recursive** watch, unless it is itself a split folder, where the rule repeats one level down. A dropped child gets no handle at all, so its churn never fills a Windows change buffer.
- *Split folders* are the root plus every ancestor of a *split path*. Split paths are the **path entries** of the exclude list (`filter.splitPaths()`) and the **walk hints**: the dropped folders at two or more segments deep that the last completed root tree walk met – `packages/a/node_modules`, `src/dist`, `a/b/test-tmp` from `**/test-tmp`. The walk visits every folder anyway, so a hint costs no I/O. Hints are read when the watcher plans (start or restart).
- **Caps:** 64 path-entry split paths and 64 walk hints, each at most 16 segments deep, and at most **512 handles** per project. Past a cap a folder keeps one recursive watch (its events are still dropped by the filter), and the `Native directory watcher ready` line logs `planCapped: true`. A plan pass opens every direct child before it expands any split one, so the handle cap collapses a deeper folder, never a later sibling. A split folder whose listing fails (other than as gone) also keeps one recursive watch.
- **Links are never watched.** Junctions, directory symlinks and file symlinks are leaves: never split, never given a handle. An entry that `readdir` does not type as a plain file or folder is confirmed with `lstat`.
- Every handle is opened under `fs.realpathSync.native(root)`, never the 8.3 short form, which guards against a libuv 1.52.x abort on a short-name watch. Electron 44 ships libuv 1.52.1, which is affected, so this guard is load-bearing (Electron 39 shipped 1.51.0, which was not). Emitted paths are joined onto the caller's root string.
- Keys are folded to lower case (Windows is case-insensitive), so a case-only rename re-lists a folder instead of opening a second watch.

**Events.** `fs.watch` reports only `rename` or `change` plus a name. A raw event is dropped by the filter first; a surviving one is classified by one `lstat` in `NativeEventClassifier` (at most 2 in flight, a 10,000-path backlog) and emitted as `add`, `addDir`, `unlink`, `unlinkDir` or `change`. A new direct child folder of a split folder is reported (`addDir`) only once its own watch is open. Details, the mapping table and the deleted- and renamed-folder handling: [Technical details § The Windows native watcher](./technical-details.md#the-windows-native-watcher-211).

**Lost events → one debounced re-read.** Windows reports a full change buffer as a `null` filename. On a split folder's own (non-recursive) watch the folder is re-listed and only the differences are emitted. On a recursive watch, or when the classifier backlog trips, the watcher asks for a **resync**, debounced to 1 s of quiet and at most 5 s of waiting, so one burst costs one re-read. `DirectoryWatcherService.handleResync` answers it with one `catchUp: true` refresh – or, while paused, records it as one unknown drop in the pause episode, which the pausing window's next completed read covers (#210). The watch keeps working after an overflow; it is not re-opened.

### The watcher starts after the first tree read (#211)

`useProjectManagement` keeps a `firstReadPending` state, and `initialLoadComplete` – what `useDirectoryWatcher` waits for – is now `projectPath !== null && !firstReadPending`. The `project:changed` listener sets it in the same synchronous block as `setProjectPath`, so the render that remounts the tree never starts a watcher early. It is cleared when that first read settles, **success or failure** (a failed first read can still self-heal through the watcher), when a superseding reload settles, on close, and on main's no-op re-open. Before #211 the flag was `true` from mount, so chokidar's initial scan (or the new backend's plan) competed with the first tree read. Git status still starts at once. Neither the tree read nor git status ever waits for the watcher's `ready`.

**Closing the start gap.** A change made during the first read in a folder the walk has already passed, or before the watcher's plan has opened that folder's watch, is in no tree read and in no event: the watch that would report it did not exist yet. Until 2026-10-27 such a file showed only with the next change or a manual Refresh – collapsing and re-opening its folder served the same listing (design #211 risk R4, seen as the `html-preview-comments` E-004 e2e failure, see the [flake register](../windows/known-flakes.md)). Two fixes close it:

- **A catch-up refresh at `ready`.** When the backend reports `ready` – every watch of the plan is open – `DirectoryWatcherEvents.handleWatchReady` sends one `directory-watch:changed` with `catchUp: true`, so the tree is read once more with the watch in place; while paused it records one unknown drop instead, like a resync. A restart's new watcher ends there too. A `ready` from a watcher that was replaced, or from an earlier session, is ignored. The cost is one extra tree read per watch start.
- **Opening a folder checks it against the disk.** When the user opens one folder (click, key or drag hover), `useExpandReconcile` lists that folder once more – one shallow `file:readDirectory`, one level – and refreshes the whole tree only when the names or kinds on disk differ from what the tree shows. Not for the root row, a lazy folder (read on expand anyway) or several folders opened at once. So collapsing and re-opening a folder is a cheap recovery for any change a watcher missed, not only this one.

### Use Cases

| Scenario | Behavior |
|----------|----------|
| Create file externally | Tree updates automatically, after the 75 ms collection window and the renderer's 250 ms debounce (`DIRECTORY_WATCHER.DEBOUNCE_DELAY`) |
| Delete folder externally | Tree updates, expanded folder state preserved |
| Edit file content (Monaco autosave or external edit) | Git status badge refreshes after autosave settles (~2.5–3 s total) |
| Git checkout (bulk changes) | Debounced to single refresh after changes settle |
| Internal CRUD (create/delete/rename) | Watcher paused, no double refresh |
| Another program (e.g. an agent in the terminal) adds or removes items while an internal CRUD runs | One catch-up refresh at resume; none when nothing outside changed or the operation's own refresh already showed it (#210) |
| Expand folders, make external changes | Folders remain expanded after refresh |
| A file is created right after the project opens, before the watcher is ready | One catch-up refresh when the watch is ready shows it |
| Collapse a folder and open it again | Its listing is checked against the disk; a difference refreshes the tree |
| Very large project keeps changing while the tree is being read | Changes are picked up by one follow-up read after the running one; reads never overlap and the tree never shows an older state (#208) |
| Something keeps writing inside an excluded, hidden or ignored folder | Nothing reaches the renderer: no tree re-read, no git refresh (#211) |
| A burst overflows a Windows change buffer | One debounced catch-up re-read about 1 s after the burst ends, at most every 5 s while it lasts (#211) |
| A file a Markdown preview links to is created, deleted or moved | The preview forgets its remembered link checks and re-checks, so broken-link styling follows. Triggered by an event with any type but `change`, by a `catchUp` event, or – because the watcher is paused for those – by one of Erfana's own file operations, which `fileGateway` reports through `services/fileStructureSignal.ts`. The re-check waits for a burst to settle (400 ms, at most 2 s) and for a hidden tab to be shown; a change no event reports shows up within about 30 s, when the remembered answer expires ([deferred Markdown preview](../performance/deferred-markdown-preview.md)) |

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

- **Service**: `src/main/services/DirectoryWatcherService.ts` – the public lifecycle (`watchDirectory`, `stopAll`, `setPathFilter`, `reportsRemovalsAbove`). Since v0.22.0 it is split into layers, each a class the next one extends (lens review finding [65]); the public API, IPC channels and log lines did not change:
  - `watcher/DirectoryWatcherCore.ts` – shared state, the path rules (`shouldDropRel`) and how a notice reaches the watching windows
  - `watcher/DirectoryWatcherRecovery.ts` – error classification, EMFILE teardown, restarts with back-off (`handleWatcherError`, `scheduleRestart`)
  - `watcher/DirectoryWatcherEvents.ts` – the event pipeline and the pause API (`queueEvent`, `handleResync`, `handleWatchReady`, `pauseWatch`, `resumeWatch`)
  - helpers: `watcher/directoryWatchBuilders.ts` (builds the chokidar or native backend), `watcher/directoryWatchTypes.ts` (shapes and batch rules such as `isStructuralBatch`), `watcher/DirectoryWatchListeners.ts` (removal and coverage listeners, #252)
- **IPC Handlers**: `src/main/ipc/directory-watcher-handlers.ts`
- **Renderer Hook**: `src/renderer/src/hooks/useDirectoryWatcher.ts` (lifecycle, event handling, AC-010 guard)
- **Pure Logic**: `src/renderer/src/hooks/useDirectoryWatcher.logic.ts` (state guards, message creation)
- **Pause Utility**: `src/renderer/src/components/ProjectTree/withWatcherPause.ts` (pause/resume wrapper)
- **Folder check on open**: `src/renderer/src/components/ProjectTree/useExpandReconcile.ts` (one shallow read of the folder the user opens; a difference refreshes the tree), called from `useLazyFolderChildren`
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

**Implementation:** `watcher/DirectoryWatcherRecovery.ts` (the restart layer of `DirectoryWatcherService`), `WatcherMetrics.ts`, `RateLimitedLogger.ts`

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

`cleanupForWebContentsId(id)` is called from `webContents.on('destroyed')` in `index.ts` to prevent stale git watchers from accumulating after a window closes. A reload keeps the same `webContents`, so this cleanup does not run then; the `did-navigate` hooks in `index.ts` end the page's file watches (#478) and close its open project (#485, `projectOwnerLifecycle.ts`) instead. Neither hook stops the git watcher: it runs on until the next `git-watcher:start` (the next project open) replaces it.

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
- 4 coalescing rules, plus cascade prevention (a deleted folder drops its children's events):
  - CREATE + DELETE → ∅ (cancel out)
  - DELETE + CREATE → CHANGE
  - CREATE + CHANGE → CREATE only
  - Multiple CHANGEs → single CHANGE
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
- Platform-specific settings (`getPlatformConfig()`): case sensitivity (Linux sensitive, macOS and Windows not), platform excludes, recommended buffer and chunk sizes
- Also exports `isWindowsLongPath`; the case rule is read by `FileService`, `ProjectService` and `DirectoryWatcherCore`

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
- Window visibility gating tests in `src/renderer/src/hooks/useGitStatus.test.ts` – 5 of the file's 39 tests (counted 2026-10-25) cover the visibility-gating case (#102)
  - AC-012: git status refreshes dropped while hidden, single catch-up on restore, cooldown respected
- Event buffer overflow tests in `src/main/services/watcher/ThrottledWorker.test.ts` (24 tests, #102 + #173)
  - AC-017: 30,000-event cap, FIFO eviction, no crash/hang, post-burst recovery
  - Offset-deque coverage: 60 k-event stress burst runs in <1 s cross-platform after the refactor
- 016-NFR-001 main-process latency integration tests in `DirectoryWatcherService.pipeline.test.ts`
  - Isolates chokidar + Defender noise via fake timers; asserts <200 ms virtual latency for single add + atomic-save flows
- Hook tests in `src/renderer/src/hooks/useDirectoryWatcher.test.ts`
- Pause/resume tests in `src/renderer/src/components/ProjectTree/withWatcherPause.test.ts` (18 tests)
- Project switching tests in `src/main/services/ProjectService.switching.test.ts` (#101)
  - Session token guards, step ordering, in-flight event handling during project switches
- Renderer switching tests in `src/renderer/src/components/ProjectTree/ProjectTree.switching.test.tsx` (11 tests, #101)
  - Tree clearing, new project loading, stale event rejection, git status updates
- Exclude list, path filter, Windows backend and watcher gate (#211): see [Patterns & Testing § Large projects on Windows](./patterns-and-testing.md#large-projects-on-windows-211)

---

## Symlinks

- Watchers do not follow symlinks (security)
- **The Windows directory watcher never opens a handle on a link** (#211): junctions, directory symlinks and file symlinks are leaves in its plan, and a recursive `fs.watch` does not report inside them (measured in the [W0 spike](../spikes/211-windows-fs-watch.md))
- **Single-file watches set `followSymlinks: false` explicitly** (`watcher/singleFileWatch.ts`, added in #70). chokidar (5.0.0 included) defaults this to `true`, so a link planted inside the project would otherwise make the watcher — and the automatic re-read behind it — track an out-of-project target
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

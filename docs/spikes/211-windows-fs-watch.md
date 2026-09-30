<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Spike: how `fs.watch` behaves on this Windows host (#211, W0)

- **Issue:** [#211](https://github.com/qodeca/erfana/issues/211). **Design:** [D0 and W0](../designs/211-large-project-windows-watcher.md#3-decisions).
- **Date:** 2026-09-29. **Host:** Windows 11 Pro 10.0.26200, NTFS, Developer Mode on, 8.3 names on for the temp volume.
- **Method:** throwaway scripts (not committed) under Electron's own Node (`ELECTRON_RUN_AS_NODE=1`) and plain Node, in fresh folders under the OS temp folder (`<tmp>` below), removed afterwards. Risky watches ran in child processes.

## The answer

`fs.watch` with `recursive: true` is **viable**, but the deleted-folder case is not what D15 expects: a deleted watched folder is reported as an absolute `\\?\…` path **in a tight loop that pins one core until the handle is closed**, and the folder is already gone (`ENOENT`, not `EPERM`). Overflow is as frequent as D1 predicts and always arrives as a single `null` filename per lost batch. The 8.3 abort does not happen with Electron 39's libuv. Links are leaves and are not watched through.

## Runtimes

| Runtime | `process.versions.node` | `process.versions.uv` |
|---|---|---|
| Electron 39.8.10 (`ELECTRON_RUN_AS_NODE=1`) | 22.22.1 | **1.51.0** |
| Plain Node (comparison only) | 24.21.0 | 1.52.1 |

Every result below was the same under both runtimes unless stated.

## Deleted watched folder

Cases: a recursive watch on `child` (with a non-recursive watch on its parent, as in the D1 plan), and a recursive and a non-recursive watch on the root. Each deleted in-process (`fs.rmSync`) and from another process (`rd /s /q`) – no difference.

| Question | Observed |
|---|---|
| Event on the deleted folder's own handle | `rename` with an **absolute** filename, Node's namespaced form of the watched path: `\\?\<tmp>\<root>\child`. Never the basename, never an `error` event, never `EPERM`. |
| How often | Repeats until the handle is closed: first one within 1 ms, then about **65,000–72,000 per second**, **100 % of one core** on the main thread (142,180 events in 2 s). Re-creating the folder does not stop it. |
| Why (libuv 1.51 `src/win/fs-event.c`) | The self-event is emitted only when `ReadDirectoryChangesW` fails with access denied **and** the handle's directory is `DeletePending`; libuv then re-arms, which fails again at once. So a self-event always means the watched folder was deleted. |
| Parent's non-recursive watch | Ordinary `rename child` (basename), plus `change child`. |
| Children's removals before the self-event | Only partly reported (for example `a.txt` but not `sub\b.txt`). |
| `lstat` of the folder while the handle is open | `ENOENT` at once – Windows removes the name immediately. |
| Parent removable while the handle is open | Yes (`rmdirSync` of the holder succeeded). |
| Same name re-creatable while the handle is open | Yes. The old handle does **not** report changes in the new folder (a file written there was never seen). |
| After `close()` | No further events (0 in 500 ms); folder gone or re-created as the test left it. |
| Today's chokidar 3.6.0, same delete | 18 self-events, then chokidar closes the handle; 2 % CPU. The loop is a risk of the new backend only. |

## Renamed watched folder

Renaming a watched top-level folder (`fs.renameSync` and `move`) **succeeds**. The parent's watch reports `rename child` and `rename child-renamed`. The child's own handle emits no self-event and **follows the moved folder**: a file written in `child-renamed` is reported on the old handle as plain `after.txt`, which the watcher would join onto the old path.

## Overflow per burst size

Recursive watch on a folder; N files created in `pkg\b-…\` (relative names of about 40 characters). Each created file gives about 3 raw events. "Busy" means the main thread is blocked for the whole burst; three runs each under Electron, one under Node (same pattern).

| Files in burst | In-process writes (busy) | Other process, main thread busy | Other process, main thread idle |
|---|---|---|---|
| 10 | 0 overflows, 10/10 names | 0, 10/10 | 0, 10/10 |
| 20 | 0, 20/20 | **1 overflow, 1/20 names** | 0 (one run: 1, 3/20) |
| 50 | 1, 1/50 | 1, 1/50 | 1, 14–16/50 |
| 200 | 1, 1/200 | 1, 1/200 | 2–6, 32–43/200 |
| 500 | 1, 1/500 | 1, 1/500 | 6–9, 78–87/500 |
| 1,000 | 1, 1/1,000 | 1, 1/1,000 | 11–18, 153–173/1,000 |
| 5,000 (about 2–2.5 s) | 1, 1/5,000 | 1, 1/5,000 | 63–123, 707–841/5,000 |

- The 4 KB buffer holds roughly 40–45 notifications of this length: a busy main thread loses a burst of **20 files or more** entirely, reported as **exactly one** `null` filename.
- With the main thread idle, `null`s scale with the burst (about 1 per 40–80 files) and 15–35 % of names still arrive, interleaved.
- The watch keeps working after an overflow (a later file was reported normally).

## 8.3 short names

A folder `A Long Folder Name For Spike` under `<tmp>` has the short form `<tmp>\ERF211~3\ALONGF~1`.

- Recursive and non-recursive watches on the short path, run in a child process with creates, a rename and deletes inside: **exit code 0 under both runtimes**, events reported with long relative names.
- The abort is a libuv 1.52.0–1.52.x regression ([libuv#5152](https://github.com/libuv/libuv/pull/5152), fixed in 1.53.0 and cherry-picked into Node 24.21.0). Electron 39's libuv 1.51.0 predates it, so it is not live in the shipped app; a later Electron on Node 24.16–24.20 would carry it.
- `fs.realpathSync.native(short)` returns the long form. `fs.realpathSync(short)` (JavaScript) and `path.resolve` keep the short form.

## Links in `readdir`

| Entry | `Dirent` (`withFileTypes`) | `lstat` |
|---|---|---|
| Junction (`fs.symlinkSync(…, 'junction')` and `mklink /J`) | `isSymbolicLink()` only | `isSymbolicLink()` only |
| Directory symlink (`'dir'`) | `isSymbolicLink()` only | `isSymbolicLink()` only |
| File symlink (`'file'`) | `isSymbolicLink()` only | `isSymbolicLink()` only |

Symlinks were created without elevation because Developer Mode is on; without it `'dir'` and `'file'` links need an elevated process (not tested here). A recursive watch on the parent reported **nothing** for files written inside the junction's target, either directly or through the junction path.

## Verdict for W11–W13

**Proceed with `fs.watch` recursive; `@parcel/watcher` is not needed on this evidence.** Ordinary bursts overflow, as R3 expects, but each lost batch is one `null` that the D3 debounce turns into one resync (a burst of 5,000 idle-thread files gave 63–123 `null`s in 2.5 s, so 1 s quiet / 5 s maximum wait holds). Churn in excluded folders never reaches a handle under the split plan, so AC3 is not at risk from overflow.

Two contradictions must be fixed in the design before W12:

1. **D15** says *"Either one → `lstat` the watched folder itself. A readable directory → … a self-event means an AV lock, not a delete, so the watch stays."* Observed: a self-event only fires for a delete-pending folder, it repeats about 70,000 times per second until the handle closes, and a readable directory at that path is a **new** folder the old handle cannot see. So: compare after stripping the `\\?\` prefix (`\\?\UNC\` → `\\`); on the first self-event **close the handle synchronously inside the callback**, before any `lstat`; then run the re-check (readable directory → re-open and resync, otherwise gone). Never keep the watch.
2. **D15 / the D2 `EPERM` row** assume a deleted watched folder stays delete-pending (`lstat` `EPERM`) and blocks its parent. On this host it is `ENOENT` at once, the parent is removable and the name re-creatable while the handle is open. Keep the `EPERM` handling as a defensive path (other file systems or Windows versions – not tested), but W14 should expect `ENOENT`.

Notes for W12, not contradictions:

- A renamed direct child keeps its handle pointed at the moved folder; close it when the parent's `rename` event classifies the old path as gone (the D2 `ENOENT` row), and drop events from that handle meanwhile.
- Removals inside a deleted watched folder are only partly reported; the one `unlinkDir` (D2) must cover them.
- **A3 holds**: open every handle on `realpathSync.native(root)` – not `realpathSync`, which keeps the short form. The abort is not live on libuv 1.51.0, but the fix costs nothing and guards the next Electron upgrade.
- **D1's link rule holds**: junctions and both symlink kinds are link-typed in `readdir`, and a recursive watch does not cross them.

### Changed

- **Open tabs follow their file on disk, and say so when they cannot.** The Markdown editor, the image
  viewer, the HTML preview, Markdown preview images and the comments drawer now share one way of following a
  file. An outside change shows in about 0.15–0.2 s instead of about 0.7 s, a burst of writes keeps the tab
  moving, and a tab never shows a half-written file. A tab catches up after a failed project open, a window
  reload, a wake from sleep, a deleted and recreated folder, a file opened while an agent writes it, a copy
  that keeps the modified time, and a path spelled with another drive-letter case, an 8.3 name or a junction.
  When Erfana cannot follow a file the tab shows a notice: "Auto-refresh stopped" with **Reload**, a watch
  limit, limited live refresh on network drives and WSL, or a file it cannot show (over 10 MB, binary,
  UTF-16 or UTF-32, locked), which makes the editor read-only. Autosave checks the file on disk first and
  shows "Not saved" instead of overwriting a newer file. (#478)
- **Dismiss on the "changed on disk" bar is Keep My Version.** It always was: autosave writes your text over the
  disk change about 2 seconds later. The guide now says so, and the button's accessible name reads
  "Dismiss – keeps your version". (#478)
- **Delete in the project tree moves the item to the Recycle Bin / Trash.** Files and folders deleted from the
  tree (menu or Delete key) can be restored from there. When the trash cannot take a free item – a network drive,
  a WSL path, no trash – a second question offers **Delete permanently**, and its button ignores clicks for half a
  second so a double-click cannot answer it. An item in use – open in another program, or a folder a terminal is
  working in – shows an error asking to close it and is never offered for permanent delete; a permanent delete
  checks for this first, so a lock cannot leave a folder half-deleted. Erfana's own file watches do not count
  as "in use": a folder with a file open in a tab, or with a hidden subfolder, goes to the Recycle Bin, and the
  open tab shows that its file was deleted, with Restore file and Close tab. (#486)

### Fixed

- **After View › Reload, opening the same project shows its tree again.** A reload now closes the window's open
  project, without a "Project Closed" toast; reopen it from Recent Projects. (#485)

- **A tab no longer stops following its file without a word.** Every case where the watch ended silently now
  restarts it or shows a notice. Known limits are listed in ADR 0013 and technical debt #72: no file lock
  (an outside write in the two system calls between the last check and the save is overwritten), and an
  atomic save is read without the write-finish wait. (#478)

### Internal

- **One shared freshness core.** `src/shared/freshness/` holds the tracker, the save add-on and one table of
  timings (`TIMING_PROFILES`); `FileWatcherService` is the only watch layer, with buckets, owners, a health
  round and a wake re-arm; a contract suite runs against every adapter, and latency gates run in the
  `timing` Playwright project. The old watch slot, subscriber counter, deleted-file probe and legacy watch
  channels are gone. See [ADR 0013](../docs/adrs/0013-one-freshness-capability.md). (#478)
- **`npm run lint` names tracked files missing under `.vale/` or `.codex/`** and prints the `git restore`
  command that brings them back. (#486)
- **markdownlint-cli2 0.24.2**, clearing the dev-only `npm audit` highs. (#487)

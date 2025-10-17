# Quick Checks

Minimal smoke checks to verify Terminal and Watchers without full test runs. Use these to confirm local setup or after changes.

See also: testing/README.md, terminal.md, file-watching.md.

## Terminal

- Availability
  - Renderer DevTools: `await window.api.terminal.isAvailable()`
  - If unavailable, Terminal panel shows "Terminal Not Available" with actions (Recheck, Copy Fix Command)

- CWD correctness
  - Open Terminal panel; run `pwd` (POSIX) or `cd` (cmd) / `(Get-Location).Path` (PowerShell)
  - Should match current project path from `await window.api.file.getProjectPath()`

- Restart behavior
  - Click Restart in panel header; prompt reappears, terminal ID changes, previous activity cleared

## Watchers

- Directory tree auto-refresh
  - Create/delete files/folders externally; tree updates within ~1s; expanded folders preserved

- Bulk changes (git checkout)
  - `git checkout <branch-with-many-changes>`; expect a single refresh post-settle (debounced)

- Project deletion edge case
  - Delete project folder externally; expect error toast, cleared tree, no crash

- Session token guards
  - Start switching projects while inducing external changes; only new project emits updates (late events dropped)

- Quick stats
  - `await window.api.directoryWatch.getStats()` and `await window.api.fileWatch.getStats()` show watcher counts

## File Watcher (open file)

- External change, no local edits → silent reload + brief toolbar message
- External change with unsaved edits → orange conflict bar (Reload / Keep / Dismiss)
- External delete → red warning banner; editor content retained

## Tips

- Use Renderer DevTools for quick API calls (`window.api.*`)
- If terminal rendering seems off, toggle visibility or resize; WebGL falls back to canvas automatically
- For reproducible checks, prefer creating a throwaway file/folder under the project root


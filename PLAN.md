# Project Switching Edge Cases and Improvements

This document captures edge cases and enhancements around opening/switching projects, terminal lifecycle, editor tabs, and filesystem watchers. It expands on each item with context, risks, and proposed actions.

1) Same-path selection nuances
- Context: We currently skip work if the new path equals the old path. Case differences, symlinks, or trailing separators may cause false negatives/positives.
- Risks: Unnecessary reloads or skipped updates when the path differs only in representation.
- Proposal: Compare canonical paths: `realpath` + platform-aware case normalization (on Windows/macOS). Normalize separators and strip trailing slashes before compare.

2) Multi-window broadcasting
- Context: `project:changed` is sent to the first window. Future multi-window support would need all windows notified.
- Risks: Secondary windows remain stale.
- Proposal: Iterate `BrowserWindow.getAllWindows()` and broadcast to each non-destroyed window. Include `windowId` in payload if per-window semantics diverge later.

3) Unsaved editor buffers
- Context: Editor tabs are closed immediately on project switch.
- Risks: Data loss if users have unsaved changes.
- Proposal: Track dirty state per tab (store). On switch: prompt to Save/Discard/Cancel. Implement a cancel path that aborts switching and preserves state.

4) Terminal process safety
- Context: PTY is killed during switch regardless of running jobs.
- Risks: Killing active processes (builds, long-running tasks) without warning.
- Proposal: Detect activity (recent output or running fg process if detectable) and prompt. Optionally allow a grace period or send a termination signal first (e.g., SIGINT), then kill if needed.

5) Terminal panel hidden on switch
- Context: We initialize terminal even if the panel might be hidden.
- Risks: Initialization can race with layout; xterm sizing issues or unnecessary work.
- Proposal: If hidden, defer init until visible using a `ResizeObserver`/visibility flag; store a pending-init token and run `initializeTerminal()` when shown.

6) node-pty unavailable
- Context: node-pty may fail to build (e.g., Python 3.13). We surface errors but can improve UX.
- Risks: Repeated errors on switch; unclear recovery path.
- Proposal: Show a non-intrusive banner explaining unavailability. Debounce re-checks. Offer a “copy command to clipboard” fallback and instructions to fix node-pty (docs link).

7) Directory deleted mid-session
- Context: Directory watcher calls `dispose()` on ENOENT which sets a non-recoverable state.
- Risks: Can’t start new watchers without restarting the app.
- Proposal: Replace `dispose()` on ENOENT with `stopAll()` and a recoverable state. Allow re-watching when a new project is selected.

8) Watcher projectPath after auto-restore
- Context: `getLastProjectPath` currently sets only `FileService` project path.
- Risks: Watcher security checks using `projectPath` may reject valid operations until user opens a folder again.
- Proposal: When restoring last project, also set projectPath on `FileWatcherService` and `DirectoryWatcherService`. Optionally broadcast a synthetic `project:changed` to align UI.

9) Rapid project switches (race conditions)
- Context: Quick successive switches can interleave watchers cleanup, tree reloads, and terminal re-inits.
- Risks: Stale events updating the wrong state or double inits.
- Proposal: Introduce a monotonic “switch version” token. Guard all async steps and events; ignore stale work if token mismatches. Temporarily disable the Open Project action during switching.

10) Large/complex projects (performance)
- Context: Deep trees can be heavy to scan and watch.
- Risks: UI jank; delayed readiness; excessive OS watchers.
- Proposal: Lazy-load directories in the tree; cap initial watch depth; maintain ignored patterns; expose user settings for depth/ignored globs. Consider chunked scanning and batched rendering.

11) Symlinked folders outside project
- Context: Directory watcher disables symlinks; file ops may still touch symlinked targets.
- Risks: Operations escape project boundary; security concerns.
- Proposal: Define a policy: don’t follow symlinks in watchers and flag symlinks in the tree. Optionally allow trusted symlinks via settings with explicit UI indicators.

12) Permission / I/O errors
- Context: Opening network volumes or protected folders can fail mid-ops.
- Risks: Partial initialization; unclear errors.
- Proposal: Harden try/catch around all switch steps; show friendly error toasts; keep previous project active on failure. Provide a troubleshooting link.

13) Editor panel tracking completeness
- Context: We track panel IDs when opened, but panels created outside the tracked path (e.g., future restore) may be missed.
- Risks: Residual tabs after switch.
- Proposal: On clear, iterate all Dockview panels via API and close those with `component === 'editor'` as a fallback; rebuild welcome tab explicitly.

14) Watcher event storms and leakage
- Context: After `stopAll()`, late events may still fire.
- Risks: Stale updates to the UI after switching.
- Proposal: Use the “switch version” token in event handlers to drop events from old sessions. Ensure internal maps are cleared and watchers closed before broadcasting `project:changed`.

15) Terminal cwd correctness
- Context: Shell RCs or login shells can override cwd.
- Risks: Terminal starts in unexpected directory.
- Proposal: After spawn, send an explicit `cd "<projectRoot>"` with proper quoting (Windows vs POSIX) and then `pwd` to confirm. Optionally parse prompt/cwd to verify.

16) Project tree + watcher timing
- Context: Tree refresh and directory watch start can race.
- Risks: Double refresh bursts; flicker.
- Proposal: Start directory watch after initial tree load settles, then rely on watcher updates. Consider throttling refreshes and aggregating events (already debounced).

17) Cancellation path robustness
- Context: If the user cancels the open dialog mid-switch, we must do nothing.
- Risks: Half-switched state.
- Proposal: Ensure we check `result.canceled`/empty `filePaths` early and return; only mutate state after successful selection. Respect the “switch version” token.

18) “Close Project” flow
- Context: No explicit “close” action.
- Risks: Users can’t clear context without opening another project.
- Proposal: Add “Close Project”: stop watchers, clear tabs, kill terminal(s), reset project path and tree, and clear last project in settings. Broadcast `project:changed` with `newPath: null` for completeness.

---

Implementation notes
- All proposals are compatible with the current architecture (Electron main + preload IPC + React renderer with Zustand).
- High-priority candidates: 3 (unsaved buffers), 8 (watcher projectPath on restore), 9/14 (race/event guards), 15 (terminal cwd check), 18 (close project).
- We can execute these incrementally and add targeted tests or manual checklists for each.

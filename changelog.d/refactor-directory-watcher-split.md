### Internal

- **`DirectoryWatcherService.ts` is split into layers and back under the 500-line limit.** The
  1,605-line file is now the public lifecycle (420 lines) on top of three layers in
  `src/main/services/watcher/` – shared state and path rules, error recovery and restarts, and
  the event pipeline with pauses – plus small helpers for building the backend watcher, the
  removal listeners, the health line and error classification. No behaviour change: the public
  API, IPC channels and log lines are unchanged and every watcher test passes untouched. Its
  max-lines baseline entry is removed. (lens review finding [65])

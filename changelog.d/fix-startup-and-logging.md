### Fixed

- **Erfana now opens even when its settings or log files cannot be set up.** Before, a broken
  settings file or log folder could leave a running app with no window and no log. Now the window
  still opens with default settings, a short message explains what happened, and the cause is
  written to `crash.log` in the logs folder. If the settings file could not be read, a copy is kept
  before it is ever replaced.
- **Crashes that used to leave no trace are now recorded.** Unhandled errors in the main process
  are written to the log and to `crash.log` (with file paths and user names removed); the app
  behaves as before.
- **Log files no longer grow without limit.** At most 5 older files are kept per log (was 100,
  up to about 3 GB), old logs are removed oldest-first even when the disk is nearly full, and a
  flood of messages from the app window is capped with a note about what was dropped. Overlong
  messages are shortened, and line breaks and other control characters can no longer fake extra
  log lines.
- **Terminal output and full file paths no longer appear in the logs.** Only the size of terminal
  output and the file or folder name are logged.

### Fixed

- **Two log lines no longer write full folder paths.** A failed save and a folder that disappeared
  while the project tree was read both wrote the full path into the log files. They now write
  `[redacted-path]`, or only the last folder name. The error toast still shows the full path.

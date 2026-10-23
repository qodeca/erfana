### Fixed

- **Video import can download its speech-recognition tools again.** In the installed app, the
  download failed with "Digest method not supported" while checking the signed list of files. The
  check now uses a built-in implementation that works in the app, and it is exactly as strict as
  before.

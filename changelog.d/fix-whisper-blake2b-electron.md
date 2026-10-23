### Fixed

- **Video import can download its speech-recognition tools again.** In the installed app, the
  download failed with "Digest method not supported" while checking the signed list of files. The
  check now uses a bundled implementation that works in the app. Signature parsing is also
  stricter: the full signature, including its comment, must now verify.

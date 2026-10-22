### Security

- **The installed app now checks its own code at start-up.** Erfana's JavaScript ships in a single
  `app.asar` archive that Electron compares with a hash embedded at build time, and the app loads
  only from that archive. Until now the code shipped as plain files that any program running as the
  same user could change without anything noticing. On macOS the hash is sealed by the app's code
  signature. On Windows the check raises the bar and makes tampering visible; what stops a program
  running as the same user from rewriting the app is the per-machine install in this release. Native
  parts (the terminal addon, `ffmpeg`, `ffprobe`, the PDF parser) stay outside the archive and are
  not covered by the check. Cookie encryption stays off, because Erfana keeps no cookies on disk.

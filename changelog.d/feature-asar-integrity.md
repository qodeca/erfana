### Security

- **The installed app now refuses to start if its code has been changed.** Erfana's JavaScript ships
  in a single `app.asar` archive that Electron checks against a hash embedded at build time, and the
  app loads only from that archive. Until now the code shipped as plain files that any program
  running as the same user could edit inside the installed, signed app. Native parts (the terminal
  addon, `ffmpeg`, `ffprobe`, the PDF parser) stay outside the archive and are not covered by the
  check. Cookie encryption stays off, because Erfana keeps no cookies on disk.

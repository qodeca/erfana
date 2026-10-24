### Fixed

- **Local speech-to-text now works on macOS.** Erfana now downloads the rebuilt whisper engine
  (`whisper-build-v1.8.4-erfana2`), which carries everything it needs inside one signed and
  notarized file. The previous build could not start on users' Macs, so local transcription
  failed. After updating, Erfana needs an internet connection once: the first local
  transcription replaces the old engine (on macOS and Windows), and the old build is no longer
  accepted.

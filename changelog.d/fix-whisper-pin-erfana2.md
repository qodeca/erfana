### Fixed

- **Local speech-to-text works again on macOS.** Erfana now downloads the rebuilt whisper engine
  (`whisper-build-v1.8.4-erfana2`), which carries everything it needs inside one signed and
  notarized file. The previous build could not start on users' Macs, so local transcription
  failed. Existing installs replace the old engine automatically the next time you transcribe;
  the Windows engine is refreshed too, and the old build is no longer accepted.

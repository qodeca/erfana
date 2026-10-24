### Internal

- **The macOS whisper build now links its libraries into the binary.** The `Whisper Binaries`
  workflow builds whisper.cpp for macOS with static libraries, fails when `whisper-cli` needs any
  library that is not part of macOS, and runs its smoke test from a clean copy of the packaged
  files. The published `whisper-build-v1.8.4-erfana1` binary needed libraries that were not in its
  download, which is why local transcription on macOS failed to start; the rebuilt binary reaches
  users with the next whisper pin update.

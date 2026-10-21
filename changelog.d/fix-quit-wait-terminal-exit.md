### Fixed

- **Quitting with a terminal open no longer crashes on Windows.** When Erfana closed, it killed the
  terminal's shell and exited at once. The shell's exit report could then arrive while the app was
  already shutting down, and the main process aborted. Erfana now waits up to 1.5 s for each shell
  to report its exit before it quits (#214).

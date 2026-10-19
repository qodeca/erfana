### Fixed

- **Git status now runs with the project's own git settings kept out of the way.** Erfana starts git
  from a neutral folder with a short list of environment variables, and turns off every setting that
  could make git start another program (hooks, fsmonitor, filter drivers, lazy fetch). Projects that
  use filter drivers or a partial clone fall back to the built-in git reader. The HTML preview's
  "ignored by git" check now works, and no longer blocks a whole project that sits inside a folder
  another repository ignores.

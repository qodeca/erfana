### Fixed

- **Git status and the HTML preview's "ignored by git" check work with Git for Windows again.** Git
  for Windows refused the null-device setting the hardened git call used, so every status read fell
  back to the slower built-in reader. The setting now uses a form that every git build accepts.

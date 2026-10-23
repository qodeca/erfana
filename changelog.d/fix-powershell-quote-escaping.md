### Fixed

- **Paths with curly apostrophes now open correctly in PowerShell.** A folder or file name such as
  `Bob’s Files` no longer ends the quoted path early when Erfana starts a PowerShell terminal in it
  or drops a path into one. The typographic single quotes are now escaped like the plain `'`.

### Fixed

- **Paths with curly apostrophes now open correctly in PowerShell.** A folder or file name such as
  `Bob’s Files` no longer ends the quoted path early when Erfana starts a PowerShell terminal in it
  or drops a path into one. The typographic single quotes are now escaped like the plain `'`.
- **Drops and inserts now quote paths for the terminal's own shell.** Files dropped onto the
  terminal, items dragged from the project tree and camera photos used the macOS and Linux quoting
  even in PowerShell or Command Prompt terminals. They now use the quoting of the terminal they go to.

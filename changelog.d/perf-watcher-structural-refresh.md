### Changed

- **Saving a file no longer reloads the whole project tree.** Every save – by Erfana, an agent in
  the terminal or another editor – used to make Erfana re-read and re-send the entire tree; on a
  25,000-file project, 50 saves sent 189 MB to the window. Now only adding, removing or renaming
  files and folders refreshes the tree, while git badges still update on every save. Under a
  steady stream of new files the tree also refreshes at least once a second instead of waiting for
  the stream to stop.
- **The context meter holds one file handle per project, not one per Claude session.** On macOS the
  transcript watcher used to keep a handle open for every transcript in the project's Claude
  folder – hundreds for a long-lived project.
- **Fewer blocking disk calls on the main thread.** The file watcher no longer repeats a failed
  check with a blocking one, and log rotation makes one call per file. Rotation now keeps the five
  older logs per type that the logging docs describe; it kept four before.

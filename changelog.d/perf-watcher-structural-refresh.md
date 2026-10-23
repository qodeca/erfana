### Changed

- **Saving a file no longer reloads the whole project tree.** Every save used to make Erfana
  re-read and re-send the entire tree; on a 25,000-file project on a Mac, 50 saves meant 50 full
  reads and 189 MB sent to the window – whether the file was written in place or through a temp
  file renamed over it, as Erfana itself saves. Both now cause no tree read. Adding, removing or
  renaming files and folders still refreshes the tree, and git badges still update on every save.
  Under a steady stream of new files the tree still refreshes: about once a second, or every two
  read-lengths (at most every 10 seconds) on a project whose tree is slow to read.
- **The context meter holds one file handle per project, not one per Claude session.** On macOS the
  transcript watcher used to keep a handle open for every transcript in the project's Claude
  folder – hundreds for a long-lived project. It also starts watching when Claude creates the
  folder after the terminal opened, and recovers when the folder's watch fails or the folder is
  deleted and re-created.
- **Fewer blocking disk calls on the main thread.** The file watcher no longer repeats a failed
  check with a blocking one, and log rotation makes one call per file. Rotation now keeps the five
  older logs per type that the logging docs describe; it kept four before.

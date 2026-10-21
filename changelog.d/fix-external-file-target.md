### Changed

- **Adding external files now checks the destination against the open project in the main process.** Copy and move place the file only in a folder of the project that is open, resolved the way the other file actions are; the project folder sent along by the window is no longer used. A move deletes the original only for a file chosen in the Add files dialog, and only once. `file:validatePath` also reports whether the file lies inside the project (`insideProject`).

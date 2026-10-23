### Fixed

- **Images in the Markdown preview show up, and update when the file changes.** An image
  referenced with a path relative to the document, such as `![logo](./assets/logo.svg)`, used to
  show as a broken image; it now renders, and refreshes within about a second when the file is
  rewritten on disk, without reopening the tab. Images outside the project, absolute paths and
  `file:` addresses are not loaded and show their alt text instead. (#71)

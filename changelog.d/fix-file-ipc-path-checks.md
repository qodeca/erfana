### Changed

- **File actions now check every path against the open project in the app's main process.** Reading,
  writing, creating, renaming, moving, copying, deleting and revealing a file all go through the same
  check, and a folder listing or a name-conflict check does too. A path that is not inside the open
  project is refused with a clear message.
- **Writes through a link that points outside the project are now refused, like reads already were.**
  A link inside the project that leads to a folder elsewhere can still be renamed or deleted as a
  link, and nothing outside the project is touched.
- **File and folder names must not contain `/` or `\`.** Such a name is now rejected instead of having
  the separators silently removed, so the name you typed is the name that is used.

### Fixed

- **Paths are matched to the project by whole folder names.** A folder that merely starts with the
  project's name, such as `my-project-old` next to `my-project`, is a different folder.
- **Saving a file whose project folder was renamed or removed now says so**, instead of reporting a
  path problem.

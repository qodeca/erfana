### Fixed

- **Links in the Markdown preview follow files as they appear and disappear.** A link to a file
  created after the preview opened used to stay marked as broken until you edited the links; the
  preview now re-checks its links whenever a file or folder is added, removed or moved. It also
  remembers what it already checked, so editing one link in a document with 300 of them asks about
  that one link instead of all 300.

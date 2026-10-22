### Fixed

- **Links in the Markdown preview catch up with files that appear or disappear.** A link to a file
  created after the preview opened used to stay marked as broken until you edited the links; it is
  now re-checked when the file is added or removed, and otherwise within about 30 seconds. The
  preview also remembers what it already checked, so editing one link in a document with 300 of
  them asks about that one link instead of all 300, and tabs in the background wait until you look
  at them.

### Fixed

- **Saving is now crash-safe.** Erfana writes a document, or your settings file, to a temporary file
  first and swaps it in only when it is complete. A crash or power cut in the middle of a save can no
  longer leave you with a half-written or empty file. Files that are read-only, symbolic links or
  shared hard links behave as before.

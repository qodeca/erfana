### Fixed

- **Markdown export to PDF works on Windows when the temp folder has a short name.** The export
  window refused its own page when the Windows temp path held an 8.3 short name such as
  `MARCIN~1`, so every export failed at once. The page is now matched by the file it names.

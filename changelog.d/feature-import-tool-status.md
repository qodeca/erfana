### Added

- **Settings now shows which import formats work before you pick a file.** A new Import tools section
  lists PDF, Office documents and images, says in words whether LibreOffice and ImageMagick were found,
  and tells you how to install a missing one – the Homebrew command on macOS, a download button on
  Windows, a package-manager hint on Linux. Check again looks for the tools again, so installing one no
  longer needs a restart. The "LibreOffice required" and "ImageMagick required" messages point there.
  (#250)

### Security

- **Import tool detection never runs a program from the open project.** `soffice`, `magick` and
  `convert` are now resolved to an absolute path first, a match inside the project folder is ignored,
  and the check runs from a neutral folder, so a file planted in a repository cannot answer it. (#250)

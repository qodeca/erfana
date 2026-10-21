### Added

- **Settings now shows which import formats work before you pick a file.** A new Import tools section
  lists PDF, Office documents and images, says in words whether LibreOffice and ImageMagick were found,
  and tells you how to install a missing one – the Homebrew command with a Copy button on macOS, a
  download button on Windows, the package name on Linux. Check again looks for the tools again without a
  restart. The "LibreOffice required" and "ImageMagick required" messages now offer an "Open import tools"
  button, and on macOS the file picker says which formats are not listed and why. (#250)

### Changed

- **ImageMagick is also found where Homebrew, MacPorts and the Windows installer put it**, so an app
  started from the Dock, or one already running when ImageMagick was installed on Windows, still finds
  it. (#250)

### Security

- **Import tool checks and conversions never run a program from the open project.** Tools are looked
  up on PATH without spawning a lookup command; a match from a relative PATH entry, a network path, the
  project folder or the temp folder is ignored, and a conversion is refused when the LibreOffice it would
  run is one of those. (#250)

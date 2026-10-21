### Added

- **Settings now shows which import formats work before you pick a file.** A new Import tools section
  lists PDF, Office documents and images, says in words whether LibreOffice was found,
  and tells you how to install it – the Homebrew command with a Copy button on macOS, a
  download button on Windows, the package name on Linux. Check again looks for it again without a
  restart. The "LibreOffice required" message now offers an "Open import tools" button, and on macOS the
  file picker says why Office formats are not listed. (#250)

### Changed

- **Images import without ImageMagick.** The document converter reads and OCRs images itself, so JPG,
  PNG, GIF, BMP, TIFF and WebP are available out of the box and the "ImageMagick required" message is
  gone. (#250)

### Security

- **Import tool checks and conversions never run a program from the open project.** LibreOffice is
  looked up the way the converter looks it up, without spawning a lookup command. A copy from a relative
  PATH entry, a network path, the project folder or a temporary folder is shown as "found in an unsafe
  location", is never run, and makes an Office conversion refuse with a message naming the program. The
  packaged app also stops using the folder it was launched from as its working folder. (#250)

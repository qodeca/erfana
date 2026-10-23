### Fixed

- **Erfana no longer leaves a LibreOffice process running after checking whether LibreOffice is
  installed (Windows).** Each start used to launch LibreOffice just to ask its version, and it stayed
  running in the background. Erfana now finds it by its install location and reads the version from a
  file, so nothing is launched. The import tools status shows the same result as before.

### Fixed

- **LibreOffice is now detected correctly on Windows, so Office documents can be imported there.**
  Erfana used to launch LibreOffice just to ask its version. On Windows that check never finished and
  left a LibreOffice process running in the background after every start. Erfana now finds LibreOffice
  by its install location and launches nothing. (#329)

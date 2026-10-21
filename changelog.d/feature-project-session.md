### Changed

- **The app now keeps track of the open project in one place.** Opening, switching and closing a
  project run one at a time, so a quick double-click on two recent projects ends with the second one
  open instead of a half-switched state. A project that fails to open leaves the current one
  untouched, and closing the window now also releases the project's lock.

### Removed

- **An unused internal channel for the last opened project was removed.** The app never read it, so
  nothing changes for you.

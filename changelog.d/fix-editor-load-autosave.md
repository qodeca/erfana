### Fixed

- **An editor tab that cannot read its file now says so.** Before, a failed read left the tab
  reading "No file open" with no message; it now names the file and the reason, in the tab and in
  an error toast. When two reads race, only the latest one is shown, so switching files fast can no
  longer leave the wrong file's text on screen, and the log no longer records the first 100
  characters of every opened document.
- **Autosave keeps its 30-second safety save during long typing sessions.** After the first
  periodic save, continuous typing could skip every later one until the user paused. No keystrokes
  were lost, but the periodic save is now armed again by each save. The "auto-saved" indicator's
  timer is also cleared when the tab closes.

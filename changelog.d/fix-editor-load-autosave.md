### Fixed

- **An editor tab that cannot read its file now says so.** Before, a failed read left the tab
  reading "No file open" with no message. Now the tab names the file and the reason, shows a
  "Try again" button and raises an error toast. When two reads race, only the latest one is
  shown, so switching files fast can no longer leave the wrong file's text on screen, and the
  log no longer records the first 100 characters of every opened document.
- **Autosave keeps its 30-second safety save during long typing sessions, and stops retrying a
  save that failed.** After the first periodic save, continuous typing could skip every later one
  until the user paused. No keystrokes were lost, but now each save arms the periodic save again.
  A save that fails is no longer retried every 30 seconds with a fresh error toast each time: the
  next edit tries again. The "auto-saved" indicator's timer is also cleared when the tab closes.

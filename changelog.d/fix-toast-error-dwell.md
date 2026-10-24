### Fixed

- **Error messages no longer disappear before you can read them.** An error toast now stays until
  you close it. Every toast also stops its countdown while the pointer is over it or keyboard focus
  is inside it, so a message is never pulled away while you are reading it or about to press its
  button. Press Escape on a focused toast to close it; focus goes back to where it was.
- **A repeating error no longer fills the screen.** The same message raised again while it is still
  shown now adds a count ("×3") to the toast already on screen instead of stacking a copy, and at
  most five toasts that stay until closed are shown at once – the oldest one goes first, but never
  the one you are on with the keyboard.

### Changed

- **Warnings now stay on screen for at least 8 seconds**, up from 3, even where a feature asked for
  less. This is deliberate: a warning usually asks you to notice something, which takes longer to
  read than a confirmation such as "Saved".

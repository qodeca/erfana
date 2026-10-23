### Changed

- **A drop of more than 100 files is refused before you are asked how to add it.** Dropping more than
  100 files from Finder or File Explorer onto the project tree now shows "Too many files" straight
  away, instead of first asking Move, Copy or Import. Copy now has the same 100-file limit as the
  Add files dialog.

### Fixed

- **A drop is moved only if every confirmation box says Move.** A large drop is confirmed in boxes
  of ten files. If one of those boxes could not be shown (the window was hidden, or too many boxes
  had opened in the last minute), the files from earlier boxes were still moved. Now none of the
  drop's files are moved, and one message says the box could not be shown.
- **The open- and close-project error messages use the same wording.** They now read "Failed to
  Open Project" and "Failed to Close Project", like the other project messages.

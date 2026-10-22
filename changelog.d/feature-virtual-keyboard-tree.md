### Added

- **The project tree works with the keyboard.** The tree is now one stop in the Tab order. Inside it,
  the arrow keys move between rows and open or close folders, Home and End jump to the first and last
  row, Enter opens a file or opens and selects a folder, typing the first letters of a name jumps to
  it, and Shift+F10 (or the Menu key) opens the row's menu. Screen readers now hear each row's own
  name, level and position ("3 of 7") instead of a folder name followed by everything inside it, and
  the focused row shows the standard focus ring. Before, every row was its own Tab stop and no key
  did anything. (#87, #88, #89)

### Changed

- **Large folders open instantly.** The project tree now draws only the rows on screen, so expanding
  a folder with thousands of files, or scrolling a large project, no longer stalls the window; a
  click or a Git refresh also redraws only the rows that changed. While dragging, the rows inside the
  target folder are tinted as before. A cut file or folder is now dimmed until it is pasted – the
  dimming was designed but never reached any row below the project root. (review finding [33])

### Fixed

- **Typing in a long Markdown file stays fast and no longer loses characters.** The live preview
  used to rebuild the whole document on every keystroke; in a 3,000-line file that blocked the
  editor so long that about half of what you typed was dropped and the cursor jumped to the end.
  The preview now updates when you pause (straight away in short files), and diagrams redraw once
  you stop editing them.

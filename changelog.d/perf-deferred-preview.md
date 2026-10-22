### Fixed

- **Typing in a long Markdown file stays fast.** The live preview used to rebuild the whole
  document on every keystroke; in a 3,000-line file that blocked the editor so long that, in our
  typing test, about half of what was typed (22–24 of 50 characters) was dropped and the cursor
  jumped to the end. In the same test no characters are lost now. The preview updates when you
  pause (straight away in short files, and at least once a second while you keep typing), diagrams
  redraw once you stop editing them, and PDF and Word exports wait for the preview to catch up.

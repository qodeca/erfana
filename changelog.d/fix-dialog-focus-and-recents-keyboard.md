### Fixed

- **Tab stays inside every dialog.** Ten dialogs (confirm, alert, prompt, rename, new file and new
  folder, drop mode, conflict, the file, screen and window pickers, and the screen-permission notice)
  told screen readers the app behind them was switched off, yet Tab still walked out into it. Every
  dialog now keeps Tab and Shift+Tab inside itself – in the screen and window pickers Tab returns to
  the selected option – and closing a dialog puts focus back on whatever opened it. After New File,
  Rename or Delete from the project tree's right-click menu, focus lands back in the tree instead of
  being lost. (#91)
- **Recent projects can be opened with the keyboard.** Tab reaches the recent-projects list on the
  Welcome tab, the arrow keys (and Home and End) move between projects, and Enter or Space opens one.
  Each project's remove button now names its project for screen readers, opening a project is
  announced, and removing one keeps focus in the list.
- **Copy, cut and paste no longer act on a folder you clicked earlier.** After clicking a folder in
  the project tree, Cmd/Ctrl+C on text selected elsewhere – a dialog message, for example – copied
  the folder and left the text off the clipboard; Cmd/Ctrl+X and V likewise acted on the folder.
  These shortcuts now act on the tree only while it has focus, and only with the platform's own
  modifier (Cmd on macOS, Ctrl elsewhere) and no Shift or Alt.

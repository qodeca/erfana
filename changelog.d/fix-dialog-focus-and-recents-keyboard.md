### Fixed

- **Tab stays inside every dialog.** Ten dialogs (confirm, alert, prompt, rename, new file and new
  folder, drop mode, conflict, the file, screen and window pickers, and the screen-permission notice)
  told screen readers the app behind them was switched off, yet Tab still walked out into it. Every
  dialog now keeps Tab and Shift+Tab inside itself, and closing a confirm, prompt or rename dialog
  puts focus back on whatever opened it instead of losing it. (#91)
- **Recent projects can be opened with the keyboard.** Tab reaches the recent-projects list on the
  Welcome tab, the arrow keys (and Home and End) move between projects, and Enter or Space opens one.
  Each project's remove button now names its project for screen readers, and removing one keeps
  focus in the list.
- **Copy, cut and paste no longer act on a folder you clicked earlier.** After clicking a folder in
  the project tree, Cmd/Ctrl+C on text selected elsewhere – a dialog message, for example – copied
  the folder and left the text off the clipboard; Cmd/Ctrl+X and V likewise acted on the folder.
  These shortcuts now act on the tree only while it has focus and no text is selected.

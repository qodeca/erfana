### Added

- **Resolve or delete comments in one go.** The **Comments** list offers **Resolve all changed comments**
  and **Delete all resolved comments**. Each shows you what it will change before it runs.
- **Copy a comment's text.** The **…** menu on a comment has **Copy text**, for pasting into an agent.
- **New comment from an open comment, in both previews.** The comment window offers a new comment on
  the same part, and an empty **Comments** list has a **Turn on comment mode** button.

### Changed

- **Comments now work the same in the HTML and Markdown previews.** The same words, the same marks and
  the same steps, with one difference only where a preview cannot do otherwise. Lists show plain words
  such as "Section · line 42", and menus say **Comment on section** or **Comment on paragraph**.
- **The keyboard works the same in both previews.** In comment mode, Tab moves among parts at the same
  level, Alt+Up and Alt+Down change level, and Esc leaves from anywhere in the preview panel. The
  comment mode shortcut starts the outline in the preview at once, and Shift+F10 opens the comment
  menu in the HTML preview without a mouse.
- **The name box suggests your git name.** It is only a suggestion, and nothing is saved until you
  continue.
- **Show in preview always ends on something you can see.** It opens folded parts, scrolls and flashes
  the target, or says why it can't.

### Fixed

- **No more dead ends with unsaved changes.** A first reply now asks for your name and then finishes.
  The HTML preview shows the same paused band as Markdown, with a button that works, and a file with
  unsaved changes in another window gets one clear sentence.
- **Keyboard focus no longer gets lost** when a comment window folds, closes or loses its target.
- **Clearer messages.** A restyled or moved part no longer reads as changed text, the toolbar says when
  comments can't be found, and Markdown shows when a save is still running.
- **The user guide covers the everyday steps:** reply, edit, resolve, reopen, delete and what to do after
  an agent changes the file. One shortcut table now serves both previews.

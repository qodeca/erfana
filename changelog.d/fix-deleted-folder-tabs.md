### Fixed

- **An open file is marked deleted in the cases that used to miss it.** When the folder above an
  open file is renamed or deleted outside Erfana, its tab now shows "(deleted)" and the banner
  even if the folder is one Erfana does not watch (excluded, hidden or ignored, such as `dist`),
  or if the change happened while Erfana was busy with a file operation of its own. A file
  restored with "Save to restore it" is watched again, so later outside edits reach the editor
  without reopening the tab. (#252)

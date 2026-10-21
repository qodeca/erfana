### Fixed

- **Typed characters could be dropped when the app was busy.** While the app was busy (a large file, a heavy preview), a key typed at the wrong moment could vanish and the cursor jumped to the end of the file. The editor now keeps every key you type. A file that changes on disk while its tab is clean also no longer moves your cursor, and you can undo that change in one step.

- **The unsaved dot stayed on after "Reload from Disk".** After choosing "Reload from Disk" in the file-changed bar, the tab kept showing unsaved changes although the editor matched the file. The dot now clears. Undo right after a reload brings your discarded edit back, and autosave then saves it.

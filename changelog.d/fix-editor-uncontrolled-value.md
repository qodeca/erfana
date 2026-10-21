### Fixed

- **Typed characters could be dropped when the app was busy.** While the app was busy (a large file, a heavy preview), a key typed at the wrong moment could vanish and the cursor jumped to the end of the file. The editor now keeps every key you type. A file that changes on disk while its tab is clean also no longer moves your cursor, and you can undo that change in one step.

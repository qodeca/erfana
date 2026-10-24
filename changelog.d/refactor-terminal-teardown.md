### Fixed

- **Restarting the terminal or switching projects no longer leaves listeners from the old terminal behind.** Every way a terminal closes now goes through one teardown that clears its pending timers and removes its start-up, file-drop and input listeners before the next terminal starts. (lens review [51], [52], [53])

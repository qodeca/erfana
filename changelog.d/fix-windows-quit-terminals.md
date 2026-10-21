### Fixed

- **On Windows, closing the window with many terminals open no longer leaves Erfana or its shells running.** When the window closes or the app quits, the terminals and the programs they started are now ended together, and the wait is limited. Closing or restarting a single terminal still ends only its shell. (#296, #303)

### Fixed

- **On Windows, quitting with many terminals open no longer crashes.** (#305)
- **On Windows, quitting no longer leaves console hosts or terminal programs running in the background.** (#305)
- **On Windows, a PowerShell terminal is now one process instead of two, so the quit cleanup can find what you started from it.** Your PowerShell profiles still load, after the terminal has moved to the project folder. (#305)

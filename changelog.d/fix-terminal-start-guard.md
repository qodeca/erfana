### Fixed

- **Restarting the terminal, switching projects fast or closing the panel while a terminal is still starting no longer leaves a second shell running.** A start that is overtaken now gives up and ends the shell main created for it, and its late output never reaches the terminal that replaced it. (lens review [18])

### Fixed

- **Restarting the terminal, switching projects fast or closing the panel while a terminal is still starting no longer leaves a second shell running.** A start that is overtaken now gives up and ends the shell main created for it, and its late output never reaches the terminal that replaced it. (lens review [18])
- **The terminal can start again after a failed start.** When creating the shell failed, the dead terminal stayed behind and blocked every later attempt, so "Recheck" could not bring the terminal back; a failure while loading the font or opening the terminal also leaked the half-built terminal. Both now clean up after themselves.

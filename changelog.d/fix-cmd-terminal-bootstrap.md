### Fixed

- **On Windows, Command Prompt terminals now show their output and prompt.** The cmd.exe startup command was quoted in a way cmd does not understand, so the terminal stayed blank (commands still ran). It is now built as a ready-made command line. If a shell's startup ever fails to report in, the terminal now shows its output after 10 seconds instead of staying blank.

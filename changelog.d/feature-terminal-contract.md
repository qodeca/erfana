### Changed

- **Restart terminal now also asks while any program is running in it.** Previously the prompt appeared only for Claude Code or a terminal with recent output. A silent command or another coding agent that was waiting without printing anything could be ended without a question; now the prompt appears whenever something other than the shell is running (macOS and Linux).

- **Terminal requests are checked more strictly.** The terminal only starts in the open project's folders (or the home folder when no project is open), each terminal answers only to the window that created it, and oversized or malformed requests are refused with a clear error.

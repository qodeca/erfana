### Fixed

- **Escape now closes only the dialog on top.** One press used to close every open dialog at once,
  so dismissing the quit prompt during a transcription or document import also cancelled the job,
  and Escape on a prompt over Settings closed Settings too. Escape on an open context menu no longer
  reaches the terminal underneath it either. (#229)
- **Restart terminal asks first while the terminal is busy.** Restarting ends everything running in
  the terminal, so it now asks for confirmation when Claude Code is running there or the terminal is
  still producing output after you typed in it. The prompt opens with focus on Cancel; an idle
  terminal restarts straight away.

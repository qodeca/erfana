/**
 * Encode an absolute cwd into the `<ENC>` directory segment used by Claude
 * Code under `~/.claude/projects/<ENC>/`.
 *
 * macOS/POSIX rule (verified empirically against live transcript dirs, §2):
 * replace every `/` AND every `.` in the absolute POSIX path with `-`. The
 * leading slash is NOT stripped specially — `/Users/...` naturally becomes
 * `-Users-...`.
 *
 *   `/Users/x/Projects/erfana` → `-Users-x-Projects-erfana`
 *   `/Users/x/.claude`         → `-Users-x--claude`
 *   `/a/b.c.d/e`               → `-a-b-c-d-e`
 *   `/`                        → `-`
 *
 * Windows rule (#217 — verified empirically against a live Windows host's
 * `~/.claude/projects` on disk): replace every `/`, `\`, `:`, AND `.` with `-`.
 * Drive-letter case is preserved as-is.
 *
 *   `C:\Users\marcinobel\Projects\erfana` → `C--Users-marcinobel-Projects-erfana`
 *   `C:\Users\marcinobel\.claude`         → `C--Users-marcinobel--claude` (the `\.` becomes `--`)
 *   `C:\`                                  → `C--`
 *
 * @param cwd Absolute path (POSIX on macOS, Windows path on win32).
 * @param platform Target platform; defaults to the host `process.platform` so
 *   existing callers (e.g. ClaudeTranscriptLocator) need no change.
 * @returns The encoded directory segment.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see Issue #217 - Windows support for the Claude Code status bar
 * @see docs/designs/216-claude-status-bar.md §2, §10
 */
export function encodeProjectDir(cwd: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return cwd.replace(/[/\\:.]/g, '-')
  return cwd.replace(/[/.]/g, '-')
}

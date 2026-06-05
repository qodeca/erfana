/**
 * Encode an absolute cwd into the `<ENC>` directory segment used by Claude
 * Code under `~/.claude/projects/<ENC>/`.
 *
 * Rule (verified empirically against live macOS transcript dirs, §2): replace
 * every `/` AND every `.` in the absolute POSIX path with `-`. The leading
 * slash is NOT stripped specially — `/Users/...` naturally becomes `-Users-...`.
 *
 * Examples:
 *   `/Users/x/Projects/erfana` → `-Users-x-Projects-erfana`
 *   `/Users/x/.claude`         → `-Users-x--claude`
 *   `/a/b.c.d/e`               → `-a-b-c-d-e`
 *   `/`                        → `-`
 *
 * @param cwd Absolute POSIX path (macOS v1). Windows encoding is deferred.
 * @returns The encoded directory segment.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

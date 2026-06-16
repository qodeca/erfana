// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
 * Windows rule (#217 — INFERRED from on-disk observation of a live Windows host's
 * `~/.claude/projects`, NOT a documented Claude Code contract): replace every
 * `/`, `\`, `:`, AND `.` with `-`. Drive-letter case is preserved as-is.
 *
 *   `C:\Users\marcinobel\Projects\erfana` → `C--Users-marcinobel-Projects-erfana`
 *   `C:\Users\marcinobel\.claude`         → `C--Users-marcinobel--claude` (the `\.` becomes `--`)
 *   `C:\`                                  → `C--`
 *
 * CAVEAT (finding #3): single-char separator replacement is LOSSY / non-injective
 * — distinct cwds can collapse to one segment, and a trailing separator or UNC
 * form may diverge from Claude Code's real (undocumented) encoder. A mismatch is
 * a SILENT miss (the locator finds no dir → the bar never appears, no error). To
 * blunt that, callers should locate via {@link candidateProjectDirs} (primary +
 * normalized alternates) rather than this single encoding — see
 * ClaudeTranscriptLocator.
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

/** Strip trailing path separators (`/` always; `\` on win32) without touching a bare root. */
function stripTrailingSeparators(cwd: string, platform: NodeJS.Platform): string {
  const re = platform === 'win32' ? /[/\\]+$/ : /\/+$/
  const trimmed = cwd.replace(re, '')
  // Don't collapse a bare POSIX root (`/`) to `''`, and don't turn a Windows drive
  // root (`C:\`) into the drive-relative `C:` — both would change the path's meaning.
  if (trimmed === '' || /:$/.test(trimmed)) return cwd
  return trimmed
}

/**
 * Candidate `<ENC>` directory segments to try for `cwd`, most-likely first
 * (finding #3). The primary is {@link encodeProjectDir} of the cwd as given; the
 * alternates cover plausible, NON-LOSSY normalizations (currently a
 * trailing-separator-stripped form) so a cwd that carries a trailing `\`/`/`
 * still resolves instead of silently hiding the bar. Every candidate derives from
 * the SAME cwd, so a fallback can never match a *different* project's transcript.
 * De-duplicated, so the common case yields exactly one candidate.
 */
export function candidateProjectDirs(
  cwd: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (p: string): void => {
    const enc = encodeProjectDir(p, platform)
    if (!seen.has(enc)) {
      seen.add(enc)
      out.push(enc)
    }
  }
  add(cwd)
  add(stripTrailingSeparators(cwd, platform))
  return out
}

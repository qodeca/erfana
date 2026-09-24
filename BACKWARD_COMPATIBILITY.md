<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# What Erfana must not break

- **The user's files.** Erfana reads and writes files in the user's own projects. A change never
  loses a keystroke or rewrites a file the user did not save (`docs/file-watching/README.md`).
- **Saved settings.** A setting stored by an earlier release is still read, or migrated, by the next.
- **Release verification.** Users verify downloads against the minisign-signed `SHA256SUMS` and the
  published key (`docs/release-pubkey.txt`, `docs/security.md`). A key rotation follows the
  dual-key procedure in `docs/adrs/`.
- **Keyboard shortcuts** documented in `docs/keyboard-shortcuts.md`: a change to one is a
  deliberate, noted change.
- **Reading Claude Code transcripts** under `~/.claude` for the context meter: read-only, and a
  format Erfana does not own, so an unknown shape degrades the meter, never the app.

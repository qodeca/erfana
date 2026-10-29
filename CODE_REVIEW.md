<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Code review in Erfana

A review names the file and the line, separates a direction question from a verified defect, and
never approves the reviewer's own work.

## Always check

The rules in `CLAUDE.md` (Code Style & Conventions, Design system, IPC Contracts) win. The ones a
lint run does not catch:

- Design tokens: in `src/`, spacing and typography tokens are convention, not lint; a hardcoded
  `padding` or `font-size`, or a departure from a `docs/design-system/` card without a
  `/* deviates: … */` marker and a row in the card's Exceptions, is a finding. So is an agent's change
  that promotes a card to `decided`, changes what a `decided` card requires or supersedes one – those
  are the owner's (SDLC.md § Design system in this project).
- Panel ids come from `getFilePanelId()` / `openFileInPanel()`, never hand-built.
- Renderer paths use the helpers in `src/renderer/src/utils/fileUtils.ts`; `lastIndexOf('/')`,
  a bare `.split('/')` or a manual join passes lint and is still a finding.
- A panel-level shortcut, `document` handler or "current file" singleton has an active-panel gate.
- A new panel is wrapped in a keyed `PanelErrorBoundary`.
- Autosave never loses keystrokes (`docs/file-watching/README.md`).
- User-supplied values are redacted before `logger.error` (`redactUserInput`).
- A new IPC handler validates its payload with a schema in `src/shared/ipc/` and, where the
  channel is sensitive, its sender.
- New source files carry the SPDX header (`npm run check:headers`).

## Trust boundaries

A change to any of these gets a security review (SDLC.md § Security review):

- `.github/workflows/` - what builds, signs and releases.
- `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, `.codex/` and `.env.example`:
  they decide which tools, hooks and MCP servers every agent session gets.
- A change to the base branch, to a workflow file or to a check script.
- The preload bridge (`src/preload/`), IPC sender validation, the HTML preview sandbox, the
  terminal/PTY, and the Whisper and release trust chains (`SECURITY.md` § Scope).

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

- Design tokens: spacing and typography tokens are convention, not lint; a hardcoded `padding` or
  `font-size`, or an undocumented deviation from a `design/` card, is a finding.
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

A change to any of these is routed to the security-review row by machine (`.xezar/checks/security-scan.sh`
sets `reviewerRequired`), not by memory:

- `.github/workflows/` - what builds, signs and releases.
- `.xezar/pipeline/config.json`, `.xezar/config.json`, `.xezar/routing.json`, `.xezar/routing.schema.json`,
  `.xezar/loops.json`, `.xezar/workflows/`, `.xezar/checks/`, `.xezar/docs/`, `.xezar/skills/`.
- `.claude/settings.json` and the **SessionStart hook** in it, and its loader
  `.xezar/checks/leader-context.sh`: they decide what every leader session reads at start. A change to
  either can change the leader's instructions without touching the leader guide.
- `.claude/settings.local.json`, `.codex/` and `.env.example` files.
- A change to `deploy.*`, to the base branch, to a workflow file, to a check script or to the routing
  file goes to security review.

By judgement, not by machine: the preload bridge (`src/preload/`), IPC sender validation, the HTML
preview sandbox, the Whisper and release trust chains (`SECURITY.md` § Scope) also get security review.

<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Security policy

Erfana is an Electron desktop application (GPL-3.0-only). It runs an integrated terminal (PTY), reads and writes the user's project files, can download and verify local Whisper binaries, and ships a release-artifact trust chain. We take security reports seriously.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue, pull request, or discussion for an unfixed vulnerability.

- **Preferred:** use GitHub's [private vulnerability reporting](https://github.com/qodeca/erfana/security/advisories/new) (the "Report a vulnerability" button under the repository's **Security** tab). This keeps the report confidential between you and the maintainers until a fix ships.
- **If private reporting is unavailable to you:** open a minimal public issue with **no exploit details** — just ask the maintainers to open a private channel — and we will follow up.

Please include: the affected component or file(s), the Erfana version (Help → About, or the app's version string), your OS, reproduction steps or a proof of concept, the impact, and any suggested remediation. We aim to acknowledge a report within a few business days and will credit reporters who wish to be named once a fix is released.

## Scope

In scope:

- The Electron **main process** services (`src/main/`) — file, terminal/PTY, project, settings, git-status, watcher, screenshot, camera, transcription, and import services.
- The **preload** context bridge (`src/preload/`) and the **IPC** layer (`src/shared/ipc/`, `src/main/ipc/`) — sender validation, schema validation, and channel exposure.
- The **renderer** (`src/renderer/`) — CSP, sandboxing, and any HTML/markdown rendering surface.
- The **local Whisper trust chain**: minisign dual-key manifest verification, artifact SHA-256 pinning, per-spawn TOCTOU re-hash, the `secureDownloader` hostname allowlist, and argv hardening (`validateAudioPath`).
- The **release pipeline**: signed tags, GitHub Actions workflows, and the minisign-signed `SHA256SUMS` release-artifact trust chain (see [`docs/build/release.md`](docs/build/release.md) and [`docs/security.md`](docs/security.md)).

Out of scope:

- The Anthropic Claude API and the `claude` CLI run inside the integrated terminal (report Claude issues to Anthropic at `security@anthropic.com`).
- A user's local environment configuration (OS, shell, installed binaries) and third-party tools invoked from the terminal.
- Vulnerabilities solely in upstream dependencies with no Erfana-specific exposure — report those upstream, though we appreciate a heads-up.

## Security documentation

For Electron fuses, sandboxing, context isolation, CSP configuration, and audit history, see **[docs/security.md](docs/security.md)**.

## Release verification

Every release on or after `v0.9.5` ships signed artifacts. End users should verify downloads before installing — see [`README.md` § Release verification](README.md#release-verification) and [`docs/security.md`](docs/security.md).

## Supported versions

Erfana is at a `0.x` stage. Only the latest released version receives security fixes.

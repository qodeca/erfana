# Erfana

**An open-source, agent-native Markdown workspace – run a terminal coding agent like Claude Code right beside your editor.**

[![Quality Checks](https://github.com/qodeca/erfana/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/qodeca/erfana/actions/workflows/checks.yml)
[![Latest release](https://img.shields.io/github/v/release/qodeca/erfana?sort=semver)](https://github.com/qodeca/erfana/releases)
[![License: GPL-3.0-only](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Platforms: macOS · Windows](https://img.shields.io/badge/platforms-macOS%20%C2%B7%20Windows-lightgrey.svg)](#platforms)

Erfana puts a coding agent beside your Markdown work – one window holds the editor, live preview, project tree, and a terminal running your agent. Open a project and they share one feedback loop:

- **Run the agent in your editor** – a clean top-level `claude` session (or any CLI agent) in the integrated terminal, in your project's context.
- **Watch its context** – for a Claude Code session, a per-panel meter shows the model, its 200k/1M context window, and how full it is, live.
- **Turn Markdown into prompts** – right-click a selection for prompt templates (Explain, Modify, Ask, Visualize); the prompt goes straight to the agent.
- **Edits land in your file** – mutation prompts apply the agent's changes back into the document.

It is free software under **GPL-3.0-only**.

| | |
|---|---|
| 💻 **Integrated terminal** | Run Claude Code or any CLI agent in an xterm.js + PTY terminal with WebGL rendering, file links, drag-drop paths, and cross-platform screenshot & camera capture |
| 📝 **Markdown editor** | Monaco editor, live preview with scroll sync, Mermaid diagrams (22 types, zoom/pan/full-screen), YAML frontmatter, unified in-file search |
| 📁 **Project tree** | Real-time git status (worker-thread offloaded), drag-drop reorganization, Markdown filtering, Reveal in Finder/Explorer |
| 📄 **Import & export** | Import via LiteParse (which handles 50+ formats) with local OCR – Office/image formats need LibreOffice/ImageMagick; print-optimized PDF and Word (DOCX) export with Mermaid diagrams |
| 🎙️ **Media transcription** | Audio/video → text via the OpenAI API or fully offline `whisper.cpp` |

## Platforms

macOS and Windows. There is no Linux build.

## Getting started

1. Download the signed build for your OS from **[Releases](https://github.com/qodeca/erfana/releases)**.
2. Install it (macOS: open the `.dmg`; Windows: run the setup `.exe`).
3. Launch Erfana and open a project folder – the editor, project tree, and terminal open in context.

**[⬇ Download](https://github.com/qodeca/erfana/releases)** · **[🌐 qodeca.com](https://qodeca.com)**

Prefer to build from source? See [Development](#development).

## Why open source, and how it's licensed

Erfana is free software under **GPL-3.0-only**: you can use, study, modify, and redistribute it under the GPL. We build a lot of our tooling in the open and wanted Erfana to be useful beyond our own work.

Contributions are accepted under a [Contributor License Agreement](CLA.md) that preserves Qodeca's option to also offer Erfana under separate commercial terms – this does **not** restrict your rights under the GPL. The code is GPL; the **name and branding** are not (see [Trademarks](#trademarks)).

## Built by Qodeca

Erfana is built by **[Qodeca](https://qodeca.com)** – a Warsaw-based software team building software since 2014 for the fitness, sport, and healthcare industries, where HIPAA, GDPR, and PCI DSS are the baseline, not the exception.

The same rigor shows up in Erfana: minisign-signed and notarized release artifacts, a documented four-layer trust chain for the bundled Whisper binaries, sandboxed renderers with a validated IPC layer, and a full CI gate on every push. We build in the open elsewhere too – see [erfana-skills](https://github.com/qodeca/erfana-skills) (Claude Code plugin) and [8cli](https://github.com/qodeca/8cli) (AI-first n8n CLI).

[qodeca.com](https://qodeca.com) · [LinkedIn](https://www.linkedin.com/company/qodecasoftwaredevelopment) · [hi@qodeca.com](mailto:hi@qodeca.com)

## Release verification

Every release on or after `v0.9.5` ships signed artifacts: a minisign-signed `SHA256SUMS`, macOS notarization, and Windows Authenticode. Verify downloads before installing – the release-signing public keys and the step-by-step `minisign` + `sha256sum` recipe live in [`docs/security.md`](docs/security.md#release-signing-v095-174) and [`docs/build/release.md`](docs/build/release.md), with the keys mirrored in [`docs/release-pubkey.txt`](docs/release-pubkey.txt).

## Support

Questions, ideas, or need help using Erfana? Start a [GitHub Discussion](https://github.com/qodeca/erfana/discussions), or file a bug or feature request from the [issue templates](.github/ISSUE_TEMPLATE). [SUPPORT.md](SUPPORT.md) explains where each kind of request goes (and security issues stay private – see below).

## Security

Erfana enables context isolation, disables node integration in the renderer, exposes a sandboxed `contextBridge` IPC layer with input validation on every channel, and applies a Content Security Policy. Details: [`docs/security.md`](docs/security.md).

Report security vulnerabilities **privately** via [GitHub's private advisory reporting](https://github.com/qodeca/erfana/security/advisories/new) – see [SECURITY.md](SECURITY.md). Please do not open a public issue for an unfixed vulnerability.

## License

Erfana is free software, licensed under the **GNU General Public License v3.0 only** (`GPL-3.0-only`) – see [LICENSE](LICENSE), [COPYRIGHT](COPYRIGHT), and bundled third-party notices in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md). Per-file licensing follows the [REUSE specification](https://reuse.software) (SPDX headers + `REUSE.toml`).

Copyright (c) 2025-2026 Qodeca sp. z o.o.

## Trademarks

The GPL covers Erfana's **code**, not its **name or branding**. "Erfana" and "Qodeca", and the associated logos, are trademarks of Qodeca sp. z o.o. You may use and fork the software under the GPL, but distributions of modified versions must be **renamed** – see [TRADEMARKS.md](TRADEMARKS.md). Qodeca publishes the official signed builds.

"Claude" and "Claude Code" are trademarks of Anthropic. Erfana is not affiliated with, sponsored by, or endorsed by Anthropic – it simply runs the `claude` CLI like any other terminal program.

"OpenAI" and "Whisper" are trademarks of OpenAI. Erfana is not affiliated with, sponsored by, or endorsed by OpenAI – it optionally calls the OpenAI API for transcription and bundles `whisper.cpp` (an independent open-source project, not produced by OpenAI) for offline use. See [TRADEMARKS.md](TRADEMARKS.md) for the full third-party trademark notice.

## Contributing

Contributions are welcome – see [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are accepted under **GPL-3.0-only** and require agreeing to the project [Contributor License Agreement](CLA.md) – by opening a pull request you agree to its terms (your Git author identity is your record).

## Development

Build Erfana from source:

```bash
npm install      # Node.js 24+; Python 3.12 (not 3.13 – node-pty); see below for Windows
npm run dev      # development server
npm run build    # production build
npm run build:mac   # package for macOS
npm run build:win   # package for Windows
```

**On Windows:** VS 2022 Build Tools, Developer Mode, and Win32 long paths are required – see [`docs/build/windows.md`](docs/build/windows.md).

Architecture, services, IPC patterns, testing, and the full contributor workflow are documented in **[docs/](docs/README.md)** · [Architecture](docs/architecture.md) · [Build](docs/build/README.md) · [Testing](docs/testing/README.md) · [Changelog](docs/CHANGELOG.md).

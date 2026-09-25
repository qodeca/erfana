<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# About Erfana and Qodeca

Why Erfana is open source, how it is licensed, and who builds it. This text lived in the [README](../README.md) until the README was redesigned for new users ([#139](https://github.com/qodeca/erfana/issues/139)); it is moved here verbatim, with links added to the detail behind each item.

## Why open source, and how it's licensed

Erfana is free software under **GPL-3.0-only**: you can use, study, modify, and redistribute it under the GPL. We build a lot of our tooling in the open and wanted Erfana to be useful beyond our own work.

Contributions are accepted under a [Contributor License Agreement](../CLA.md) that preserves Qodeca's option to also offer Erfana under separate commercial terms – this does **not** restrict your rights under the GPL. The code is GPL; the **name and branding** are not (see [Trademarks](../TRADEMARKS.md)).

## Built by Qodeca

Erfana is built by **[Qodeca](https://qodeca.com)** – a Warsaw-based software team building software since 2014 for the fitness, sport, and healthcare industries, where HIPAA, GDPR, and PCI DSS are the baseline, not the exception.

The same rigor shows up in Erfana: minisign-signed and notarized release artifacts, a documented four-layer trust chain for the bundled Whisper binaries, sandboxed renderers with a validated IPC layer, and a full CI gate on every push. We build in the open elsewhere too – see [erfana-skills](https://github.com/qodeca/erfana-skills) (Claude Code plugin) and [8cli](https://github.com/qodeca/8cli) (AI-first n8n CLI).

[qodeca.com](https://qodeca.com) · [LinkedIn](https://www.linkedin.com/company/qodecasoftwaredevelopment) · [hi@qodeca.com](mailto:hi@qodeca.com)

### Where each item is documented

- Minisign-signed and notarized release artifacts: [`docs/security.md` § Release signing](security.md#release-signing-v095-174)
- The four-layer trust chain for the bundled Whisper binaries: [`docs/security.md` § Local Whisper trust chain](security.md#local-whisper-trust-chain-phase-4-v094)
- Sandboxed renderers with a validated IPC layer: [`docs/security.md` § Context Isolation](security.md#context-isolation) and [§ Input Validation](security.md#input-validation)
- The full CI gate on every push: [`docs/ci.md`](ci.md)

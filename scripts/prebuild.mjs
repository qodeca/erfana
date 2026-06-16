#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Portable cross-platform replacement for the former bash `prebuild` script.
//
// Why this exists (the "aproba workaround"):
//   electron-builder's dependency tree historically pulls in `aproba`, an
//   abandoned package that is no longer published in a form npm-in-electron
//   accepts during app-deps rebuild on some platforms. Creating an empty
//   `node_modules/aproba/package.json` stub satisfies the resolver without
//   installing the real package. This is a build-time-only shim; it never
//   ships in the final app.
//
// The original script used `mkdir -p` and shell redirection, which do not
// work in cmd.exe on Windows (issue #153 — Phase 0 of the Windows roadmap).

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const aprobaDir = resolve(process.cwd(), 'node_modules', 'aproba')
const aprobaPkg = resolve(aprobaDir, 'package.json')

mkdirSync(aprobaDir, { recursive: true })
writeFileSync(aprobaPkg, '{}\n')

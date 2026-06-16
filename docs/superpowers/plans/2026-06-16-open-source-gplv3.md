<!-- REUSE-IgnoreStart -->
# Open-source Erfana under GPL-3.0-only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relicense the Erfana Electron app from proprietary (`UNLICENSED`, all rights reserved) to `GPL-3.0-only`, add the full open-source compliance + community surface, and publish it as a fresh public GitHub repo — matching the conventions already established in `qodeca/erfana-skills` and `qodeca/8cli`.

**Architecture:** Adopt the [REUSE specification](https://reuse.software) (per-file SPDX headers + `REUSE.toml` catch-all + `LICENSES/` dir), as both precedent repos do. Preserve Qodeca's commercial relicensing lever via a CLA (CLA-assistant bot) and protect the brand via a trademark policy. Prepare everything on this `feature/oss-relicense-gplv3` branch for full-diff review; publish only after a final secret scan and human sign-off, as a squashed-history fresh public repo so private history never leaks.

**Tech Stack:** Electron 39 / React 18 / TypeScript 6 / electron-vite; tooling: `reuse` (Python pipx), `license-checker`, `gitleaks`, `trufflehog`, GitHub Actions, CLA-assistant GitHub App.

---

## Locked decisions (from grill-me session)

1. **Scope** — open-source *all* of Erfana; Qodeca-authorized; forkability + freemium exposure accepted.
2. **License** — `GPL-3.0-only` (SPDX), full text at repo root + `LICENSES/`.
3. **Repo strategy** — fresh public repo, single squashed commit; private history stays private.
4. **Contributor terms** — CLA assigning broad license to Qodeca (preserves dual-licensing), enforced by **CLA-assistant bot**.
5. **Trademark** — code is GPL; "Erfana"/"Qodeca" names + logos reserved; forks must rebrand. `TRADEMARKS.md` + README notice.
6. **Exclusions** — none; publish everything (no secrets in code — all signing material lives in GitHub Secrets).
7. **License headers** — `SPDX-License-Identifier: GPL-3.0-only` one-liner on every source file; non-code covered by `REUSE.toml`.
8. **Community files** — CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, README rewrite, CLA.md, TRADEMARKS.md, COPYRIGHT, THIRD-PARTY-LICENSES.md, NOTICE-equivalents — aligned with erfana-skills/8cli.
9. **Sequencing** — prepare on branch → review full diff → final secret scan → create fresh public repo.

## Audit results carried into this plan

- **Secrets:** clean working tree. No private keys, `.env`, or hardcoded credentials. Minisign keys in-repo are public-half only.
- **Paywall/freemium:** none in this codebase; commercial layer is distribution-side. Open-sourcing exposes no working gate.
- **Dependency licenses:** MIT/BSD/ISC/Apache-2.0/BlueOak/OFL — all GPLv3-compatible.
- **`ffmpeg-static@5.3.0`:** ships GPL-3.0 (verified `node_modules/ffmpeg-static/LICENSE` is GPLv3; `ffmpeg.LICENSE` references `--enable-gpl`, not a `--enable-nonfree` build). GPL-3.0 dependency is compatible with a GPL-3.0-only app and in fact reinforces the copyleft choice. **No blocker.** Document it in THIRD-PARTY-LICENSES.md.
- **Bundled assets:** `resources/tessdata/eng.traineddata` (Apache-2.0, needs `.license` sidecar); Cascadia Mono fonts (OFL, `Cascadia-LICENSE.txt` already present, add `.license` sidecars).

## File map (created / modified)

**Create (repo root, license + compliance):**
- `LICENSE` (replaces proprietary text with full GPL-3.0-only)
- `LICENSES/GPL-3.0-only.txt`
- `REUSE.toml`
- `COPYRIGHT`
- `THIRD-PARTY-LICENSES.md`

**Create (community health):**
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CLA.md`, `TRADEMARKS.md`
- `.github/workflows/secret-scan.yml`
- `.github/workflows/reuse.yml` (or add a job to `checks.yml`)

**Create (tooling):**
- `scripts/add-spdx-headers.mjs`
- `scripts/check-spdx-headers.mjs`

**Create (asset sidecars):**
- `resources/tessdata/eng.traineddata.license`
- `src/renderer/src/assets/fonts/CascadiaMono-Regular.woff2.license`
- `src/renderer/src/assets/fonts/CascadiaMono-Bold.woff2.license`

**Modify:**
- `package.json` — `license` field → `GPL-3.0-only`; add `check:headers` + `licenses:generate` scripts
- `electron-builder.yml` — bundle `LICENSE` + `THIRD-PARTY-LICENSES.md` into the app
- All source files (`.ts`, `.tsx`, `.js`, `.mjs`, `.css`) — add SPDX header
- `README.md` — rewrite for OSS audience
- `CLAUDE.md` — reverse "closed-source / never frame as open source" framing
- Any docs asserting proprietary status (sweep — see Task 14)

---

## Phase 0 — Pre-flight gates (human + verification)

### Task 0.1: Confirm Qodeca authorization is real

**This is a human gate, not a code change.** The relicensing record in `COPYRIGHT` (Task 4) is the authorizing act of record. Before writing it, confirm with the operator that Qodeca sp. z o.o. has formally approved relicensing Erfana to GPL-3.0-only.

- [ ] **Step 1:** Operator confirms Qodeca sign-off (verbal/written). If not in hand, STOP — do not proceed past Phase 0.
- [ ] **Step 2:** Record the authorizer name to embed in `COPYRIGHT` (precedent: erfana-skills used "Marcin Obel, on behalf of Qodeca sp. z o.o.").

### Task 0.2: Pin tool versions

- [ ] **Step 1: Verify `reuse` is available**

Run: `pipx run reuse --version || pip install --user reuse && reuse --version`
Expected: prints a version (e.g. `reuse 4.x`).

- [ ] **Step 2: Verify scanners available**

Run: `gitleaks version && trufflehog --version`
Expected: both print versions. If missing: `brew install gitleaks trufflehog`.

---

## Phase 1 — License core (REUSE foundation)

### Task 1: Add the canonical GPL-3.0-only text

**Files:**
- Create: `LICENSES/GPL-3.0-only.txt`
- Create/replace: `LICENSE`

- [ ] **Step 1: Pull the canonical GPL text from the precedent repo (byte-identical to FSF)**

```bash
mkdir -p LICENSES
gh api repos/qodeca/erfana-skills/contents/LICENSES/GPL-3.0-only.txt --jq '.content' | base64 -d > LICENSES/GPL-3.0-only.txt
cp LICENSES/GPL-3.0-only.txt LICENSE
```

- [ ] **Step 2: Verify it is the full GPLv3**

Run: `head -2 LICENSE && wc -l LICENSE`
Expected: first lines `GNU GENERAL PUBLIC LICENSE` / `Version 3, 29 June 2007`; ~674 lines.

- [ ] **Step 3: Commit**

```bash
git add LICENSE LICENSES/GPL-3.0-only.txt
git commit -m "chore(license): add GPL-3.0-only text (LICENSE + LICENSES/)"
```

### Task 2: Add `REUSE.toml` catch-all

**Files:**
- Create: `REUSE.toml`

- [ ] **Step 1: Write `REUSE.toml`** (erfana-skills catch-all pattern + 8cli package metadata)

```toml
version = 1
SPDX-PackageName = "erfana"
SPDX-PackageSupplier = "Qodeca sp. z o.o."
SPDX-PackageDownloadLocation = "https://github.com/qodeca/erfana"

# REUSE (https://reuse.software/spec-3.3/) coverage for files that cannot carry
# an inline SPDX header (markdown with line-1 frontmatter, JSON, lockfiles, binary
# assets). Source files carry inline `SPDX-License-Identifier` headers instead.
# More specific [[annotations]] with precedence = "closest" override this catch-all
# (e.g. third-party assets under a non-GPL license).

[[annotations]]
path = "**"
precedence = "aggregate"
SPDX-FileCopyrightText = "2025-2026 Qodeca sp. z o.o."
SPDX-License-Identifier = "GPL-3.0-only"
```

- [ ] **Step 2: Commit**

```bash
git add REUSE.toml
git commit -m "chore(license): add REUSE.toml catch-all annotation"
```

### Task 3: Set `package.json` license field

**Files:**
- Modify: `package.json` (the `"license"` line)

- [ ] **Step 1: Change the license field**

Change `"license": "UNLICENSED",` to `"license": "GPL-3.0-only",`.

> **Keep `"private": true`.** It blocks accidental `npm publish` of a desktop app distributed via installers — it is a publish guard, not a license statement, and is orthogonal to open-sourcing. (8cli set `private:false` only because it *is* an npm package.) Leave `"author": "Qodeca sp. z o.o."` unchanged.

- [ ] **Step 2: Verify JSON still parses**

Run: `node -e "console.log(require('./package.json').license)"`
Expected: `GPL-3.0-only`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(license): set package.json license to GPL-3.0-only"
```

### Task 4: Add `COPYRIGHT` with the relicensing record

**Files:**
- Create: `COPYRIGHT`

- [ ] **Step 1: Write `COPYRIGHT`** (adapted from erfana-skills; the relicensing record is the authorizing act)

```markdown
# Copyright and licensing notice

Copyright (c) 2025-2026 Qodeca sp. z o.o.

Erfana — an Electron-based markdown IDE — is released under the GNU General
Public License, version 3 only (`GPL-3.0-only`). The full license text is in
[`LICENSE`](LICENSE) (and, per the REUSE specification, in
[`LICENSES/GPL-3.0-only.txt`](LICENSES/GPL-3.0-only.txt)).

## Relicensing record

This work was previously distributed under a proprietary license ("All rights
reserved"). Qodeca sp. z o.o., as the sole copyright holder of the contents of
this repository at the time of release, authorises and releases this work under
`GPL-3.0-only`, effective 2026-06-16. This relicensing notice is the authorising
act of record; the prior proprietary license no longer applies to this published
work.

Authorised by: <AUTHORIZER NAME from Task 0.1>, on behalf of Qodeca sp. z o.o.

## Names, logos, and trademarks

The `GPL-3.0-only` grant covers source code, documentation, and bundled assets.
It does **not** grant rights to the names "Erfana" or "Qodeca", the Qodeca or
Erfana logos, or any Qodeca trademark or service mark. See [`TRADEMARKS.md`](TRADEMARKS.md).

## Third-party components

Bundled third-party dependencies and assets retain their own licenses, reproduced
in [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md) and, for binary assets, in
`.license` sidecar files per the REUSE specification.

## Per-file licensing

Per-file license information follows the REUSE specification
(<https://reuse.software>): inline SPDX identifiers in source files, `.license`
sidecar files for binary assets, and glob rules in [`REUSE.toml`](REUSE.toml).
Run `reuse lint` to verify coverage.
```

- [ ] **Step 2: Replace `<AUTHORIZER NAME from Task 0.1>` with the confirmed name.**

- [ ] **Step 3: Commit**

```bash
git add COPYRIGHT
git commit -m "docs(license): add COPYRIGHT with GPL-3.0-only relicensing record"
```

---

## Phase 2 — SPDX headers across source

### Task 5: Add the header-insertion + header-check scripts

**Files:**
- Create: `scripts/add-spdx-headers.mjs`
- Create: `scripts/check-spdx-headers.mjs`
- Modify: `package.json` (add scripts)

- [ ] **Step 1: Write `scripts/check-spdx-headers.mjs`**

```js
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css']
const TOKEN = 'SPDX-License-Identifier: GPL-3.0-only'

// Track only files git knows about, excluding vendored/generated trees.
const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => EXTS.some((e) => f.endsWith(e)))
  .filter((f) => !f.startsWith('node_modules/') && !f.startsWith('dist/') && !f.startsWith('out/'))

const missing = files.filter((f) => !readFileSync(f, 'utf8').slice(0, 512).includes(TOKEN))

if (missing.length) {
  console.error(`Missing SPDX header in ${missing.length} file(s):`)
  for (const f of missing) console.error(`  ${f}`)
  process.exit(1)
}
console.log(`SPDX header present in all ${files.length} source files.`)
```

- [ ] **Step 2: Write `scripts/add-spdx-headers.mjs`** (idempotent inserter)

```js
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const TOKEN = 'SPDX-License-Identifier: GPL-3.0-only'
const HEADER = `// SPDX-License-Identifier: GPL-3.0-only\n// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.\n`
const CSS_HEADER = `/* SPDX-License-Identifier: GPL-3.0-only */\n/* SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. */\n`
const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css']

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter((f) => EXTS.some((e) => f.endsWith(e)))
  .filter((f) => !f.startsWith('node_modules/') && !f.startsWith('dist/') && !f.startsWith('out/'))

let changed = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (src.slice(0, 512).includes(TOKEN)) continue
  const header = f.endsWith('.css') ? CSS_HEADER : HEADER
  // Preserve a leading shebang if present.
  if (src.startsWith('#!')) {
    const nl = src.indexOf('\n')
    writeFileSync(f, src.slice(0, nl + 1) + header + src.slice(nl + 1))
  } else {
    writeFileSync(f, header + src)
  }
  changed++
}
console.log(`Added SPDX header to ${changed} file(s).`)
```

- [ ] **Step 3: Add npm scripts to `package.json`**

```json
"check:headers": "node scripts/check-spdx-headers.mjs",
"licenses:generate": "license-checker --production --json > /tmp/erfana-licenses.json && node scripts/gen-third-party.mjs"
```

(Add `gen-third-party.mjs` only if you choose to auto-generate THIRD-PARTY-LICENSES.md in Task 9; otherwise omit the second script.)

- [ ] **Step 4: Verify the check script fails BEFORE headers exist**

Run: `node scripts/check-spdx-headers.mjs`
Expected: FAIL — lists hundreds of files missing the header (the scripts themselves already carry it).

- [ ] **Step 5: Commit**

```bash
git add scripts/add-spdx-headers.mjs scripts/check-spdx-headers.mjs package.json
git commit -m "chore(license): add SPDX header insert + check scripts"
```

### Task 6: Apply SPDX headers to all source files

**Files:**
- Modify: every `.ts/.tsx/.js/.mjs/.cjs/.css` source file

- [ ] **Step 1: Run the inserter**

Run: `node scripts/add-spdx-headers.mjs`
Expected: `Added SPDX header to N file(s).`

- [ ] **Step 2: Verify the check now passes**

Run: `node scripts/check:headers 2>/dev/null; npm run check:headers`
Expected: `SPDX header present in all N source files.`

- [ ] **Step 3: Verify nothing else broke**

Run: `npm run typecheck && npm run lint`
Expected: both pass. (If ESLint complains about header comment placement, add an eslint-disable or adjust `eslint.config` to allow leading license comments — 8cli does this; mirror its config.)

- [ ] **Step 4: Run the production build to confirm bundling is unaffected**

Run: `npx electron-vite build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(license): add SPDX GPL-3.0-only headers to all source files"
```

---

## Phase 3 — Third-party attribution

### Task 7: Add REUSE `.license` sidecars for binary assets

**Files:**
- Create: `resources/tessdata/eng.traineddata.license`
- Create: `src/renderer/src/assets/fonts/CascadiaMono-Regular.woff2.license`
- Create: `src/renderer/src/assets/fonts/CascadiaMono-Bold.woff2.license`

- [ ] **Step 1: Write `resources/tessdata/eng.traineddata.license`**

```
SPDX-FileCopyrightText: 2006-2024 Ray Smith, Google Inc., University of Nevada
SPDX-License-Identifier: Apache-2.0
```

- [ ] **Step 2: Write both font sidecars** (identical content)

```
SPDX-FileCopyrightText: Microsoft Corporation
SPDX-License-Identifier: OFL-1.1
```

- [ ] **Step 3: Ensure `Apache-2.0` and `OFL-1.1` texts exist under `LICENSES/`**

```bash
pipx run reuse download Apache-2.0 OFL-1.1
ls LICENSES/
```
Expected: `Apache-2.0.txt`, `GPL-3.0-only.txt`, `OFL-1.1.txt`.

- [ ] **Step 4: Commit**

```bash
git add resources/tessdata/*.license src/renderer/src/assets/fonts/*.license LICENSES/Apache-2.0.txt LICENSES/OFL-1.1.txt
git commit -m "chore(license): add REUSE sidecars for tessdata + fonts"
```

### Task 8: Verify full REUSE compliance

- [ ] **Step 1: Run reuse lint**

Run: `pipx run reuse lint`
Expected: `Congratulations! Your project is compliant with version 3.x of the REUSE Specification :-)`. If files are flagged, either add a sidecar or rely on the `REUSE.toml` catch-all; re-run until clean.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A && git commit -m "chore(license): achieve REUSE compliance" || echo "nothing to fix"
```

### Task 9: Generate `THIRD-PARTY-LICENSES.md`

**Files:**
- Create: `THIRD-PARTY-LICENSES.md`

- [ ] **Step 1: Inventory production dependency licenses**

Run: `npx license-checker --production --summary`
Expected: a tally (mostly MIT, plus Apache-2.0, BSD-2-Clause, BlueOak-1.0.0, GPL-3.0 for ffmpeg-static).

- [ ] **Step 2: Write `THIRD-PARTY-LICENSES.md`** (8cli structure; Erfana header)

```markdown
<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Third-party licenses

Erfana is distributed under the GNU GPL v3.0 only (see [`LICENSE`](./LICENSE)). It
bundles the third-party production dependencies and assets listed below. Each is
GPL-3.0-compatible; original copyright notices and license texts are reproduced as
required. Development-only dependencies are not distributed and are not listed.

This file is generated from the production dependency tree
(`npx license-checker --production`); last generated 2026-06-16. Regenerate when
dependencies change.

## Bundled binaries and assets

| Component | License | Notes |
|-----------|---------|-------|
| ffmpeg (via `ffmpeg-static`) | GPL-3.0 | Audio/video extraction. GPLv3 binary; reinforces Erfana's GPL-3.0-only license. See `ffmpeg.LICENSE` in the package. |
| Tesseract data (`eng.traineddata`) | Apache-2.0 | OCR language data. |
| Cascadia Mono font | OFL-1.1 | Vendored terminal font; see `Cascadia-LICENSE.txt`. |

## npm production dependencies

<!-- Paste the per-license tables from `license-checker --production`, grouped by
license (MIT, Apache-2.0, BSD-2-Clause, BlueOak-1.0.0, ...), each with the full
license text reproduced once, as in qodeca/8cli/THIRD-PARTY-LICENSES.md. -->
```

> **No placeholder shortcut:** actually paste the resolved per-package rows and the full license text for each distinct license, exactly as 8cli does. Fetch 8cli's file as a structural template: `gh api repos/qodeca/8cli/contents/THIRD-PARTY-LICENSES.md --jq '.content' | base64 -d`.

- [ ] **Step 3: Commit**

```bash
git add THIRD-PARTY-LICENSES.md
git commit -m "docs(license): add THIRD-PARTY-LICENSES.md"
```

### Task 10: Bundle license files into the built app

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Add `LICENSE` + `THIRD-PARTY-LICENSES.md` to `extraResources`**

In `electron-builder.yml`, extend the existing `extraResources` block:

```yaml
extraResources:
  - from: resources/tessdata
    to: tessdata
  - from: LICENSE
    to: LICENSE
  - from: THIRD-PARTY-LICENSES.md
    to: THIRD-PARTY-LICENSES.md
```

- [ ] **Step 2: Verify YAML parses and a build still produces an app**

Run: `npx electron-vite build && echo OK`
Expected: `OK`. (A full `npm run build:mac` is heavier; defer to the pre-publish gate.)

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "build: bundle LICENSE + THIRD-PARTY-LICENSES into packaged app"
```

---

## Phase 4 — Community health files

### Task 11: Add CLA.md and TRADEMARKS.md

**Files:**
- Create: `CLA.md`, `TRADEMARKS.md`

- [ ] **Step 1: Pull the precedent files and adapt the noun ("Claude Code plugin" → "Electron application", "erfana" → "Erfana")**

```bash
gh api repos/qodeca/erfana-skills/contents/CLA.md --jq '.content' | base64 -d > CLA.md
gh api repos/qodeca/erfana-skills/contents/TRADEMARKS.md --jq '.content' | base64 -d > TRADEMARKS.md
```

- [ ] **Step 2: Edit `CLA.md`** — confirm the §3 broad-license grant names `GPL-3.0-only` and Qodeca's dual-licensing right (it already does in the precedent). Replace project description with "the Erfana application". Keep the "How to sign" → CLA-assistant section.

- [ ] **Step 3: Edit `TRADEMARKS.md`** — replace plugin-specific brand-asset path (`skills/design-shared/brands/...`) with Erfana's actual logo/asset location if any (search `git ls-files | grep -iE 'logo|icon|brand'`), or drop that section if Erfana ships no brand asset in-repo. Keep the GPLv3 §7(e) trademark-reservation language.

- [ ] **Step 4: Commit**

```bash
git add CLA.md TRADEMARKS.md
git commit -m "docs: add CLA and trademark policy"
```

### Task 12: Add CODE_OF_CONDUCT.md and SECURITY.md

**Files:**
- Create: `CODE_OF_CONDUCT.md`, `SECURITY.md`

- [ ] **Step 1: CODE_OF_CONDUCT.md — copy erfana-skills (Contributor Covenant 2.1) verbatim, swap "erfana community" → "Erfana community"; keep `hi@qodeca.com` enforcement contact**

```bash
gh api repos/qodeca/erfana-skills/contents/CODE_OF_CONDUCT.md --jq '.content' | base64 -d > CODE_OF_CONDUCT.md
```

- [ ] **Step 2: SECURITY.md — write Erfana-specific (Electron app + signing trust chain)**

Adapt 8cli/erfana-skills structure. Required content:
- Private reporting via `https://github.com/qodeca/erfana/security/advisories/new`.
- Scope: main-process services, IPC layer, preload bridge, the whisper trust chain (minisign dual-key verification, SHA-256 pinning, secureDownloader allowlist), the release/signing pipeline.
- Out of scope: Anthropic Claude API (→ security@anthropic.com), user's local environment.
- Supported versions: 0.x — only the latest release receives fixes.

- [ ] **Step 3: Add the SPDX HTML-comment header** to both files (matches 8cli):

```markdown
<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->
```

- [ ] **Step 4: Commit**

```bash
git add CODE_OF_CONDUCT.md SECURITY.md
git commit -m "docs: add code of conduct and security policy"
```

### Task 13: Add CONTRIBUTING.md (Erfana build)

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Write `CONTRIBUTING.md`** adapting erfana-skills, with Erfana's real workflow:
  - License + CLA note (inbound=outbound GPL-3.0-only; CLA-assistant gate).
  - Setup: `npm install` (note Node 24+; node-pty needs Python 3.12 not 3.13 — from CLAUDE.md "Important Notes").
  - Branch model: cut `feature/...` from `develop`; PR targets `develop` (matches the repo's actual default branch).
  - Quality gates (from CLAUDE.md): `npm run lint && npm run typecheck && npm run test:ci && npx electron-vite build`; `npm run check:headers`; `pipx run reuse lint`; run `npm run test:e2e` locally for Electron-path changes (CI doesn't cover e2e).
  - Conventional Commits; sentence case; en dashes; `border-radius: 0`.
  - Secret-scanning note (gitleaks + trufflehog locally before push).
  - PR checklist mirroring erfana-skills, including the CLA-green item and SPDX-header item.

- [ ] **Step 2: Add SPDX HTML-comment header (as Task 12 Step 3).**

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add contributing guide"
```

### Task 14: Rewrite README for an OSS audience

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the current README to preserve accurate product description**

Run: `sed -n '1,80p' README.md`

- [ ] **Step 2: Rewrite the top of the README** with:
  - License badge: `[![License: GPL-3.0-only](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)` + the existing CI badge.
  - One-line product description + feature highlights (keep existing accurate content).
  - **Build from source** section (`npm install`, `npm run dev`, `npm run build:mac`).
  - **License** section: "Erfana is free software under GPL-3.0-only. See [LICENSE](LICENSE)."
  - **Trademark** notice: "Erfana and Qodeca are trademarks of Qodeca sp. z o.o. — see [TRADEMARKS.md](TRADEMARKS.md). Forks must rebrand."
  - **Contributing** pointer to CONTRIBUTING.md + CLA.
  - **Commercial note** (optional): Qodeca distributes official signed builds; the source is GPL.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for open-source (GPL-3.0-only) release"
```

---

## Phase 5 — Reverse the proprietary framing

### Task 15: Sweep and reverse "proprietary / closed-source / never frame as open source" assertions

**Files:**
- Modify: `CLAUDE.md` (project) and any doc asserting proprietary status

- [ ] **Step 1: Find every proprietary assertion**

Run:
```bash
grep -rniE "unlicensed|all rights reserved|proprietary|closed[- ]source|never frame.*open source|freemium" --include="*.md" . | grep -v node_modules | grep -v "LICENSES/"
```
Expected: hits in `CLAUDE.md` (the license bullet), possibly `docs/*`, `ROADMAP.md`.

- [ ] **Step 2: Edit `CLAUDE.md`** — replace the License line:

Old (in the Project Overview block):
> **License**: Proprietary — `UNLICENSED` in package.json, `private: true`. … Erfana is a closed-source freemium product; never frame it as open source or suggest OSS-style licensing.

New:
> **License**: `GPL-3.0-only` (open source). Copyright (c) 2025-2026 **Qodeca sp. z o.o.** See [LICENSE](LICENSE). Code is GPL; the "Erfana"/"Qodeca" names and logos remain Qodeca trademarks (see [TRADEMARKS.md](TRADEMARKS.md)) — forks must rebrand. Contributions require the project CLA (see [CLA.md](CLA.md)). `"private": true` in package.json is a publish guard for the desktop app, not a license statement.

- [ ] **Step 3: Fix any other doc hits** found in Step 1 to reflect GPL-3.0-only, preserving meaning.

- [ ] **Step 4: Re-run the grep — only legitimate references remain** (e.g. the relicensing record in COPYRIGHT, the GPL text itself).

Run: same grep as Step 1.
Expected: no remaining assertion that Erfana *is* proprietary/closed-source.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: reverse proprietary framing to GPL-3.0-only across docs"
```

> **Operator note (outside the repo):** the Claude Code project memory `~/.claude/.../memory/project_proprietary_license.md` and its `MEMORY.md` index line also assert proprietary status. Update those after publish so future sessions don't re-assert the old decision. This is a memory edit, not a repo change — handled by the assistant, not in this branch.

---

## Phase 6 — CI and contributor tooling

### Task 16: Add secret-scan workflow

**Files:**
- Create: `.github/workflows/secret-scan.yml`

- [ ] **Step 1: Write the workflow** (mirrors erfana-skills `secret-scan`: gitleaks full-history + trufflehog verified)

```yaml
name: Secret Scan
on:
  push:
  pull_request:
concurrency:
  group: secret-scan-${{ github.ref }}
  cancel-in-progress: true
jobs:
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"
      - name: trufflehog
        uses: trufflesecurity/trufflehog@main
        with:
          extra_args: --results=verified,unknown
```

- [ ] **Step 2: Validate workflow YAML**

Run: `npx --yes @action-validator/cli .github/workflows/secret-scan.yml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/secret-scan.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/secret-scan.yml
git commit -m "ci: add gitleaks + trufflehog secret-scan workflow"
```

### Task 17: Add REUSE + SPDX-header check to CI

**Files:**
- Modify: `.github/workflows/checks.yml` (add a `license` job) — OR create `.github/workflows/reuse.yml`

- [ ] **Step 1: Add a `license` job** to `checks.yml`:

```yaml
  license:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci || (sleep 10 && npm ci) || (sleep 20 && npm ci)
      - run: npm run check:headers
      - uses: fsfe/reuse-action@v5
```

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/checks.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/checks.yml
git commit -m "ci: enforce SPDX headers + REUSE compliance"
```

### Task 18: Add CLA-assistant config (activated at publish)

**Files:**
- Create: `.github/workflows/cla.yml` (CLA-assistant-lite) — activates only on the public repo once secrets exist

- [ ] **Step 1: Write `.github/workflows/cla.yml`** using `contributor-assistant/github-action` (the maintained CLA-assistant-lite):

```yaml
name: CLA Assistant
on:
  issue_comment:
    types: [created]
  pull_request_target:
    types: [opened, closed, synchronize]
permissions:
  actions: write
  contents: write
  pull-requests: write
  statuses: write
jobs:
  cla:
    runs-on: ubuntu-latest
    steps:
      - uses: contributor-assistant/github-action@v2.6.1
        if: (github.event.comment.body == 'recheck' || github.event.comment.body == 'I have read the CLA Document and I hereby sign the CLA') || github.event_name == 'pull_request_target'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PERSONAL_ACCESS_TOKEN: ${{ secrets.CLA_SIGNATURES_TOKEN }}
        with:
          path-to-signatures: 'signatures/cla.json'
          path-to-document: 'https://github.com/qodeca/erfana/blob/main/CLA.md'
          branch: 'main'
          allowlist: 'dependabot[bot]'
```

> **Publish-time setup (Task 21):** create a `CLA_SIGNATURES_TOKEN` (a PAT or a dedicated signatures repo) on the public repo; until then this workflow no-ops on the private branch.

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/cla.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cla.yml
git commit -m "ci: add CLA-assistant workflow (activated on public repo)"
```

---

## Phase 7 — Pre-publish verification gate

### Task 19: Full local verification on the prepared branch

- [ ] **Step 1: Quality gates**

Run: `npm run lint && npm run typecheck && npm run test:ci && npx electron-vite build`
Expected: all pass.

- [ ] **Step 2: License gates**

Run: `npm run check:headers && pipx run reuse lint`
Expected: headers present in all source; REUSE compliant.

- [ ] **Step 3: Final secret scan over the exact snapshot**

Run:
```bash
gitleaks detect --source . --redact -v
trufflehog filesystem . --results=verified,unknown --no-update
```
Expected: no findings. Any hit → STOP, investigate, rotate if real.

- [ ] **Step 4: e2e smoke (Electron paths changed via headers/builder)**

Run: `npm run test:e2e`
Expected: pass (or no regressions vs baseline).

### Task 20: Human review of the full diff

- [ ] **Step 1: Operator reviews the entire branch diff**

Run: `git diff develop...feature/oss-relicense-gplv3 --stat` then spot-review key files (LICENSE, COPYRIGHT, CLA.md, TRADEMARKS.md, README.md, CLAUDE.md).

- [ ] **Step 2: Operator explicitly approves publication.** This is the last reversible point. STOP here for sign-off.

---

## Phase 8 — Publish (fresh squashed public repo)

> Only after Task 20 sign-off. These steps create the irreversible public artifact.

### Task 21: Create the fresh public repo from the approved snapshot

- [ ] **Step 1: Merge the branch into `develop`** (so the private repo also reflects the relicense) — or keep on branch per operator preference.

```bash
git checkout develop && git merge --no-ff feature/oss-relicense-gplv3
```

- [ ] **Step 2: Produce a clean squashed snapshot in a new working copy** (avoids leaking private history):

```bash
TMP=$(mktemp -d)
git clone --depth 1 file://"$PWD" "$TMP/erfana-public"
cd "$TMP/erfana-public"
rm -rf .git
git init -b main
git add -A
git commit -m "chore: open-source Erfana under GPL-3.0-only

Erfana is released by Qodeca sp. z o.o. under GPL-3.0-only. See LICENSE,
COPYRIGHT (relicensing record), TRADEMARKS.md, and CONTRIBUTING.md/CLA.md."
```

- [ ] **Step 3: Re-scan the squashed snapshot** (belt-and-suspenders on the exact bytes going public):

```bash
gitleaks detect --source . --redact -v && trufflehog filesystem . --results=verified,unknown --no-update
```
Expected: clean.

- [ ] **Step 4: Create the public repo and push**

> If reusing `qodeca/erfana` (currently private), flipping visibility would expose history — instead, since we squashed, push to a NEW remote or replace the repo contents intentionally. Operator decides the final repo name. Example with a new repo:

```bash
gh repo create qodeca/erfana --public --source . --remote origin --push \
  --description "Erfana — an Electron markdown IDE with integrated terminal. GPL-3.0-only."
```

(If the name `qodeca/erfana` must be the private one renamed, coordinate with the operator; do not force-flip the private repo to public.)

### Task 22: Configure the public repo

- [ ] **Step 1: Enable secret-scanning + push protection**

```bash
gh api -X PATCH repos/qodeca/erfana --field security_and_analysis='{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}'
```

- [ ] **Step 2: Install/authorize the CLA-assistant** (the `cla.yml` workflow) and create the `CLA_SIGNATURES_TOKEN` secret + `signatures/` storage. Verify a test PR triggers the CLA check.

- [ ] **Step 3: Set branch protection on `main`** (required checks: lint, typecheck, test, build, secret-scan, license, CLA; signed-tag rule as the private repo uses).

- [ ] **Step 4: Enable private vulnerability reporting** (Settings → Security) to back `SECURITY.md`.

- [ ] **Step 5: Add repo topics + verify the GPL badge/license is detected** (GitHub shows "GPL-3.0" in the sidebar).

### Task 23: Post-publish memory + doc reconciliation

- [ ] **Step 1: Update Claude Code project memory** — rewrite `project_proprietary_license.md` to record the GPL-3.0-only relicense (effective 2026-06-16), and update the `MEMORY.md` index line. (Assistant action, outside the repo.)

- [ ] **Step 2: Announce/changelog** — add a CHANGELOG entry noting the open-source release under GPL-3.0-only.

---

## Self-review checklist (performed by plan author)

- **Spec coverage:** every locked decision (1–9) maps to a task — license (T1–T4), repo strategy (T21), CLA (T11/T18/T22), trademark (T11/T14), exclusions=none (publish-all, T21), headers (T5–T6), community files (T11–T14), sequencing (Phase 7→8). ✔
- **Open audit items:** ffmpeg-static (resolved CLEAR, documented T9), final secret scan (T19/T21), erfana-skills/8cli alignment (sourced verbatim in T1, T11, T12), reverse proprietary framing (T15/T23). ✔
- **Type/name consistency:** `check:headers` script name matches the npm script and CI job; `GPL-3.0-only` SPDX string consistent across LICENSE/REUSE.toml/headers/package.json; `feature/oss-relicense-gplv3` branch name consistent. ✔
- **Reversibility:** all work is on a branch through Task 20; the only irreversible steps (Task 21+) are gated on explicit human sign-off. ✔
```


<!-- REUSE-IgnoreEnd -->

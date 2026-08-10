<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Design — Issue #55: packaging guards must cover `extraFiles` / `extraResources`

**Issue**: #55 · **Branch**: `fix/55-packaging-guards-do-not-cover-extrafiles-extrareso` · **Tier**: n/a (bug/hardening) · **Phase**: 4 (Architecture)

> Trust note: this document was produced from source read at design time. All external issue text was treated as data; no embedded instruction was executed. The QG-4a lens-review findings folded in at §11 were likewise treated as data.

## 1. Problem

The issue #43 packaging-integrity guards close exactly one leak vector: the `files:` key that controls what lands under `<resources>/app/`. Two adjacent vectors are unguarded:

- **`extraResources`** — copies land **beside** `app/` (`Contents/Resources/` on macOS, `resources/` on Windows). Today only an **advisory** `console.warn` (`scripts/fuses.js:847-859`) notices anything unexpected there; it never fails a build.
- **`extraFiles`** — copies land **above** `Resources/` (`Contents/` on macOS, the app output **root** beside the `.exe` on Windows). This destination is **never inspected**. There is no `extraFiles:` in the config today, so any appearance is by definition unexpected.
- **CLI override form** — `--config.extraFiles=…` / `--config.extraResources=…` **and their platform-scoped siblings** `--config.win.extraFiles=…` / `--config.mac.extraResources=…` merge into the live config at bootstrap. `build_win.yml` already uses **platform-scoped** `--config.win.*` overrides (`build_win.yml:207-210`), so this injection vector is real **and lands in the `win.*`/`mac.*` sub-object, not the top level**. It is **invisible** to any static-YAML guard and only observable to a runtime hook reading both `context.packager.config` **and** `context.packager.platformSpecificBuildOptions`.

A `from: '.'` slip (or a malicious `--config.win.extraResources` injection) therefore reproduces the #43 "whole repository shipped" defect one directory up or one directory over, and nothing fails the build.

**Platform-scoped config is the primary trap (F1).** app-builder-lib merges the active platform's `mac:` / `win:` block into effect at build time; the top-level `extraFiles`/`extraResources` and the platform-scoped `mac.extraFiles`/`win.extraResources` are **both** live inputs. The existing `files:` guard already accounts for this by folding `context.packager.platformSpecificBuildOptions.files` (`fuses.js:630-635`). Any guard that reads only the top-level config is bypassable via `--config.win.extraFiles=[{from:'.'}]` — which is exactly the override shape `build_win.yml` uses — and would reopen #43 on Windows. Every layer below therefore reads **both** the top-level and the platform-scoped config.

## 2. Approach — layered defense (three cooperating layers)

Mirrors the existing `files:` defense (runtime config-shape check + runtime packed-tree walk + static CI guard), extended to the two extra-content destinations **and to their platform-scoped forms**.

| Layer | Where | Sees CLI overrides? | Reads platform-scoped config? | Closes | AC |
|-------|-------|--------------------|-------------------------------|--------|----|
| **L1 — runtime config-shape guard** `assertExtraContentAllowlist()` | `scripts/fuses.js`, afterPack, reads the **union** of `context.packager.config.extra{Files,Resources}` and `context.packager.platformSpecificBuildOptions.extra{Files,Resources}` | **Yes** (merged config) | **Yes** (folds `platformSpecificBuildOptions`, mirroring the `files:` fold at `fuses.js:630-635`) | The real leak vector: a dangerous `from`/`to` shape or a destination outside the allowlist, whether it came from top-level YAML, a `mac:`/`win:` block, or a `--config.*` / `--config.win.*` override | AC1, AC2 |
| **L2 — runtime packed-tree walk** | `scripts/fuses.js`, afterPack, walks the resolved dest dirs | n/a (inspects the artifact) | n/a | A leak that somehow reached the packed tree — defense in depth behind L1. Split into L2a-1 (config-dest allowlist, fatal both platforms), L2a-2 (full-sibling enumeration, fatal macOS / advisory Windows), L2b (coarse repo-leak tripwire) | AC4 |
| **L3 — static CI guard** (awk/grep) | `.github/workflows/checks.yml` | No | Reads YAML text — catches indented `mac:`/`win:` blocks too | The **YAML edit path** — a **coarse presence check** only; authoritative shape validation lives in the binding test (§5.5) | AC3 |

**L1 is the authoritative leak-closer.** It is the only layer that sees `--config.*` / `--config.win.*` overrides, and — per F1 — it is the only layer that reasons over both top-level and platform-scoped config. L2 is defense-in-depth on the artifact and is explicitly a set of tripwires/backstops, **not** sound standalone controls (see §2.1, F3). L3 is a coarse, fast per-push presence check for the common YAML-edit mistake and deliberately does **not** reconstruct FileSet semantics (F4); the authoritative YAML-shape assertion runs in the required Unit-tests job via the binding test (§5.5).

### 2.1 Central design tension — the `extraFiles` destination on Windows

The `extraFiles` destination on Windows **is** the app output root, which is full of Electron's standard runtime layout: `Erfana.exe`, `*.dll`, `locales/`, `resources/`, `LICENSES.chromium.html`, `chrome_*.pak`, `vk_swiftshader*`, `d3dcompiler_47.dll`, `ffmpeg.dll`, `snapshot_blob.bin`, `v8_context_snapshot.bin`, `icudtl.dat`, etc. Allowlisting that entire layout is exactly the fragile enumeration that has burned first-release builds before (see `MEMORY.md`: v0.11.1 artifact coupling, v0.16.1/.2 Windows signing). A naive "every entry must be allowlisted" walk there would very likely **false-fail the first Windows release** — a worse outcome than the bug being fixed.

**Resolution — asymmetric packed-tree walk (L2), matched to each destination's shape, with the resources check split per F2 and the extraFiles check reframed as a coarse tripwire per F3:**

| Destination | Packed-tree size/shape | L2 mechanism | Fatal on | Why |
|-------------|------------------------|--------------|----------|-----|
| **`extraResources`** dest — **config-originated slots** (`tessdata`, `LICENSE`, `THIRD-PARTY-LICENSES.md`) | Small, config-grounded, identical on both platforms | **L2a-1: FATAL config-dest allowlist** — the packed sibling names that correspond to config-controllable slots must be ⊆ `ALLOWED_EXTRA_RESOURCES_DESTS` | **BOTH platforms** | This is the actual leak vector and it is config-grounded, not macOS-enumerated. A `--config.win.extraResources=[{to:'src'}]` injection lands here and must fail on Windows too. |
| **`extraResources`** dest — **full sibling enumeration** (Electron-owned names: `app`/`app.asar`, `icon.icns`, `elevate.exe`, `*.lproj`, …) | Small but **platform-variant** (Electron-owned names differ mac↔win) | **L2a-2: `EXPECTED_RESOURCES_ENTRIES` enumeration** — every sibling must be an expected Electron-owned name, a config slot, or `*.lproj` | **macOS FATAL, Windows ADVISORY (warn)** until a real Windows packed-tree baseline is captured (follow-up, §7 D-item) | The Electron-owned name set was enumerated on a **macOS-only** baseline; CI never packs on Windows (`windows-checks` runs only typecheck + `test:main`). Keeping this fatal on Windows would rest a both-platforms-fatal gate on an unverified baseline and risk a first-Windows-release false-fail. Softening applies **only** to the Electron-owned-sibling enumeration; the config leak vector (L2a-1) stays both-platforms-fatal. |
| **`extraFiles`** dest (macOS `Contents/`, Windows output root) | Large standard Electron runtime layout | **L2b: COARSE repo-leak TRIPWIRE** — recursive (≥2 levels) `REPO_ROOT_SENTINELS` scan **plus** a "any config-originated population is already forbidden by L1" entry-count tripwire, since `ALLOWED_EXTRA_FILES_DESTS` is empty | **BOTH platforms** | Backstop only. Detects the #43-class "repo copied in" leak with near-zero false-positive risk; it is **not** a sound standalone control (see F3 note below). |

**Justification for the resources split (F2).** The security property we need is "the repository did not get shipped". At the `extraResources` dest the config-controllable slots are a small, config-grounded set, so an allowlist over exactly those slots (L2a-1) is safe, strict, and legitimately both-platforms-fatal. The broader full-sibling enumeration (L2a-2) additionally pins Electron-owned names, but those names are platform-variant and were enumerated only on macOS — CI never runs an electron-builder pack on Windows — so promoting that enumeration to fatal on Windows would rest a release-blocking gate on an unverified baseline. L2a-2 therefore stays macOS-fatal / Windows-advisory until a real Windows packed-tree baseline is captured (§7 follow-up). This softens **only** the Electron-owned-sibling enumeration on Windows; the config leak vector (L2a-1) and the extraFiles tripwire (L2b) stay both-platforms-fatal.

**Reframing L2b honestly (F3).** L2b is a **coarse tripwire / backstop, not a sound standalone control.** A depth-1 name-preserving sentinel scan is evadable in obvious ways: a renamed single file (`from:'./src/secret.ts',to:'secret.ts'`), a nested copy (`from:'.',to:'bundled'` → depth-1 shows only `bundled/`), or any content-copy whose landed names are not sentinels. L2b is therefore strengthened to **recurse at least two levels** for sentinels and to add an **entry-count/size tripwire**: because `ALLOWED_EXTRA_FILES_DESTS` is empty, L1 already forbids **any** config-originated content at the extraFiles dest, so L2b flags any non-empty/unexpected extraFiles-dest population as suspicious. Even so, L2b cannot enumerate Electron's runtime layout and cannot be made sound at that dest. **The security guarantee rests on L1** (now fixed per F1 to read platform-scoped config); L2b exists to catch a gross regression if L1 is ever bypassed, not to stand alone.

**Sentinel selection rule.** `REPO_ROOT_SENTINELS` must contain only names that are unmistakably repository-root artifacts **and never** part of Electron's runtime layout at either dest. It therefore deliberately **excludes** `resources` (the Windows output root legitimately contains a `resources/` dir), `LICENSE` / `THIRD-PARTY-LICENSES.md` (legitimately shipped), and `out` (the build output). It includes `package.json`, `package-lock.json`, `.git`, `node_modules`, `src`, `specs`, `scripts`, `docs`, `e2e`, `tsconfig*.json`, `.github`, `electron-builder.yml`, `CLAUDE.md`. `node_modules` is safe as a sentinel **at these destinations** because production `node_modules` lands inside `app/`, never at `Contents/` or the output root.

## 3. Changes table

| File | Action | Change |
|------|--------|--------|
| `scripts/fuses.js` | modify | Add constants `ALLOWED_EXTRA_RESOURCES_DESTS`, `ALLOWED_EXTRA_FILES_DESTS`, `REPO_ROOT_SENTINELS`; **derive** `EXPECTED_RESOURCES_ENTRIES` as the union of `ALLOWED_EXTRA_RESOURCES_DESTS` (config slots) with the fixed Electron-owned names (`app`, `app.asar`, `icon.icns`, `elevate.exe`, …) so the subset relation is structural (F5), and rewrite its doc-comment (drop "advisory only"). Add functions `assertExtraContentAllowlist()` (reads **and folds platform-scoped config**, F1), `mergeExtraContent()` (helper that unions top-level + `platformSpecificBuildOptions`, mirroring `fuses.js:630-635`), `resolveExtraFilesDir()`, `assertResourcesConfigDestsAllowlist()` (L2a-1, fatal both), `assertResourcesSiblingsAllowlist()` (L2a-2, fatal macOS / warn win32), `assertExtraFilesDestNoRepoLeak()` (L2b, recursive + count tripwire). Extract the advisory beside-`app/` block out of `assertPackagedAppContents()` into the split L2a-1/L2a-2. Wire all new calls into `afterPack()` (~1041). Export the new symbols. |
| `.github/workflows/checks.yml` | modify | Reduce the CI guard to a **coarse presence grep** (F4): reject any `extraFiles:` key whether at column 0 **or indented under a `mac:`/`win:` block** (presence = fail, since `ALLOWED_EXTRA_FILES_DESTS` is empty); on any `extraResources:` edit (top-level or platform-scoped), emit a warning pointing at the binding test (§5.5), which is where FileSet `from`/`to` shape is authoritatively validated. Do **not** reconstruct FileSet semantics in awk. Update the coupling comment (currently `checks.yml:413`) to name the new constants and to state that shape validation lives in `fuses.test.mjs`. |
| `electron-builder.yml` | modify | Extend the `extraResources:` block with a coupling comment mirroring the `files:` one (~19-31): name `ALLOWED_EXTRA_RESOURCES_DESTS`, the CI presence guard, and the binding test; state that the **absence** of `extraFiles:` (top-level **and** under `mac:`/`win:`) is intentional and that `ALLOWED_EXTRA_FILES_DESTS` is empty (fail-closed). No functional YAML change. |
| `scripts/fuses.test.mjs` | modify | New `describe` blocks for each new function (see §5); extend the "agrees with the repository electron-builder.yml as shipped" binding test to bind `config.extraResources` → `ALLOWED_EXTRA_RESOURCES_DESTS` **and additionally assert the platform-scoped shapes** `config.mac?.extraFiles`/`config.mac?.extraResources` and `config.win?.extraFiles`/`config.win?.extraResources` (F1); add the subset-relation drift test (F5); add the merged-config observation test (F6); add the empty-allowlist vs nothing-configured tests (F7) and the `to`-absent FileSet test (F8); update the two existing beside-`app/` advisory tests to the split fatal/advisory forms. |
| docs (Phase 10) | modify | See §7. |

## 4. Proposed signatures & constants

```js
// Constants (scripts/fuses.js, near ALLOWED_APP_ENTRIES ~472)

/** Permitted top-level `to:` destinations for extraResources (beside app/).
 *  These are the CONFIG-controllable slots; L2a-1 enforces them fatally on both
 *  platforms. */
const ALLOWED_EXTRA_RESOURCES_DESTS = Object.freeze([
  'tessdata', 'LICENSE', 'THIRD-PARTY-LICENSES.md',
]);

/** Permitted top-level `to:` destinations for extraFiles. Empty = fail-closed:
 *  nothing is allowed to land at the extraFiles dest today. An EMPTY allowlist
 *  is semantically "reject ALL entries", distinct from "nothing configured"
 *  (extraFiles absent), which is accepted. See assertExtraContentAllowlist. */
const ALLOWED_EXTRA_FILES_DESTS = Object.freeze([]);

/** Fixed Electron-owned sibling names beside app/ (platform-variant superset). */
const ELECTRON_OWNED_RESOURCES_ENTRIES = Object.freeze([
  'app', 'app.asar', 'icon.icns', 'elevate.exe', // + '*.lproj' handled by pattern
]);

/** L2a-2 full-sibling allow-set. DERIVED as the union of the config slots and the
 *  Electron-owned names so the subset relation
 *  ALLOWED_EXTRA_RESOURCES_DESTS ⊆ EXPECTED_RESOURCES_ENTRIES holds structurally
 *  (F5); a test also asserts it as a drift guard. */
const EXPECTED_RESOURCES_ENTRIES = Object.freeze([
  ...ALLOWED_EXTRA_RESOURCES_DESTS,
  ...ELECTRON_OWNED_RESOURCES_ENTRIES,
]);

/** Repo-root names that must NEVER appear at an extra-content destination.
 *  Deliberately excludes `resources`, `LICENSE`, `THIRD-PARTY-LICENSES.md`, `out`
 *  (all legitimately present at one dest or the other). */
const REPO_ROOT_SENTINELS = Object.freeze([
  'package.json', 'package-lock.json', '.git', 'node_modules', 'src', 'specs',
  'scripts', 'docs', 'e2e', '.github', 'electron-builder.yml', 'CLAUDE.md',
  'tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json',
]);

/**
 * Helper — union the top-level extra-content config with its platform-scoped
 * sibling, mirroring the existing `files:` fold at fuses.js:630-635.
 * @param {unknown} topLevel   context.packager.config.extra{Files,Resources}
 * @param {unknown} platform   context.packager.platformSpecificBuildOptions.extra{Files,Resources}
 * @returns {unknown[]} concatenated FileSet entries (each still unnormalised)
 */
function mergeExtraContent(topLevel, platform) { /* … */ }

/**
 * L1 — validate the SHAPE of an extraFiles/extraResources config. Callers pass
 * the MERGED (top-level ∪ platform-scoped) value so it includes `--config.*`
 * AND `--config.win.*` / `--config.mac.*` overrides (F1). Fails closed on any
 * shape it cannot map.
 * @param {unknown} extraContent  merged FileSet list (via mergeExtraContent)
 * @param {{kind:'extraFiles'|'extraResources', allowedDests:readonly string[]}} opts
 * @returns {string[]} the sorted set of destination segments it accepted
 * @throws when:
 *   - allowedDests.length === 0 AND the merged content has ANY entry
 *     (explicit empty-allowlist = reject-all; F7);
 *   - a FileSet has `to === undefined` (extraResources' native defaulting form
 *     is NOT modelled — fail closed with /cannot map/, F8);
 *   - root-sweep `from` ('.', '', './'); `..`-escaping/absolute `from`;
 *   - `to` that is '', '.', absolute, `..`-escaping, or whose first segment is
 *     NOT in allowedDests;
 *   - any other FileSet shape it cannot reason about (/cannot map/).
 * NOTE: `extraContent === undefined` with allowedDests === [] returns []
 *       (nothing configured → nothing to reject); this is the accept case that
 *       F7 distinguishes from the empty-allowlist reject-all case above.
 */
function assertExtraContentAllowlist(extraContent, { kind, allowedDests }) { /* … */ }

/** Directory where extraFiles lands. darwin→Contents/, win32|linux→appOutDir. */
function resolveExtraFilesDir(electronPlatformName, appOutDir, electronBinaryPath) { /* … */ }

/**
 * L2a-1 — FATAL sentinel/leak-name TRIPWIRE for entries beside app/ (Phase-6 HIGH
 * remediation — replaces the earlier exhaustive config-dest allowlist). Fatally
 * rejects a sibling beside app/ whose top-level name is a known repo-structure
 * sentinel or a known secret/exfil leak-name (EXTRA_CONTENT_LEAK_NAMES =
 * REPO_ROOT_SENTINELS ∪ SUSPICIOUS_SIBLING_NAMES) and is NOT an allowlisted
 * extraResources dest. This is the config leak vector and runs FATAL on BOTH
 * platforms.
 */
function assertResourcesDestNoRepoLeak(resourcesDir, { platform = process.platform } = {}) { /* … */ }

/**
 * L2a-2 — full-sibling enumeration beside app/. Every sibling must be in
 * EXPECTED_RESOURCES_ENTRIES or match `*.lproj`. FATAL on macOS; ADVISORY
 * (console.warn) on win32 until a real Windows packed-tree baseline is captured
 * (F2; follow-up §7). Softens ONLY the Electron-owned-name enumeration on Windows.
 */
function assertResourcesSiblingsAllowlist(resourcesDir, { platform = process.platform } = {}) { /* … */ }

/**
 * L2b — COARSE repo-leak TRIPWIRE for the extraFiles dest (Contents/ | output root).
 * NOT a sound standalone control (F3). Recurses ≥2 levels for REPO_ROOT_SENTINELS,
 * AND — because ALLOWED_EXTRA_FILES_DESTS is empty so L1 forbids any config content
 * here — treats ANY unexpected non-empty population at the extraFiles dest as
 * suspicious (entry-count/size tripwire). Does NOT enumerate Electron's runtime
 * layout. Runs FATAL on BOTH platforms. The real guarantee is L1.
 */
function assertExtraFilesDestNoRepoLeak(extraFilesDir, { platform = process.platform } = {}) { /* … */ }
```

### 4.1 afterPack wiring (~1041, after the two existing `files:` assertions)

```js
// L1 — config-shape over the MERGED (top-level ∪ platform-scoped) config, so it
// sees --config.* AND --config.win.* / --config.mac.* overrides (F1).
const cfg = context.packager.config;
const pcfg = context.packager.platformSpecificBuildOptions;
assertExtraContentAllowlist(
  mergeExtraContent(cfg.extraResources, pcfg.extraResources),
  { kind: 'extraResources', allowedDests: ALLOWED_EXTRA_RESOURCES_DESTS });
assertExtraContentAllowlist(
  mergeExtraContent(cfg.extraFiles, pcfg.extraFiles),
  { kind: 'extraFiles', allowedDests: ALLOWED_EXTRA_FILES_DESTS });

// L2a — resources dest: config-dest allowlist (fatal both) + sibling enumeration
// (fatal macOS / advisory win32).
assertResourcesConfigDestsAllowlist(bundleResources, { platform: context.electronPlatformName });
assertResourcesSiblingsAllowlist(bundleResources, { platform: context.electronPlatformName });

// L2b — extraFiles dest coarse tripwire (fatal both).
const extraFilesDir = resolveExtraFilesDir(
  context.electronPlatformName, context.appOutDir, electronBinaryPath);
if (!extraFilesDir) throw new Error(/* unknown platform — fail closed */);
assertExtraFilesDestNoRepoLeak(extraFilesDir, { platform: context.electronPlatformName });
```

All calls key off `context.electronPlatformName` (the platform being **packaged**), matching the existing rule at `fuses.js:1037-1040`.

## 5. Test strategy (`scripts/fuses.test.mjs`)

Mirror the existing patterns: `it.each` for shape variants, temp-dir fixtures via a small `makeExtraFilesDest()` / reuse of `makePackedApp()` for the resources dest, `vi.spyOn(console,'warn')` retained only where the check is **advisory** (L2a-2 on win32). Coverage target ≥ 80% of the new branches (the existing suite is branch-exhaustive; match it).

### 5.1 `assertExtraContentAllowlist` (L1) — AC1, AC2, AC5, AC6

Positive:
- Accepts the real `extraResources` (`[{from:'resources/tessdata',to:'tessdata',filter:['**/*']},{from:'LICENSE',to:'LICENSE'},{from:'THIRD-PARTY-LICENSES.md',to:'THIRD-PARTY-LICENSES.md'}]`) → returns the dest set. **(AC5 no-false-positive)**
- Accepts `extraContent === undefined` with `allowedDests: []` → returns `[]` (**nothing configured** → nothing to reject). **(F7 accept case)**
- Accepts `extraFiles: []` (empty array) with `allowedDests: []` → returns `[]` (empty config, no entries). **(F7 boundary)**

Negative (F7 — explicit empty-allowlist reject-all):
- **`extraFiles: ['x']`** (or `[{from:'x',to:'x'}]`) with `allowedDests: []` → throws (empty allowlist ≠ nothing configured; any entry is rejected). This is the distinguishing test from the accept cases above.

Negative (shape):
- `from: '.'` (and `''`, `'./'`) → throws `/root sweep|whole tree/i`.
- `from: '../secrets'` → throws `/escapes the project root/i`.
- `to: '.'` / `to: ''` / `to: '/'` → throws.
- `to: '../elsewhere'` → throws `/escapes/i`.
- `to: 'notes'` when not in `allowedDests` → throws `/destination .* not permitted/i`.
- **`to` absent (F8):** `{from:'LICENSE'}` (object FileSet with no `to`) → throws `/cannot map/i` (the native defaulting form is deliberately unmodelled → fail-closed). Positive counterpart: `{from:'LICENSE',to:'LICENSE'}` accepted.
- Unmappable FileSet shape (`42`, or an object with neither `from`/`to` nor string) → throws `/cannot map/i` (fail-closed, matching `deriveAllowedAppEntries` style).

CLI-override / platform-scoped (F1, AC2):
- **Merged extraFiles from a `win.extraFiles` override:** feed `mergeExtraContent(undefined, [{from:'.',to:'.'}])` with `allowedDests: []` → throws (this is the `--config.win.extraFiles=[{from:'.'}]` bypass the design closes).
- **Merged extraResources from a `mac.extraResources` override** adding an un-allowlisted dest (`to:'src'`) → throws `/destination .* not permitted/i`.
- `mergeExtraContent` unit test: top-level ∪ platform-scoped are concatenated; either side `undefined` is tolerated; both `undefined` → `[]`.

### 5.2 `resolveExtraFilesDir` — AC4

- `darwin` → `<binary>/Contents`.
- `win32` and `linux` → `appOutDir` (root).
- unknown platform → `null` (caller fails closed).

### 5.3 `assertResourcesConfigDestsAllowlist` (L2a-1) — AC4, AC5, AC6

- **Passes** when the config-slot siblings beside `app/` are exactly `tessdata` + `LICENSE` + `THIRD-PARTY-LICENSES.md`. **(AC5)**
- **Throws on BOTH platforms** when a config-controllable sibling outside the allowlist is present (e.g. `src`, `secrets` landed via `--config.win.extraResources`) — `it.each` over `platform:'darwin'` **and** `platform:'win32'` (proves the config leak vector is both-platforms-fatal per F2). **(AC2, AC4)**

### 5.4 `assertResourcesSiblingsAllowlist` (L2a-2) — AC4, AC5, AC6

- **Passes (no throw, no warn)** on a realistic resources dir: `app/` + `tessdata` + `LICENSE` + `THIRD-PARTY-LICENSES.md` + `en.lproj`/`pl.lproj` (reuse the fixture from the existing "does not warn about the real extraResources siblings" test). **(AC5)**
- **Passes** with `app.asar` instead of `app/` (Windows/asar shape) — pins the derived constant entry.
- **macOS FATAL:** under `platform:'darwin'`, an unexpected non-config, non-`.lproj` sibling (`icon-extra`, `stray.dat`) → **throws**.
- **Windows ADVISORY:** under `platform:'win32'`, the same unexpected sibling → **`console.warn` only, no throw** (assert via `vi.spyOn(console,'warn')`); documents the softened Electron-owned-name enumeration pending the Windows baseline (F2, §7 follow-up).
- A `REPO_ROOT_SENTINELS` hit is a fortiori caught by L2a-1 (fatal both) even where L2a-2 is advisory — assert that `src` beside `app/` still fails on win32 through L2a-1.

### 5.5 Binding test extension (AC5, AC7 — F1, F5)

Extend `agrees with the repository electron-builder.yml as shipped` (`fuses.test.mjs:571`). This is the **authoritative YAML-shape validation** (F4): the awk guard is coarse, this test parses the real config and runs in the **required** Unit-tests job.
```js
// Top-level extraResources binds to the constant.
expect(assertExtraContentAllowlist(
  mergeExtraContent(config.extraResources, undefined),
  { kind: 'extraResources', allowedDests: ALLOWED_EXTRA_RESOURCES_DESTS }))
  .toEqual([...ALLOWED_EXTRA_RESOURCES_DESTS].sort());

// Absence is intentional — top-level AND platform-scoped (F1).
expect(config.extraFiles).toBeUndefined();
expect(config.mac?.extraFiles).toBeUndefined();
expect(config.mac?.extraResources).toBeUndefined();
expect(config.win?.extraFiles).toBeUndefined();
expect(config.win?.extraResources).toBeUndefined();

// Subset drift guard (F5): every config slot is a full-sibling entry.
expect(ALLOWED_EXTRA_RESOURCES_DESTS.every(d => EXPECTED_RESOURCES_ENTRIES.includes(d)))
  .toBe(true);
```
This is the config→constant lock: editing `extraResources:` (or adding any `mac.extra*`/`win.extra*`) in the YAML without updating `ALLOWED_EXTRA_RESOURCES_DESTS` fails the **required** Unit-tests job, exactly as the `files:`/`ALLOWED_APP_ENTRIES` binding does today.

### 5.6 `assertExtraFilesDestNoRepoLeak` (L2b) — AC4, AC5, AC6 (F3)

- **Passes** on a standard Electron layout (macOS `Contents/` with only `Info.plist`, `MacOS/`, `Frameworks/`, `Resources/`; Windows root with `Erfana.exe`, `locales/`, `resources/`, `*.dll`) — none are sentinels, population is the expected Electron set. **(AC5, top-risk no-false-positive case; both platforms.)**
- **Throws** when a sentinel is present at depth 1 (`package.json`, `.git`, `node_modules`, `src`, `specs`, `tsconfig.json`) — `it.each` over the sentinel list.
- **Recursion (F3):** **throws** when a sentinel is nested (`bundled/src`, `bundled/package.json`) — proves the ≥2-level recursion closes the `from:'.',to:'bundled'` evasion.
- **Entry-count tripwire (F3):** **throws** on an unexpected non-sentinel population landed via a renamed copy (`secret.ts` at the extraFiles dest) — proves the "any config content here is already forbidden by L1" backstop fires even when landed names are not sentinels.
- **Does not throw** on `resources/` or `LICENSE` at the root (proves the sentinel list excludes legitimately-present names and the count tripwire tolerates the standard layout).
- Per-platform: `platform:'darwin'` and `platform:'win32'`.

### 5.7 Merged-config observation proof (F6) — AC1, AC2

L1's authority rests on the assumption that the afterPack hook's config reflects `--config.*` / `--config.win.*` overrides. This is asserted in the issue but not proven, so add **one** of:
- **Preferred — integration test:** invoke electron-builder (or its config-resolution entry point) with `--config.extraResources='[{"from":"x","to":"x"}]'` and `--config.win.extraResources='[{"from":"y","to":"y"}]'`, and assert that inside a stubbed afterPack, `mergeExtraContent(context.packager.config.extraResources, context.packager.platformSpecificBuildOptions.extraResources)` observes both injected entries; OR
- **Fallback — documented manual check** in the step comment + §10, run once and recorded, if a full electron-builder invocation is too heavy for the unit suite.

Until this passes, L1 is treated as **authoritative-pending-proof**; L2/L3 remain independent backstops (see R3).

### 5.8 CI-guard manual negative tests (AC3 — F4)

The awk/grep guard is now a **coarse presence check**; it supports `bash guard.sh /tmp/broken.yml` (see `checks.yml:348`). Document (in the step comment) mutated-copy cases to run by hand, each must exit non-zero:
- an `extraFiles:` block at column 0;
- an `extraFiles:` block **indented under a `mac:` or `win:` block** (F1 — the platform-scoped edit path);
and one warn case: an edited `extraResources:` block emits the "validate shape in fuses.test.mjs" warning. The guard does **not** attempt to pair `from`/`to` or judge dest validity — that is the binding test's job (§5.5, F4).

## 6. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **Windows first-release false-positive** — a both-platforms-fatal walk rejects a legitimate Electron runtime file, burning a release (project has history here). | Low | High | Two structural guards: (1) the `extraFiles` dest (large, variable layout) uses **only** L2b's sentinel denylist + count tripwire, never an allowlist — it cannot fire on a standard Electron file; (2) the platform-variant Electron-owned-sibling enumeration (L2a-2) is **advisory (warn), not fatal, on Windows** (F2) until a real Windows packed-tree baseline is captured, so an un-foreseen Windows sibling warns rather than blocking a tag. The both-platforms-fatal parts (L2a-1 config-dest allowlist, L2b tripwire) are config-grounded or denylist-only, not macOS-enumerated. |
| R2 | `EXPECTED_RESOURCES_ENTRIES`' Electron-owned names were enumerated on macOS; a genuine un-listed Windows sibling exists we didn't foresee. | Medium | Low | On Windows this now only **warns** (L2a-2 advisory), so it cannot false-fail a release. The warning is a clear "unexpected sibling X — add to EXPECTED_RESOURCES_ENTRIES", caught on the advisory `windows-checks` CI leg and in the packed build **before signing** (`fuses.js:1025`). Follow-up D-item (§7) captures a real Windows baseline and promotes L2a-2 to fatal on win32. |
| R3 | Merged config does not actually reflect `--config.extra*` / `--config.win.extra*` overrides (L1's core assumption). | Low | High | **Proven, not assumed** (F6): §5.7 injects `--config.extraResources` / `--config.win.extraResources` and asserts L1 observes both. Until that passes L1 is authoritative-pending-proof; L2 (packed-tree) and L3 (static) remain independent backstops — the artifact walk sees the real files regardless of config source. |
| R4 | electron-builder normalises extra-content FileSets (incl. the `to`-absent defaulting form) into a shape the guard doesn't model → false throw or false pass. | Low | Medium | `assertExtraContentAllowlist` fails **closed** on unmodelled shapes incl. `to === undefined` (F8), so a normalisation surprise errs toward blocking, not leaking; the binding test (§5.5) runs the guard against the **real** merged config every push, so any surprise surfaces immediately, not at release. |
| R5 | CI awk guard and `fuses.js` constants drift; or `ALLOWED_EXTRA_RESOURCES_DESTS` and `EXPECTED_RESOURCES_ENTRIES` drift out of the subset relation. | Low | Medium | `EXPECTED_RESOURCES_ENTRIES` is **derived** from `ALLOWED_EXTRA_RESOURCES_DESTS` (F5), so the subset relation is structural; a test also asserts it (§5.5). Coupling comment updated in `checks.yml` and `electron-builder.yml`; the binding test hard-fails on constant drift; the awk guard is now coarse (presence only) so it has little semantic surface to drift from. |
| R6 | Platform-scoped config bypass persists if any layer still reads only top-level config (the F1 defect). | Low | High | L1 reads the **merged** top-level ∪ `platformSpecificBuildOptions` value (F1), the binding test asserts `mac.*`/`win.*` shapes, and L3 rejects indented `extraFiles:` under `mac:`/`win:`. §5.1 exercises the `--config.win.extraFiles=[{from:'.'}]` bypass explicitly. |

## 7. Docs to sync (Phase 10) — AC7

- `docs/build/README.md` — extend the packaging-guard section: the new extra-content layers, the L1 platform-scoped-config fold (F1), the asymmetric walk, the L2a resources split (fatal L2a-1 / advisory-on-Windows L2a-2), the L2b tripwire framing, R1/R2/R6 residual-risk note.
- `electron-builder.yml` coupling comment (functional edit, listed in §3) and `checks.yml:413` comment.
- **Follow-up deferred item (F2):** add a Windows-enablement deferred-work entry (`docs/windows/deferred-work-phase4.md`, new D-item; cross-reference from `docs/technical-debt.md`) to **capture a real Windows electron-builder packed-tree baseline and promote L2a-2 to fatal on win32**. Reference this item's issue/id here so the softening is tracked, not lost.
- `docs/technical-debt.md` — record the L2a-2 Windows-advisory softening as a watch item pointing at the D-item above.
- `docs/build/release.md` — one line if the release checklist references the packaging guard set.
- `CHANGELOG` entry under the next version.

## 8. Implementation sequence

1. `scripts/fuses.js`: add the constants, **derive** `EXPECTED_RESOURCES_ENTRIES` from `ALLOWED_EXTRA_RESOURCES_DESTS` ∪ Electron-owned names (F5), add `mergeExtraContent` + `resolveExtraFilesDir`. (No behaviour change yet.)
2. Add `assertExtraContentAllowlist` (L1, merged-config + empty-allowlist + `to`-absent semantics, F1/F7/F8) + unit tests (§5.1) + `resolveExtraFilesDir` tests (§5.2) + `mergeExtraContent` test.
3. Split the beside-`app/` advisory out of `assertPackagedAppContents` into `assertResourcesConfigDestsAllowlist` (L2a-1, fatal both) and `assertResourcesSiblingsAllowlist` (L2a-2, fatal macOS / warn win32); tests §5.3, §5.4.
4. Add `assertExtraFilesDestNoRepoLeak` (L2b, recursive + count tripwire, F3) + tests (§5.6).
5. Wire all new calls into `afterPack` (§4.1); export new symbols.
6. Extend the binding test with platform-scoped shape + subset drift assertions (§5.5, F1/F5); add the merged-config observation proof (§5.7, F6).
7. `electron-builder.yml` coupling comment.
8. `checks.yml` coarse presence guard (top-level + indented `mac:`/`win:` `extraFiles:`) + comment (§5.8, F4).
9. Run `npm run test:ci`, `npm run lint`, `npm run typecheck`, `npx electron-vite build`; run the CI-guard manual negatives (§5.8) and the merged-config proof (§5.7).
10. Docs sync (§7), including the Windows-baseline follow-up D-item.

Order rationale: constants/helpers first (inert), then each assertion behind its own tests, split-extraction before wiring so the extracted functions are green before they run in afterPack, binding + merged-config proofs after the constants are final, CI + docs last.

## 9. Acceptance-criteria mapping

| AC | Requirement | Satisfied by |
|----|-------------|--------------|
| AC1 | Runtime config-shape rejection reading merged config | L1 `assertExtraContentAllowlist` reading the **merged** top-level ∪ `platformSpecificBuildOptions.extra*` (§4, §4.1, F1); observation proven §5.7 (F6) |
| AC2 | CLI-override coverage (via merged config), incl. platform-scoped | L1 sees `--config.*` **and** `--config.win.*`/`--config.mac.*` merges; `ALLOWED_EXTRA_FILES_DESTS` empty ⇒ any injected `extraFiles` rejected; un-allowlisted `extraResources` dest rejected fatally on both platforms (L2a-1) (§5.1, §5.3) |
| AC3 | Static CI guard extension for the YAML edit path | `checks.yml` coarse presence guard rejecting `extraFiles:` at column 0 **or** indented under `mac:`/`win:` (§3, §5.8, F4) |
| AC4 | Packed-tree walk fatal on both platforms for the extra-content dests | L2a-1 (fatal both) + L2b (fatal both), plus L2a-2 (fatal macOS / advisory win32, F2); all keyed off `electronPlatformName` (§2.1, §4.1) |
| AC5 | Current benign config still passes (no false positive) | Binding test (§5.5) + realistic per-platform fixtures (§5.4, §5.6) asserting the standard layout passes / does not throw |
| AC6 | Unit tests positive + negative per assertion | §5.1–5.7 enumerate positive+negative per new/extended function, incl. empty-allowlist (F7), `to`-absent (F8), recursion + count tripwire (F3), subset drift (F5) |
| AC7 | Docs + comment sync | §7 + the coupling comments in `electron-builder.yml` and `checks.yml`; Windows-baseline follow-up D-item (F2) |

## 10. Verification criteria (Phase 8)

- `npm run test:ci` green, including the extended binding test (platform-scoped shapes + subset drift), the merged-config observation proof (§5.7), and every new `describe`.
- CI-guard manual negatives (§5.8) each exit non-zero — **including the `extraFiles:` block indented under `mac:`/`win:`** (F1); the real `electron-builder.yml` exits zero (extraResources edit warns, does not fail).
- Merged-config proof (§5.7) confirms L1 observes `--config.extraResources` **and** `--config.win.extraResources` before L1 is treated as authoritative (F6).
- `npm run lint && npm run typecheck && npx electron-vite build` green.
- A local `electron-vite build` + pack invocation (or the existing packed-tree fixtures) confirms afterPack runs all new assertions without false-failing the benign config on both `darwin` and `win32` platform arguments — and that an unexpected Electron-owned sibling **warns rather than throws** on win32 (L2a-2 advisory, F2).

## 11. Lens-review resolutions (QG-4a)

| Finding | Severity | Exact design change that resolves it |
|---------|----------|--------------------------------------|
| **F1** | MUST FIX (blocker) | L1 now reads the **merged** `context.packager.config.extra*` ∪ `context.packager.platformSpecificBuildOptions.extra*` via new `mergeExtraContent()` (mirrors the `files:` fold at `fuses.js:630-635`); §4.1 wiring, §4 signature, §2/§2.1 updated. Binding test §5.5 additionally asserts `config.mac?.extraFiles/.extraResources` and `config.win?.extraFiles/.extraResources` are `undefined`. L3 (§5.8) rejects `extraFiles:` indented under `mac:`/`win:`, not only at column 0. New risk R6 records the bypass class. §5.1 exercises the `--config.win.extraFiles=[{from:'.'}]` bypass. |
| **F2** | MUST FIX (major) | Resources-dest check split (§2.1 table, §3, §4): **L2a-1** `assertResourcesConfigDestsAllowlist` (config-derived dest allowlist, **fatal both platforms** — the config leak vector) and **L2a-2** `assertResourcesSiblingsAllowlist` (full Electron-owned-sibling enumeration, **fatal macOS / advisory `console.warn` on win32**) until a Windows packed-tree baseline exists. R1/R2 rewritten; §7 adds a Windows-baseline follow-up deferred D-item to promote L2a-2 to fatal on win32. Explicitly noted the softening touches only the Electron-owned enumeration; the config vector stays both-platforms-fatal. |
| **F3** | MUST FIX (major) | L2b `assertExtraFilesDestNoRepoLeak` strengthened (§2.1, §4, §5.6): recurse ≥2 levels for sentinels (closes `to:'bundled'` nesting) plus an entry-count/size tripwire (closes renamed-file evasion), grounded on `ALLOWED_EXTRA_FILES_DESTS === []` ⇒ any config content is forbidden by L1. Reframed honestly in the doc as a **coarse tripwire / backstop, not a sound standalone control**; the guarantee rests on L1. |
| **F4** | MUST FIX (major) | Authoritative `extraFiles`/`extraResources` FileSet-shape validation moved to the binding test §5.5 (YAML-parses the real config, runs in the required Unit-tests job). L3 reduced (§3, §5.8) to a **coarse presence grep**: reject any `extraFiles:` key (fail), warn on `extraResources:` edits pointing at the binding test; no `from`/`to` pairing in awk. |
| **F5** | MUST FIX (major) | `EXPECTED_RESOURCES_ENTRIES` is now **derived** as `[...ALLOWED_EXTRA_RESOURCES_DESTS, ...ELECTRON_OWNED_RESOURCES_ENTRIES]` (§4), making the subset relation structural; §5.5 also asserts `ALLOWED_EXTRA_RESOURCES_DESTS.every(d => EXPECTED_RESOURCES_ENTRIES.includes(d))` as a drift guard. R5 updated. |
| **F6** | SHOULD FIX (minor) | New §5.7 merged-config observation proof: inject `--config.extraResources` and `--config.win.extraResources` into a real electron-builder config resolution and assert L1 observes both; L1 is "authoritative-pending-proof" until it passes. Added to verification criteria §10 and risk R3. |
| **F7** | SHOULD FIX (minor) | L1 signature (§4) makes empty-allowlist fail-closed explicit: `allowedDests.length === 0 && hasAnyEntry ⇒ throw`, distinct from `extraContent === undefined ⇒ []`. §5.1 adds `extraFiles: []`/undefined (accept) vs `extraFiles: ['x']` with `allowedDests:[]` (reject) tests. |
| **F8** | SHOULD FIX (minor) | L1 signature (§4) handles `to === undefined` as fail-closed (`throw /cannot map/`); §5.1 adds negative `{from:'LICENSE'}` (no `to`) → throws and positive `{from:'LICENSE',to:'LICENSE'}` → accepted. R4 updated to note the fail-closed direction on the defaulting form. |

## 12. QG-11a lens-review remediations

The QG-11a change-set lens review (security + architecture + testing, ≤12-month sources) returned 11 findings: 0 blocker, 4 should-fix (MUST FIX per the severity ladder), 4 nice-to-fix, 3 cosmetic. The security lens confirmed the shipped leak-vector guarantee already held (fail-closed, no injection, guards throw before signing); every finding hardens the guards so they *stay* correct. F8 and F10 are no-action (already-accepted decisions). Mapping of the implemented items to their code changes:

| Finding | Severity | Exact change that resolves it |
|---------|----------|-------------------------------|
| **F1** — guards not proven wired into `afterPack` | MUST FIX | Extracted the five #55 guard calls into an exported `verifyExtraContent(context, { bundleResources, extraFilesDir })` (`scripts/fuses.js`); `afterPack` calls it in place of the inline block. New `describe('verifyExtraContent (F1 wiring)')` plants a leak at each layer (L1 config-shape, L2a-1 leak-name, L2a-2 sibling, L2b extraFiles) and asserts the aggregate throws, so deleting any single guard call fails the required Unit-tests job; the binding test also asserts `typeof verifyExtraContent === 'function'`. |
| **F2** — leak-name net could be silently narrowed | MUST FIX | New membership binding test pins `REPO_ROOT_SENTINELS` and `SUSPICIOUS_SIBLING_NAMES` to expected literal arrays and asserts `EXTRA_CONTENT_LEAK_NAMES === [...REPO_ROOT_SENTINELS, ...SUSPICIOUS_SIBLING_NAMES]`. Removing `.env`/`id_rsa`/any name now fails CI. |
| **F3** — fail-closed `readDirOrThrow` path untested for the new guards | MUST FIX | Added chmod-0 fail-closed tests for `assertResourcesDestNoRepoLeak`, `assertResourcesSiblingsAllowlist`, and `assertExtraFilesDestNoRepoLeak` (mirroring the existing `assertPackagedAppContents` pattern; `it.skipIf(win32 || uid 0)`), each asserting `/could not be fully inspected/i`. A `catch { return [] }` silent-skip mutation now fails a test. |
| **F4** — no real coverage floor on the guard code | MUST FIX (full fix) | `vitest.main.ts`: moved the `coverage` block under `test.coverage` so the per-file thresholds fire (they were inert under a top-level `coverage` key); added `scripts/**/*.{js,mjs}` to `coverage.include` and a `scripts/fuses.js` floor (lines/statements 86, functions 88, branches 93 — met at 88.04/88.88/94.92). The move activated the previously-inert whisper floors; rather than weaken any, targeted tests raised each below-floor module to ≥ 90%: `verifyManifest.ts` branches 80.6→90.9 (malformed-pubkey skip + legacy signed-message branch), `secureDownloader.ts` branches 85.4→90.5 (invalid-URL + no-body fail-closed paths), `zipArchive.ts` lines/statements 86.4→100 (unopenable source + yauzl error event + per-entry rejection). No floor was lowered. |
| **F5** — artifact-layer backstop missed symlink-escape + `from`-rename | SHOULD FIX | Factored `assertPackagedAppContents`' pass-2 symlink-escape logic into a reusable `assertNoSymlinkEscape(startDir, root, { platform, allowedAbsoluteLinkRoots, relativeTo, label, skipTopLevel })` (no behavior change to `assertPackagedAppContents`); the three extra-content guards now call it (skipping the already-validated `app/`) so a symlink beside `app/` or at the extraFiles dest whose realpath escapes the bundle throws. Added `ALLOWED_EXTRA_RESOURCES_FROM` and an `allowedFrom` option to `assertExtraContentAllowlist`; `verifyExtraContent` passes it for extraResources, so a `from: src, to: tessdata` rename INTO an allowlisted dest throws at pack time. L2a docstrings updated to record the now-closed residual. Tests cover symlink-escape positive/negative per guard and the from-rename rejection. |
| **F6** — misleading `.js` no-throw test | SHOULD FIX | The standard-layout test now seeds a real `.js` at the app's genuine location (`(Resources\|resources)/app/out/main/index.js`, depth ≥3, beyond `MAX_DEPTH=2`) and asserts it is tolerated — so a walk that over-fires by descending past the depth bound fails the test. (Note: the plan's "depth-≤2" wording was adjusted to depth ≥3 — a depth-≤2 `.js` would simply throw and duplicate the existing F3 renamed-copy test; the design already states the app's JS lives at depth ≥3.) |
| **F7** — missing fail-closed input-branch tests | SHOULD FIX | Added throw-asserting L1 cases: `{from:'LICENSE',to:42}` (non-string `to`), `{from:'LICENSE',to:'./'}` (dest root), `[null]`, and `[['x']]`. |
| **F8** — Windows L2a-2 advisory | no action | Already-approved F2 decision, tracked as technical-debt #14 (promote to fatal once a real Windows packed-tree baseline exists). |
| **F9** — CI grep missed inline-YAML `extraFiles` | TECH DEBT | The `checks.yml` §6a guard now matches both the block form (`^[[:space:]]*extraFiles[[:space:]]*:`) and the inline flow form (`[{,][[:space:]]*extraFiles[[:space:]]*:`, e.g. `mac: { extraFiles: [...] }`). Verified with `bash guard.sh` on mutated copies (inline + indented block both exit non-zero; the real config exits zero). The binding test remains the authoritative gate. |
| **F10** — L2b narrow by design | no change | The `MAX_DEPTH=2` + source-extension tripwire is a documented coarse backstop; L1's empty allowlist is the load-bearing control. |
| **F11** — packed resources dir resolved 4× | TECH DEBT | `afterPack` resolves `packedResourcesDir` once and reuses it across prune / spawn-helper / media / packaged-contents / extra-content; the win32-null policy is branched only at the spawn-helper call site. No behavior change. |

## 13. QG-6/7/8 re-review closure (F1′ / F4′ / LOW)

The QG-11a remediations above were re-reviewed (QG-6/7/8). Two MUST-FIX residuals and three LOW items remained; all are now closed.

| Finding | Severity | Exact change that resolves it |
|---------|----------|-------------------------------|
| **F1′** — wiring test proved the export, not the call site | MEDIUM | The binding test asserted only `typeof verifyExtraContent === 'function'`, so deleting the `verifyExtraContent(context, …)` line from `afterPack` stayed green. Added a **source-reference assertion** in `scripts/fuses.test.mjs` (`agrees with the repository electron-builder.yml as shipped`): it reads `scripts/fuses.js`, slices the `afterPack` function body (`async function afterPack(` → `module.exports = afterPack;`), and asserts it matches `/verifyExtraContent\s*\(\s*context/`. Deleting the call now fails the required Unit-tests job. The overclaiming comment on the `typeof` assertion was corrected to describe export **+** call-site checks. |
| **F4′** — coverage floor not gated in required CI | MEDIUM | The `scripts/fuses.js` (and whisper) per-file floors fire only under `--coverage`; the required `test` job runs `test:ci` with no coverage, so they were enforced only by a local `npm run test:cov`. Added a **`Coverage` job** to `.github/workflows/checks.yml` running `npx vitest --run --config vitest.main.ts --project main --coverage` (composite `setup-node-with-retry` for the `npm ci` retry + allowlisted postinstall; `ubuntu-latest`; Title Case display name). vitest exits non-zero on a threshold miss, so a breached floor fails the job. **Double-row determinism:** the two-row `scripts/fuses.js` artifact (a synthetic 0% row spanning the whole file alongside the real ~88% row) is the classic v8 `all: true` baseline emitted for an included-but-untested file; `vitest.main.ts` already sets `all: false` (which suppresses it), and the job additionally scopes to `--project main` so only the main suite — which executes `scripts/fuses.js` via `scripts/fuses.test.mjs` — is instrumented, yielding exactly one `fuses.js` row. Verified across repeated local runs (single row at 88.04% lines / 88.88% functions / 94.92% branches; threshold miss reproduced and observed to exit 1). No floor was lowered. Promotion of `Coverage` into the branch-protection required set is a repo-admin `gh api` step handled separately. Documented in `docs/ci.md`. |
| **LOW** — duplicated resources-dir symlink walk | LOW | `assertResourcesDestNoRepoLeak` (L2a-1) and `assertResourcesSiblingsAllowlist` (L2a-2) each ran the identical `assertNoSymlinkEscape` walk over the resources dir. Both now accept `{ skipSymlinkCheck }`; `verifyExtraContent` runs **one** hoisted `assertNoSymlinkEscape` over `bundleResources` and passes `skipSymlinkCheck: true` to both sub-guards. Standalone unit-test callers leave it false and still exercise the walk, so per-guard escape coverage is unchanged; a new `verifyExtraContent` test proves the hoisted walk still fails closed on an escaping sibling symlink. Behavior preserved (an escape still throws). |
| **LOW** — weak assertions | LOW | `scripts/fuses.test.mjs` `it.each(['.', '', '/'])('rejects a to of …')` gained a specific matcher (`/destination root\|escapes the destination/i`, covering both the dest-root and absolute-path branches); `src/main/utils/zipArchive.test.ts` `fails closed when the source zip cannot be opened` tightened `.rejects.toBeTruthy()` → `.rejects.toThrow(/ENOENT/)`. |
| **LOW** — inline empty allowlist in test | LOW | The L1 describe's `F` fixture now uses the exported `ALLOWED_EXTRA_FILES_DESTS` instead of an inline `[]`, so the reject-all (F7) contract test notices if that constant is ever populated. |

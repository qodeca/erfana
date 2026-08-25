// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Electron `afterPack` Hook
 *
 * Single entry point for electron-builder's afterPack lifecycle stage.
 * Runs once per packaged target, before code-signing (lifecycle:
 * afterPack → electron-builder signing → afterSign → DMG/ZIP).
 *
 * Responsibilities:
 *   1. Restore node-pty's spawn-helper execute bit (Unix only).
 *      See chmodNodePtySpawnHelper below for the bug it works around.
 *   2. Flip Electron security fuses (compile-time feature toggles that
 *      disable unused Electron features to prevent "Living Off The
 *      Land" attacks). 2025 security hardening best practices.
 *   3. Optionally rename the app bundle for test builds (visual
 *      differentiation; test builds enable the Node CLI inspector).
 *   4. Assert the packed `app/` tree matches the electron-builder.yml
 *      `files:` allowlist, before signing (issue #43).
 *
 * Build Modes:
 * - Production (default): All security fuses enabled, inspector disabled
 * - Test build: Inspector enabled for Playwright E2E testing
 *   - App name includes "(TEST BUILD)" suffix
 *   - Build artifacts placed in release/test/ directory
 *   - Prominent warnings displayed during build
 *
 * Usage:
 *   Production build:  npm run build:mac
 *   Test build:        ERFANA_TEST_BUILD=true npm run build:mac
 *
 * References:
 * - https://www.electronjs.org/docs/latest/tutorial/fuses
 * - https://www.druva.com/blog/living-off-the-land-lotl-attack-due-to-electron-fuses-misconfiguration
 */

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const { Arch } = require('electron-builder');
const path = require('path');
const fs = require('fs');
// Shared with the beforePack hook so the size floor + integrity pins + cache
// location have a single source of truth.
const {
  verifyBinary,
  MEDIA_BINARY_MIN_BYTES,
  FFMPEG_SHA256,
  CACHE_ROOT,
} = require('./ensure-media-binaries.js');

/**
 * POSIX mode bits applied to node-pty's spawn-helper. 0755 = rwxr-xr-x
 * matches what node-gyp emits at build/Release/spawn-helper in dev mode.
 */
const SPAWN_HELPER_MODE = 0o755;

/**
 * Check if this is a test build.
 * Test builds enable the Node CLI inspector for Playwright E2E testing.
 * SECURITY NOTE: Test builds should NEVER be distributed to end users.
 */
const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';

/**
 * Display prominent warning about test build distribution.
 * Called multiple times to ensure visibility in build logs.
 */
function displayTestBuildWarning() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                    ⚠️  TEST BUILD WARNING ⚠️                       ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║  This build has EnableNodeCliInspectArguments ENABLED.           ║');
  console.log('║  The --inspect flag allows remote debugging access.              ║');
  console.log('║                                                                  ║');
  console.log('║  DO NOT DISTRIBUTE THIS BUILD TO END USERS.                      ║');
  console.log('║  Use only for E2E testing with Playwright.                       ║');
  console.log('║                                                                  ║');
  console.log('║  For production builds, run:                                     ║');
  console.log('║    npm run build:mac                                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
}

/**
 * Restore the executable bit on node-pty's spawn-helper binaries.
 *
 * Why: electron-builder copies prebuilt node-pty binaries with the
 * permissions npm assigned when extracting the tarball. spawn-helper is
 * not listed in node-pty's package.json "bin" field, so npm strips its
 * execute bit (file mode ends up at 0644). With `npmRebuild: false` in
 * electron-builder.yml the source rebuild that would have produced an
 * executable copy under build/Release/ never runs, so node-pty's
 * loadNativeModule falls through to prebuilds/<platform-arch>/ — and
 * pty.fork() then calls posix_spawnp(spawn-helper) against an un-
 * executable file, which the kernel rejects with EACCES. Production
 * users see "Error: posix_spawnp failed." every time they open a
 * project; dev never hits this because electron-vite rebuilds node-pty
 * via node-gyp and writes spawn-helper to build/Release/ at 0755.
 *
 * Symlink guard: `fs.chmodSync` follows symlinks. A compromised dep
 * could theoretically replace spawn-helper with a symlink pointing
 * outside the bundle; we refuse to chmod through that.
 *
 * @param {string} resourcesDir - Directory containing `app/node_modules/`
 *   (e.g. `<bundle>/Contents/Resources` on macOS,
 *   `<appOutDir>/resources` on Linux).
 * @param {object} [options]
 * @param {boolean} [options.requireMatch=false] - When true, throws if no
 *   spawn-helper binaries are found. Caller passes `true` on platforms
 *   where a missing helper means the build would ship broken.
 * @returns {{ chmodCount: number, skipped: number }} - Counts of chmoded
 *   files and skipped (symlink / non-file) entries.
 * @throws {Error} If any chmod fails, or if `requireMatch` is set and
 *   no helpers were found.
 */
function chmodNodePtySpawnHelper(resourcesDir, { requireMatch = false } = {}) {
  const prebuildsDir = path.join(
    resourcesDir,
    'app',
    'node_modules',
    'node-pty',
    'prebuilds'
  );

  if (!fs.existsSync(prebuildsDir)) {
    console.warn(`⚠️  node-pty prebuilds not found at ${prebuildsDir} — skipping spawn-helper chmod`);
    return { chmodCount: 0, skipped: 0 };
  }

  let chmodCount = 0;
  let skipped = 0;
  const failures = [];

  for (const entry of fs.readdirSync(prebuildsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const helperPath = path.join(prebuildsDir, entry.name, 'spawn-helper');

    let st;
    try {
      st = fs.lstatSync(helperPath);
    } catch {
      // Missing file (ENOENT) is fine — not every arch ships spawn-helper.
      continue;
    }

    if (st.isSymbolicLink() || !st.isFile()) {
      console.warn(
        `⚠️  Refusing to chmod non-regular file: ${helperPath} ` +
        `(symlink=${st.isSymbolicLink()}, file=${st.isFile()})`
      );
      skipped++;
      continue;
    }

    try {
      fs.chmodSync(helperPath, SPAWN_HELPER_MODE);
      console.log(`   chmod 0755 ${path.relative(resourcesDir, helperPath)}`);
      chmodCount++;
    } catch (err) {
      failures.push({ path: helperPath, code: err.code, message: err.message });
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to chmod ${failures.length} spawn-helper binary(ies):\n` +
      failures.map((f) => `  ${f.path} (${f.code}): ${f.message}`).join('\n')
    );
  }
  if (chmodCount === 0 && requireMatch) {
    throw new Error(
      `No spawn-helper binaries found under ${prebuildsDir}. ` +
      `Refusing to ship a broken bundle.`
    );
  }
  if (chmodCount === 0) {
    console.warn(`⚠️  No spawn-helper binaries under ${prebuildsDir}`);
  }

  return { chmodCount, skipped };
}

/**
 * Place the correct-arch ffmpeg into THIS pack's bundle and restore the execute
 * bit on the packed ffmpeg + ffprobe-static binaries.
 *
 * beforePack (scripts/ensure-media-binaries.js) caches each target arch's
 * ffmpeg-static binary under CACHE_ROOT, size- and SHA-256-verified. Here we
 * copy the arch matching this pack over the bundle's
 * `node_modules/ffmpeg-static/ffmpeg` (electron-builder copied the host arch in
 * for both bundles), re-verify, and chmod. So each dmg ships exactly its own
 * current, integrity-checked ffmpeg — no foreign-arch bloat, no network here,
 * and a build that lacks the correct binary fails loudly instead of shipping a
 * `spawn … ffmpeg ENOENT` regression.
 *
 * @param {string} resourcesDir - dir containing `app/node_modules`
 * @param {string} platform - context.electronPlatformName ('darwin'|'linux'|'win32')
 * @param {number} archEnum - electron-builder Arch enum value (context.arch)
 * @param {object} [options]
 * @param {boolean} [options.requireMatch=false] - throw if the cached binary is absent
 */
function ensurePackedMediaBinaries(resourcesDir, platform, archEnum, { requireMatch = false } = {}) {
  const arch = Arch[archEnum]; // 'ia32' | 'x64' | 'armv7l' | 'arm64' | 'universal'
  if (arch === 'universal' || arch === 'armv7l' || arch === 'ia32') {
    // ffmpeg-static publishes x64 / arm64 builds; these targets are not shipped.
    if (requireMatch) {
      throw new Error(`ensurePackedMediaBinaries: unsupported ffmpeg target arch '${arch}'`);
    }
    console.warn(`⚠️  arch '${arch}' is not a supported ffmpeg target — skipping`);
    return;
  }

  const key = `${platform}-${arch}`;
  const binName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const cached = path.join(CACHE_ROOT, key, binName);
  const dest = path.join(resourcesDir, 'app', 'node_modules', 'ffmpeg-static', binName);

  if (!fs.existsSync(cached)) {
    if (requireMatch) {
      throw new Error(`Cached ffmpeg missing for ${key} at ${cached}. Did beforePack run?`);
    }
    console.warn(`⚠️  No cached ffmpeg for ${key} (cross-platform pack?) — skipping`);
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(cached, dest);
  verifyBinary(dest, key, MEDIA_BINARY_MIN_BYTES, FFMPEG_SHA256[key]);

  // Restore execute bits (Unix). Windows ignores POSIX modes.
  if (platform !== 'win32') {
    fs.chmodSync(dest, SPAWN_HELPER_MODE);
    console.log(`   chmod 0755 ${path.relative(resourcesDir, dest)}`);

    const probeRoot = path.join(resourcesDir, 'app', 'node_modules', 'ffprobe-static', 'bin');
    if (fs.existsSync(probeRoot)) {
      const stack = [probeRoot];
      while (stack.length) {
        const dir = stack.pop();
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            stack.push(full);
          } else if (entry.name === 'ffprobe' && !fs.lstatSync(full).isSymbolicLink()) {
            // Intentional symlink skip: never chmod through a symlink (could
            // point outside the bundle — defence in depth).
            fs.chmodSync(full, SPAWN_HELPER_MODE);
          }
        }
      }
    }
  }
  console.log(`✅ Packed media binaries verified (${key})`);
}

/**
 * Delete foreign-platform/arch ffprobe-static binaries from the packed bundle.
 *
 * ffprobe-static vendors a binary for every platform/arch under
 * `node_modules/ffprobe-static/bin/<plat>/<arch>` (darwin, linux, win32 ×
 * x64/arm64/ia32 — ~335 MB total). A single-arch bundle only ever resolves its
 * own (ffprobe-static/index.js uses `os.platform()`/`os.arch()`), so the other
 * binaries are dead weight (~260 MB on a mac build). Delete every `<plat>/<arch>`
 * except the build target, then verify the target survived (keep-then-verify).
 *
 * Runs in afterPack (before signing) so the pruned tree is what gets signed.
 *
 * @param {string} resourcesDir - dir containing `app/node_modules`
 * @param {string} platform - context.electronPlatformName ('darwin'|'linux'|'win32')
 * @param {number} archEnum - electron-builder Arch enum value (context.arch)
 * @param {object} [options]
 * @param {boolean} [options.requireMatch=false] - throw if the target binary is absent
 */
function pruneForeignFfprobeBinaries(resourcesDir, platform, archEnum, { requireMatch = false } = {}) {
  const arch = Arch[archEnum];
  if (arch === 'armv7l') {
    console.warn(`⚠️  ffprobe prune: arch '${arch}' is not a shipped target — skipping`);
    return;
  }
  // 'universal' (a possible future multi-arch mac target) cannot narrow the arch,
  // but we still drop foreign *platforms* so the universal bundle is not re-bloated.
  const narrowArch = arch !== 'universal';

  const probeRoot = path.join(resourcesDir, 'app', 'node_modules', 'ffprobe-static', 'bin');
  if (!fs.existsSync(probeRoot)) {
    console.warn(`⚠️  ffprobe-static/bin not found at ${probeRoot} — skipping prune`);
    return;
  }

  const binName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  let removed = 0;

  for (const platEntry of fs.readdirSync(probeRoot, { withFileTypes: true })) {
    // isDirectory() is false for a directory symlink (lstat semantics), so a
    // symlinked entry is skipped here and never deleted-through — same bar as
    // the sibling spawn-helper/ffprobe chmod code.
    if (!platEntry.isDirectory() || platEntry.isSymbolicLink()) continue;
    const platDir = path.join(probeRoot, platEntry.name);
    if (platEntry.name !== platform) {
      // Foreign platform — drop the whole tree.
      fs.rmSync(platDir, { recursive: true, force: true });
      removed++;
      continue;
    }
    if (!narrowArch) continue; // universal: keep every arch of the target platform
    // Target platform — keep only the target arch subdir.
    for (const archEntry of fs.readdirSync(platDir, { withFileTypes: true })) {
      if (!archEntry.isDirectory() || archEntry.isSymbolicLink() || archEntry.name === arch) continue;
      fs.rmSync(path.join(platDir, archEntry.name), { recursive: true, force: true });
      removed++;
    }
  }

  // Keep-then-verify: a usable ffprobe for the target MUST survive the prune.
  const platDir = path.join(probeRoot, platform);
  const survived = narrowArch
    ? fs.existsSync(path.join(platDir, arch, binName))
    : fs.existsSync(platDir) && fs.readdirSync(platDir).length > 0;
  if (!survived) {
    if (requireMatch) {
      throw new Error(
        `ffprobe prune left no usable binary for ${platform}/${narrowArch ? arch : '*'}. ` +
        `Refusing to ship a bundle with no ffprobe.`
      );
    }
    console.warn(`⚠️  ffprobe target for ${platform} absent after prune (cross-platform pack?)`);
    return;
  }
  console.log(`✅ Pruned ${removed} foreign ffprobe path(s); kept ${platform}/${narrowArch ? arch : '*'}`);
}

/**
 * Delete foreign-platform/arch node-pty prebuilds from the packed bundle.
 *
 * node-pty ships `prebuilds/<platform>-<arch>` for every supported target; a
 * single-arch bundle loads only its own (node-pty resolves
 * `process.platform-process.arch`). The Windows prebuilds are large (~28–30 MB
 * each, dominated by `.pdb`). Delete every prebuild dir except the build target,
 * then verify the target survived. On a `win32` target, also strip `.pdb` debug
 * symbols from the kept prebuild (not loaded at runtime). Runs before
 * chmodNodePtySpawnHelper so only the target spawn-helper is chmoded.
 *
 * @param {string} resourcesDir - dir containing `app/node_modules`
 * @param {string} platform - context.electronPlatformName ('darwin'|'linux'|'win32')
 * @param {number} archEnum - electron-builder Arch enum value (context.arch)
 * @param {object} [options]
 * @param {boolean} [options.requireMatch=false] - throw if the target prebuild is absent
 */
function pruneForeignNodePtyPrebuilds(resourcesDir, platform, archEnum, { requireMatch = false } = {}) {
  const arch = Arch[archEnum];
  if (arch === 'armv7l') {
    console.warn(`⚠️  node-pty prune: arch '${arch}' is not a shipped target — skipping`);
    return;
  }
  // 'universal' keeps every arch of the target platform ('<platform>-*'); a
  // narrow build keeps exactly '<platform>-<arch>'.
  const narrowArch = arch !== 'universal';

  const prebuildsDir = path.join(resourcesDir, 'app', 'node_modules', 'node-pty', 'prebuilds');
  if (!fs.existsSync(prebuildsDir)) {
    console.warn(`⚠️  node-pty prebuilds not found at ${prebuildsDir} — skipping prune`);
    return;
  }

  const keep = (name) =>
    narrowArch ? name === `${platform}-${arch}` : name.startsWith(`${platform}-`);
  let removed = 0;

  for (const entry of fs.readdirSync(prebuildsDir, { withFileTypes: true })) {
    // Directory symlinks report isDirectory() === false (lstat semantics) and
    // are skipped — never deleted-through.
    if (!entry.isDirectory() || entry.isSymbolicLink() || keep(entry.name)) continue;
    fs.rmSync(path.join(prebuildsDir, entry.name), { recursive: true, force: true });
    removed++;
  }

  // Keep-then-verify: a target prebuild MUST survive the prune.
  const kept = fs.readdirSync(prebuildsDir).filter(keep);
  if (kept.length === 0) {
    if (requireMatch) {
      throw new Error(
        `node-pty prune left no prebuild for ${platform}-${narrowArch ? arch : '*'}. ` +
        `Refusing to ship a broken bundle.`
      );
    }
    console.warn(`⚠️  node-pty target for ${platform} absent after prune (cross-platform pack?)`);
    return;
  }

  // Windows-only in-arch trim: strip .pdb debug symbols from the kept prebuild(s).
  // PDBs are never loaded at runtime (node-pty loads pty.node + the .dll/.exe
  // helpers), so deleting them shrinks the installer with no behavior change.
  // Keep-then-verify: the pty.node addon must survive the strip.
  let pdbRemoved = 0;
  if (platform === 'win32') {
    for (const name of kept) {
      const root = path.join(prebuildsDir, name);
      let hasAddon = false;
      const stack = [root];
      while (stack.length) {
        const dir = stack.pop();
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          if (f.isSymbolicLink()) continue;
          const full = path.join(dir, f.name);
          if (f.isDirectory()) {
            stack.push(full);
          } else if (f.name.toLowerCase().endsWith('.pdb')) {
            fs.rmSync(full, { force: true });
            pdbRemoved++;
          } else if (f.name === 'pty.node') {
            hasAddon = true;
          }
        }
      }
      if (!hasAddon && requireMatch) {
        throw new Error(`node-pty .pdb strip: pty.node missing under ${root}. Aborting.`);
      }
    }
  }

  const pdbNote = pdbRemoved ? `, stripped ${pdbRemoved} .pdb` : '';
  console.log(`✅ Pruned ${removed} foreign node-pty prebuild(s); kept ${kept.join(', ')}${pdbNote}`);
}

/**
 * Rename app bundle to include test suffix for visual differentiation.
 * This helps prevent accidental distribution of test builds.
 *
 * @param {string} appOutDir - Directory containing the built app
 * @param {string} originalName - Original app filename (e.g., "Erfana.app")
 * @param {string} platform - Target platform (darwin, win32, linux)
 * @returns {string} New app path after renaming
 */
function renameTestBuildApp(appOutDir, originalName, platform) {
  const ext = { darwin: '.app', win32: '.exe', linux: '' }[platform];
  const baseName = originalName.replace(ext, '');
  const testName = `${baseName} (TEST BUILD)${ext}`;

  const originalPath = path.join(appOutDir, originalName);
  const testPath = path.join(appOutDir, testName);

  if (fs.existsSync(originalPath)) {
    fs.renameSync(originalPath, testPath);
    console.log(`   Renamed app: ${originalName} → ${testName}`);
    return testPath;
  }

  return originalPath;
}

// ---------------------------------------------------------------------------
// Packaged-contents allowlist (issue #43)
// ---------------------------------------------------------------------------

/**
 * Entries electron-builder places under `app/` regardless of the `files:`
 * patterns — `package.json` and the production `node_modules` tree are added
 * unconditionally by app-builder-lib.
 */
const TOOL_INVARIANT_APP_ENTRIES = Object.freeze(['node_modules', 'package.json']);

/**
 * Top-level entries permitted directly under `<resources>/app/`.
 *
 * Mirrors the positive patterns in electron-builder.yml `files:` plus the tool
 * invariants above. This constant is the walk's authority; the set derived from
 * the config (deriveAllowedAppEntries) is compared against it rather than
 * substituted for it, because a guard that takes its expectations from the
 * artifact it guards proves only self-consistency — a negation-only `files:`
 * list derives nothing and would have "matched" the issue #43 regression.
 */
const ALLOWED_APP_ENTRIES = Object.freeze(['node_modules', 'out', 'package.json']);

/** Positive patterns that re-create the implicit repository-root sweep. */
const ALL_MATCHING_PATTERNS = Object.freeze(['*', '**', '**/*', './**', '.']);

/** Absolute symlink targets Gatekeeper permits a bundle to point at (TN2206). */
const ALLOWED_ABSOLUTE_LINK_ROOTS = Object.freeze(['/System', '/Library']);

// ---------------------------------------------------------------------------
// Extra-content allowlists (issue #55) — extraResources / extraFiles guards
// ---------------------------------------------------------------------------

/**
 * Permitted top-level `to:` destinations for `extraResources` (copies that land
 * BESIDE `app/`, i.e. `Contents/Resources/` on macOS, `resources/` on Windows).
 *
 * This is the EXHAUSTIVE allowlist at the CONFIG layer only. L1
 * (assertExtraContentAllowlist) rejects any `extraResources` FileSet whose
 * destination is not in this set — that is where "permitted destinations are
 * exactly this list" holds.
 *
 * At the ARTIFACT layer it is NOT re-enforced exhaustively. L2a-1
 * (assertResourcesDestNoRepoLeak) is a sentinel/leak-name TRIPWIRE, not an
 * allowlist walk: it fatally rejects a sibling beside `app/` whose top-level
 * name is a known repo-structure sentinel or a known secret/exfil leak-name AND
 * is not in this allowlist. The full-sibling allowlist walk (L2a-2,
 * assertResourcesSiblingsAllowlist) is fatal on macOS but only advisory on
 * win32 pending a Windows packed-tree baseline. So the accepted residual: a
 * config-injected sibling whose top-level name is neither an allowlisted dest
 * nor a known leak-name is fatal only at L1 (config layer); at the artifact
 * layer on win32 it is advisory (L2a-2) pending the Windows baseline.
 *
 * Coupled to electron-builder.yml's `extraResources:` block and the binding test
 * in scripts/fuses.test.mjs; all three must change together.
 */
const ALLOWED_EXTRA_RESOURCES_DESTS = Object.freeze([
  'tessdata', 'LICENSE', 'THIRD-PARTY-LICENSES.md',
]);

/**
 * Permitted `from:` sources for `extraResources` entries (issue #55, F5).
 *
 * The dest allowlist (ALLOWED_EXTRA_RESOURCES_DESTS) only constrains where a copy
 * LANDS; on its own it would still accept `from: src, to: tessdata`, smuggling
 * source into an allowlisted dest. Binding the `from` side at RUNTIME (not just in
 * the test-layer binding) closes that rename residual: assertExtraContentAllowlist
 * rejects any extraResources entry whose normalised `from` is not in this set, so
 * the leak fails at pack time before signing. Coupled to electron-builder.yml's
 * `extraResources:` block and the binding test; all three change together.
 */
const ALLOWED_EXTRA_RESOURCES_FROM = Object.freeze([
  'resources/tessdata', 'LICENSE', 'THIRD-PARTY-LICENSES.md',
]);

/**
 * Permitted top-level `to:` destinations for `extraFiles` (copies that land
 * ABOVE `Resources/`, i.e. `Contents/` on macOS, the app output root beside the
 * `.exe` on Windows).
 *
 * EMPTY = fail-closed: nothing is permitted to land at the extraFiles dest
 * today, and `extraFiles:` is deliberately absent from electron-builder.yml. An
 * EMPTY allowlist means "reject ALL entries" — semantically distinct from
 * "nothing configured" (extraFiles absent), which is accepted. See
 * assertExtraContentAllowlist (F7).
 */
const ALLOWED_EXTRA_FILES_DESTS = Object.freeze([]);

/**
 * Fixed Electron-owned sibling names that appear beside `app/` in the packed
 * resources dir. Platform-variant superset (icon.icns is macOS-only,
 * elevate.exe is the NSIS elevator on Windows); `*.lproj` localisation folders
 * are matched by pattern, not listed here.
 */
const ELECTRON_OWNED_RESOURCES_ENTRIES = Object.freeze([
  'app', 'app.asar', 'icon.icns', 'elevate.exe',
]);

/**
 * L2a-2 full-sibling allow-set for the resources dest. DERIVED as the union of
 * the config slots and the Electron-owned names so the subset relation
 * ALLOWED_EXTRA_RESOURCES_DESTS ⊆ EXPECTED_RESOURCES_ENTRIES holds structurally
 * (F5); a drift test in scripts/fuses.test.mjs also asserts it. Enforced by
 * assertResourcesSiblingsAllowlist: fatal on macOS, advisory (console.warn) on
 * win32 until a real Windows packed-tree baseline is captured (F2).
 */
const EXPECTED_RESOURCES_ENTRIES = Object.freeze([
  ...ALLOWED_EXTRA_RESOURCES_DESTS,
  ...ELECTRON_OWNED_RESOURCES_ENTRIES,
]);

/**
 * Repository-root names that must NEVER appear at an extra-content destination.
 *
 * These are the unambiguous #43-class leak signals: a repo-root artifact landing
 * beside/above `app/` means the repository (or part of it) was shipped.
 * Deliberately EXCLUDES `resources` (the Windows output root legitimately holds
 * a `resources/` dir), `LICENSE` / `THIRD-PARTY-LICENSES.md` (legitimately
 * shipped) and `out` (the build output). `node_modules` is safe as a sentinel
 * AT THESE DESTINATIONS because production `node_modules` lands inside `app/`,
 * never at `Contents/`/the output root or beside `app/` in resources.
 */
const REPO_ROOT_SENTINELS = Object.freeze([
  'package.json', 'package-lock.json', '.git', 'node_modules', 'src', 'specs',
  'scripts', 'docs', 'e2e', '.github', 'electron-builder.yml', 'CLAUDE.md',
  'tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json',
]);

/**
 * Known secret/exfil leak-names that must NEVER appear at an extra-content
 * destination.
 *
 * REPO_ROOT_SENTINELS catches the repository STRUCTURE landing beside/above
 * `app/`; this set catches the realistic EXFIL TARGET a config-injection would
 * aim for — a secret store renamed to something innocuous is still named like a
 * secret. None of these is part of Electron's runtime layout at an extra-content
 * dest, so any sibling with one of these top-level names is an unambiguous leak
 * signal. Combined with REPO_ROOT_SENTINELS by the L2a-1 tripwire and fatal on
 * BOTH platforms.
 */
const SUSPICIOUS_SIBLING_NAMES = Object.freeze([
  'secrets', 'secret', 'credentials', 'creds', '.env', '.env.local',
  '.npmrc', '.aws', '.ssh', 'api-keys', 'apikeys', 'private', 'id_rsa',
]);

/**
 * Combined fatal-on-both-platforms leak-name net for the extra-content
 * destinations: repository-structure sentinels ∪ known secret/exfil leak-names.
 * Any sibling whose top-level name is in this set — and is not an allowlisted
 * dest — is a fatal leak signal on every platform (L2a-1).
 */
const EXTRA_CONTENT_LEAK_NAMES = Object.freeze([
  ...REPO_ROOT_SENTINELS,
  ...SUSPICIOUS_SIBLING_NAMES,
]);

/**
 * Source-code file extensions that must never land at the extraFiles dest.
 *
 * L2b's coarse "any config content here is forbidden by L1" tripwire (F3):
 * because ALLOWED_EXTRA_FILES_DESTS is empty, ANY config-originated population
 * at the extraFiles dest is a leak. Electron's runtime layout at the top levels
 * L2b walks (MAX_DEPTH=2) is binaries / data / markup (.exe, .dll, .pak, .bin,
 * .dat, .html, .plist, no-extension Mach-O) — it carries no `.js`/`.cjs`/`.mjs`
 * at those levels (the app's own JavaScript lives inside `app/out/`, at depth
 * ≥3), so a file with one of these extensions is a renamed-copy leak L1 must
 * have already rejected. This NARROWS the renamed-file evasion — it catches
 * source-extension renames only, not an arbitrary rename to a binary extension;
 * the real guarantee is L1.
 */
const REPO_SOURCE_EXTENSIONS = Object.freeze([
  '.ts', '.tsx', '.jsx', '.mts', '.cts', '.js', '.cjs', '.mjs',
]);

/**
 * Directory containing the packed `app/` tree, per platform.
 *
 * Returns null for an unrecognised platform; each caller decides whether that
 * is a skip (a platform-specific fix) or a failure (an unconditional guard).
 */
function resolvePackedResourcesDir(electronPlatformName, appOutDir, electronBinaryPath) {
  switch (electronPlatformName) {
    case 'darwin':
      return path.join(electronBinaryPath, 'Contents', 'Resources');
    case 'linux':
    case 'win32':
      return path.join(appOutDir, 'resources');
    default:
      return null;
  }
}

/**
 * Directory where `extraFiles` lands, per platform: `Contents/` on macOS, the
 * app output root (beside the executable) on Windows/Linux.
 *
 * Returns null for an unrecognised platform so the caller fails closed.
 *
 * @param {string} electronPlatformName 'darwin' | 'win32' | 'linux'
 * @param {string} appOutDir the packaged output directory (beside the binary)
 * @param {string} electronBinaryPath path to the packaged app binary/bundle
 * @returns {string | null}
 */
function resolveExtraFilesDir(electronPlatformName, appOutDir, electronBinaryPath) {
  switch (electronPlatformName) {
    case 'darwin':
      return path.join(electronBinaryPath, 'Contents');
    case 'linux':
    case 'win32':
      return appOutDir;
    default:
      return null;
  }
}

/**
 * Union the top-level extra-content config with its platform-scoped sibling,
 * mirroring the existing `files:` fold in assertConfigMatchesAllowlist.
 *
 * app-builder-lib merges the active platform's `mac:`/`win:` block into effect
 * at build time, so a guard that reads only `context.packager.config.extra*`
 * misses `--config.win.extra*` / `--config.mac.extra*` overrides (F1). Callers
 * pass BOTH the top-level and the platformSpecificBuildOptions value here.
 *
 * @param {unknown} topLevel context.packager.config.extra{Files,Resources}
 * @param {unknown} platform context.packager.platformSpecificBuildOptions.extra{Files,Resources}
 * @returns {unknown[]} concatenated FileSet entries (each still unnormalised)
 */
function mergeExtraContent(topLevel, platform) {
  return [...toPatternArray(topLevel), ...toPatternArray(platform)];
}

/**
 * L1 — validate the SHAPE of a merged extraFiles/extraResources config and
 * return the destination segments it accepts. Callers pass the MERGED
 * (top-level ∪ platform-scoped) value via mergeExtraContent, so this sees
 * `--config.*` AND `--config.win.*` / `--config.mac.*` overrides (F1). Fails
 * CLOSED on any shape it cannot map, so a normalisation surprise errs toward
 * blocking rather than leaking.
 *
 * @param {unknown[]} extraContent merged FileSet list (from mergeExtraContent)
 * @param {{kind: 'extraFiles' | 'extraResources', allowedDests: readonly string[],
 *   allowedFrom?: readonly string[] | null}} opts when `allowedFrom` is supplied
 *   (extraResources at runtime), each entry's `from` must also be an allowlisted
 *   source, so a `from: src, to: tessdata` rename into an allowed dest throws (F5).
 * @returns {string[]} the sorted set of accepted destination segments
 * @throws when:
 *   - allowedDests is empty AND the merged content has ANY entry
 *     (explicit empty-allowlist = reject-all, distinct from nothing configured; F7);
 *   - a FileSet has `to === undefined` or is a bare string (the native
 *     defaulting form is NOT modelled — fail closed with /cannot map/; F8);
 *   - a root-sweep `from` ('.', '', './') or a `..`-escaping / absolute `from`;
 *   - a `to` that is '', '.', '/', absolute, `..`-escaping, or whose first
 *     segment is NOT in allowedDests;
 *   - any other FileSet shape it cannot reason about (/cannot map/).
 */
function assertExtraContentAllowlist(extraContent, { kind, allowedDests, allowedFrom = null }) {
  const entries = toPatternArray(extraContent);

  // F7 — an EMPTY allowlist means "reject ALL entries", which is NOT the same as
  // "nothing configured". Nothing configured (no entries) is accepted; any entry
  // against an empty allowlist is rejected before any shape reasoning.
  if (allowedDests.length === 0) {
    if (entries.length > 0) {
      throw new Error(
        `electron-builder '${kind}:' has ${entries.length} entr(y/ies) but nothing is permitted at ` +
        `its destination (the allowlist is empty). '${kind}:' must be absent (issue #55). ` +
        `Refusing to ship a bundle that copies content there.`
      );
    }
    return [];
  }

  const dests = new Set();
  for (const entry of entries) {
    // Bare strings and non-objects are the native defaulting forms (where `to`
    // is derived from `from`); they are deliberately unmodelled → fail closed.
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(
        `electron-builder '${kind}:' contains an entry this guard cannot map to a destination ` +
        `(${JSON.stringify(entry)}). Update assertExtraContentAllowlist in scripts/fuses.js before ` +
        `shipping it (issue #55).`
      );
    }

    // Validate `from` FIRST so a root-sweep/escaping source is reported as such
    // even when `to` is also invalid or absent.
    const { from, to } = entry;
    if (typeof from === 'string') {
      const normFrom = path.posix.normalize(from.replace(/^\.\//, ''));
      // '.', '' and './' all normalize to '.', so normFrom === '.' subsumes
      // them; path.posix.normalize never returns '', so no empty-string case.
      if (normFrom === '.') {
        throw new Error(
          `electron-builder '${kind}:' entry copies from a root sweep ('${from}'), which packages the ` +
          `whole tree (issue #55). Refusing to ship a bundle built from it.`
        );
      }
      if (normFrom.startsWith('..') || path.posix.isAbsolute(from)) {
        throw new Error(
          `electron-builder '${kind}:' entry 'from' ('${from}') escapes the project root (issue #55). ` +
          `Refusing to ship a bundle built from it.`
        );
      }
    } else if (from !== undefined) {
      // A present-but-non-string `from` (number, object, array) is a shape this
      // guard cannot reason about — fail closed rather than skip source
      // validation (issue #55).
      throw new Error(
        `electron-builder '${kind}:' entry has a non-string 'from' (${JSON.stringify(from)}), so this ` +
        `guard cannot map its source. Update assertExtraContentAllowlist in scripts/fuses.js before ` +
        `shipping it (issue #55).`
      );
    }

    // F8 — the `to`-absent defaulting form is unmodelled → fail closed.
    if (to === undefined || typeof to !== 'string') {
      throw new Error(
        `electron-builder '${kind}:' entry has no string 'to', so this guard cannot map it to a ` +
        `destination (${JSON.stringify(entry)}). The native defaulting form is not modelled — ` +
        `fail closed (issue #55).`
      );
    }
    if (to === '' || to === '.' || to === './') {
      throw new Error(
        `electron-builder '${kind}:' entry maps to the destination root ('${to}'), which is not a ` +
        `permitted slot (issue #55). Refusing to ship a bundle built from it.`
      );
    }
    if (path.posix.isAbsolute(to)) {
      throw new Error(
        `electron-builder '${kind}:' entry 'to' ('${to}') is an absolute path that escapes the ` +
        `destination (issue #55). Refusing to ship a bundle built from it.`
      );
    }
    const normTo = path.posix.normalize(to.replace(/^\.\//, ''));
    if (normTo.startsWith('..')) {
      throw new Error(
        `electron-builder '${kind}:' entry 'to' ('${to}') escapes the destination root (issue #55). ` +
        `Refusing to ship a bundle built from it.`
      );
    }
    const [segment] = normTo.split('/');
    if (!allowedDests.includes(segment)) {
      throw new Error(
        `electron-builder '${kind}:' entry destination '${segment}' is not permitted; allowed ` +
        `destinations are [${[...allowedDests].sort().join(', ')}] (issue #55). ` +
        `Refusing to ship a bundle built from it.`
      );
    }
    // F5 — provenance: when a source allowlist is supplied (extraResources at
    // runtime), the entry's `from` must be a known-good source. This rejects a
    // `from: src, to: tessdata` rename INTO an allowlisted dest at pack time,
    // not only via the test-layer from-binding (issue #55). `from` was already
    // shape-validated above; an absent `from` under an allowlist fails closed.
    if (allowedFrom) {
      const fromNorm =
        typeof from === 'string' ? path.posix.normalize(from.replace(/^\.\//, '')) : from;
      if (!allowedFrom.includes(fromNorm)) {
        throw new Error(
          `electron-builder '${kind}:' entry source '${from}' is not an allowlisted extra-content ` +
          `source; allowed sources are [${[...allowedFrom].sort().join(', ')}] ` +
          `(ALLOWED_EXTRA_RESOURCES_FROM in scripts/fuses.js, issue #55). ` +
          `Refusing to ship a bundle built from it.`
        );
      }
    }
    dests.add(segment);
  }
  return [...dests].sort();
}

function readDirOrThrow(dir, resourcesDir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const rel = path.relative(resourcesDir, dir) || dir;
    throw new Error(
      `Could not read ${rel} while verifying the packaged bundle (${err.code || err.message}). ` +
      `Refusing to ship a bundle that could not be fully inspected.`
    );
  }
}

/** Wrap a scalar `files:` value in an array; absent becomes empty. */
function toPatternArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Normalise an electron-builder `files:` list to a flat array of string
 * patterns.
 *
 * electron-builder does NOT hand hooks the raw YAML array: a plain list of
 * strings arrives at `context.packager.config.files` normalised into a single
 * FileSet, `[{ filter: [...] }]`. Both shapes are accepted here so the same
 * function can be unit-tested against the YAML and run against the live config.
 * A FileSet that remaps paths (`from`/`to`) changes where files land in the
 * bundle in ways this derivation cannot model, so it fails closed rather than
 * guessing.
 */
function flattenFilesPatterns(filesPatterns) {
  const flat = [];
  for (const entry of filesPatterns) {
    if (typeof entry === 'string') {
      flat.push(entry);
      continue;
    }
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const remaps =
        (entry.from !== undefined && entry.from !== '.') ||
        (entry.to !== undefined && entry.to !== '.');
      if (!remaps && entry.filter !== undefined) {
        const filter = Array.isArray(entry.filter) ? entry.filter : [entry.filter];
        flat.push(...flattenFilesPatterns(filter));
        continue;
      }
    }
    throw new Error(
      `electron-builder 'files:' contains an entry this guard cannot map to a top-level bundle ` +
      `path (${JSON.stringify(entry)}). Update flattenFilesPatterns in scripts/fuses.js before ` +
      `shipping it.`
    );
  }
  return flat;
}

/**
 * Map an electron-builder `files:` list to the top-level entry names it permits
 * under `app/`, unioned with the entries electron-builder adds unconditionally.
 * Fails closed on any shape it cannot reason about.
 */
function deriveAllowedAppEntries(filesPatterns) {
  if (filesPatterns === undefined) {
    // Only an ABSENT files: key makes app-builder-lib splice the implicit '**/*'.
    throw new Error(
      `electron-builder 'files:' is absent, so app-builder-lib packages the entire ` +
      `repository root (issue #43). Refusing to ship a bundle built from an unverifiable allowlist.`
    );
  }
  if (!Array.isArray(filesPatterns)) {
    // A scalar string is legal and packages exactly that one pattern, not the root -
    // but this guard only reasons about the array form, so fail closed on any other shape.
    throw new Error(
      `electron-builder 'files:' has an unsupported shape (${typeof filesPatterns}); this guard only ` +
      `verifies an array of patterns. Update deriveAllowedAppEntries in scripts/fuses.js before shipping it.`
    );
  }

  const derived = new Set(TOOL_INVARIANT_APP_ENTRIES);
  for (const pattern of flattenFilesPatterns(filesPatterns)) {
    if (pattern.startsWith('!')) continue; // negations only ever remove
    if (ALL_MATCHING_PATTERNS.includes(pattern)) {
      throw new Error(
        `electron-builder 'files:' contains the all-matching pattern '${pattern}', which packages the ` +
        `entire repository root exactly as the implicit '**/*' did (issue #43). ` +
        `Refusing to ship a bundle built from it.`
      );
    }
    // electron-builder posix-normalises and strips a leading './' before
    // matching, so do the same or a legal './out/**' derives '.' and reports a
    // spurious config/guard disagreement.
    const normalised = path.posix.normalize(pattern.replace(/^\.\//, ''));
    if (normalised.startsWith('..')) {
      throw new Error(
        `electron-builder 'files:' pattern '${pattern}' escapes the project root, which this guard ` +
        `cannot map to a top-level bundle path. Refusing to ship a bundle built from it.`
      );
    }
    const [segment] = normalised.split('/');
    if (segment === '*' || segment === '**') {
      throw new Error(
        `electron-builder 'files:' pattern '${pattern}' begins with a wildcard at the repository root, ` +
        `so it can admit any top-level path (issue #43). ` +
        `Refusing to ship a bundle built from it.`
      );
    }
    derived.add(segment);
  }
  return [...derived].sort();
}

/**
 * Assert the config-derived allowlist equals the hardcoded one. The derived
 * value is evidence the two have not drifted, never the authority.
 */
function assertConfigMatchesAllowlist(
  filesPatterns,
  { allowed = ALLOWED_APP_ENTRIES, platformFiles = undefined } = {}
) {
  // A `mac:`/`win:` block may carry its own `files:`, which app-builder-lib
  // concatenates into the SAME matcher (getFileMatchers). Deriving from the
  // global list alone would let `win: {files: ['**/*']}` re-create issue #43
  // with this check still green, so fold it in.
  const derived = deriveAllowedAppEntries(
    filesPatterns === undefined
      ? filesPatterns // preserve the "absent" signal so deriveAllowedAppEntries reports issue #43
      : [...toPatternArray(filesPatterns), ...toPatternArray(platformFiles)]
  );
  const expected = [...allowed].sort();
  if (derived.join(' ') !== expected.join(' ')) {
    throw new Error(
      `electron-builder 'files:' permits [${derived.join(', ')}] under app/, but ALLOWED_APP_ENTRIES ` +
      `in scripts/fuses.js expects [${expected.join(', ')}]. Both must be updated together (issue #43). ` +
      `Refusing to ship a bundle whose config and guard disagree.`
    );
  }
  return derived;
}

function formatOffenders(list) {
  // Names originate from third-party node_modules and POSIX filenames may
  // contain newlines, which would let a hostile dependency forge '::error::'
  // workflow commands in a public release log. Quote every entry.
  const safe = list.map((entry) => JSON.stringify(entry));
  const shown = safe.slice(0, 20).join(', ');
  return safe.length > 20 ? `${shown} (+${safe.length - 20} more)` : shown;
}

/**
 * Walk `startDir` and fail closed on any symlink whose realpath escapes `root`.
 *
 * Factored out of assertPackagedAppContents' pass-2 (issue #55, F5) so the same
 * escape policy backs both the `app/` walk and the extra-content dest guards. A
 * symlink is fatal when its target is neither inside `root` nor — on darwin —
 * under an allowed absolute link root (Gatekeeper permits /System, /Library,
 * TN2206). A dangling (unresolvable) symlink is fatal on darwin (Gatekeeper
 * rejects a bundle that links nowhere) and a warning elsewhere. realpath both
 * sides: on macOS os.tmpdir() /var canonicalises to /private/var, so comparing
 * unresolved paths would report false escapes.
 *
 * @param {string} startDir directory to walk
 * @param {string} root realpath'd containment root (targets must resolve inside it)
 * @param {object} [options]
 * @param {string} [options.platform] platform whose containment rules apply
 * @param {readonly string[]} [options.allowedAbsoluteLinkRoots] darwin absolute roots
 * @param {string} [options.relativeTo] base for the paths shown in messages (default root)
 * @param {string} [options.label] human label for the containment root in messages
 * @param {Set<string>|null} [options.skipTopLevel] top-level entry names not descended
 *   into because they are validated elsewhere (e.g. `app/` under the resources dest)
 * @returns {{ files: number, dirs: number, symlinks: number, inside: (p: string) => boolean }}
 * @throws {Error} on an escaping symlink (any platform) or a dangling one (darwin)
 */
function assertNoSymlinkEscape(
  startDir,
  root,
  {
    platform = process.platform,
    allowedAbsoluteLinkRoots = ALLOWED_ABSOLUTE_LINK_ROOTS,
    relativeTo = root,
    label = 'app/',
    skipTopLevel = null,
  } = {}
) {
  const norm = (p) => (platform === 'win32' ? p.toLowerCase() : p);
  const inside = (p) => norm(p) === norm(root) || norm(p).startsWith(norm(root + path.sep));
  const systemAllowed = (p) =>
    platform === 'darwin' &&
    allowedAbsoluteLinkRoots.some((r) => p === r || p.startsWith(`${r}${path.sep}`));

  const escaping = [];
  const dangling = [];
  let files = 0;
  let dirs = 0;
  let symlinks = 0;
  const stack = [startDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readDirOrThrow(dir, relativeTo)) {
      if (skipTopLevel && dir === startDir && skipTopLevel.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        symlinks++;
        let target;
        try {
          target = fs.realpathSync(full);
        } catch (err) {
          dangling.push(`${path.relative(relativeTo, full)} (${err.code || 'unresolvable'})`);
          continue;
        }
        if (!inside(target) && !systemAllowed(target)) {
          escaping.push(`${path.relative(relativeTo, full)} -> ${target}`);
        }
      } else if (entry.isDirectory()) {
        dirs++;
        stack.push(full);
      } else {
        files++;
      }
    }
  }
  if (escaping.length > 0) {
    throw new Error(
      `Packaged bundle contains ${escaping.length} symlink(s) resolving outside ${label}: ` +
      `${formatOffenders(escaping)}. Refusing to ship a bundle that links outside itself.`
    );
  }
  if (dangling.length > 0) {
    // Gatekeeper rejects an app containing links that point nowhere, so on macOS
    // this is a launch failure on the user's machine, not a cosmetic warning.
    if (platform === 'darwin') {
      throw new Error(
        `Packaged bundle contains ${dangling.length} unresolvable symlink(s): ` +
        `${formatOffenders(dangling)}. macOS Gatekeeper rejects bundles with links pointing nowhere. ` +
        `Refusing to ship a bundle that will not launch.`
      );
    }
    console.warn(`⚠️  unresolvable symlink(s) in bundle: ${formatOffenders(dangling)}`);
  }
  return { files, dirs, symlinks, inside };
}

/**
 * Assert the packed application directory contains only what the
 * electron-builder.yml `files:` allowlist permits.
 *
 * Three passes:
 *   1. depth-1 allowlist, BIDIRECTIONAL — every entry under `app/` must be
 *      permitted, and every permitted entry must be present. The second half
 *      catches an allowlist so narrow that `out/` was dropped, and closes the
 *      drift direction where someone widens this constant to make a build green.
 *   2. full-depth escape check — every symlink at any depth must resolve inside
 *      `app/`. Gatekeeper rejects bundles with links pointing outside or
 *      nowhere, so a dangling link is fatal on darwin (TN2206).
 *   3. keep-then-verify — the `main` entry declared by the packed
 *      `app/package.json` must exist, be inside the bundle, and be a file.
 *
 * @param {string} resourcesDir directory containing `app/`
 * @param {object} [options]
 * @param {readonly string[]} [options.allowed] permitted top-level entry names
 * @param {boolean} [options.allowAsar] explicitly accept an asar-packed bundle
 * @param {string} [options.platform] override for platform-conditional rules
 * @param {readonly string[]} [options.allowedAbsoluteLinkRoots] absolute roots a
 *   symlink may legitimately target on darwin (Gatekeeper permits /System, /Library);
 *   injectable so the darwin-allow vs escape branches can be tested against a real
 *   path on any host rather than a macOS-only one. Roots must be canonical
 *   (realpath'd) - symlink targets are compared after realpathSync, and /System
 *   and /Library already are; an injected tmp root needs fs.realpathSync first.
 * @returns {{files: number, dirs: number, symlinks: number, skipped?: string}}
 * @throws {Error} on any violation
 */
function assertPackagedAppContents(
  resourcesDir,
  {
    allowed = ALLOWED_APP_ENTRIES,
    allowAsar = false,
    platform = process.platform,
    allowedAbsoluteLinkRoots = ALLOWED_ABSOLUTE_LINK_ROOTS,
  } = {}
) {
  const appDir = path.join(resourcesDir, 'app');

  if (!fs.existsSync(appDir)) {
    if (fs.existsSync(path.join(resourcesDir, 'app.asar'))) {
      // ASAR changes how files are STORED, not which files are PACKAGED, so the
      // issue #43 defect survives it untouched. Skipping silently here would
      // retire this guard the moment `asar: true` lands, so the skip must be a
      // deliberate, explicit choice at the call site.
      if (!allowAsar) {
        throw new Error(
          `Packaged bundle uses app.asar, which this guard cannot walk, and no explicit allowAsar ` +
          `opt-in was given. ASAR does not change which files are packaged, so the issue #43 defect ` +
          `survives it. Refusing to ship an unverified bundle.`
        );
      }
      console.warn('⚠️  app.asar present and allowAsar set — packaged-contents assertion skipped');
      return { files: 0, dirs: 0, symlinks: 0, skipped: 'asar' };
    }
    throw new Error(
      `Packaged app directory not found at ${appDir}. ` +
      `Refusing to ship a bundle whose contents could not be verified.`
    );
  }

  // A symlinked app/ would silently re-root every containment check onto the
  // link target, so refuse it outright rather than follow it.
  if (fs.lstatSync(appDir).isSymbolicLink()) {
    throw new Error(
      `Packaged app directory ${appDir} is a symlink. ` +
      `Refusing to ship a bundle whose contents could not be verified in place.`
    );
  }

  const allowedSet = new Set(allowed);

  // Pass 1 - bidirectional depth-1 allowlist. Runs before the walk so a bundle
  // still carrying the whole repository fails fast instead of walking it.
  const present = new Set(readDirOrThrow(appDir, resourcesDir).map((entry) => entry.name));
  const disallowed = [...present].filter((name) => !allowedSet.has(name)).sort();
  if (disallowed.length > 0) {
    throw new Error(
      `Packaged bundle contains ${disallowed.length} disallowed top-level path(s) under app/: ` +
      `${formatOffenders(disallowed)}. Expected only ${[...allowedSet].sort().join(', ')} — check the ` +
      `'files:' allowlist in electron-builder.yml (issue #43). ` +
      `Refusing to ship a bundle carrying repository files.`
    );
  }
  const missing = [...allowedSet].filter((name) => !present.has(name)).sort();
  if (missing.length > 0) {
    throw new Error(
      `Packaged bundle is missing ${missing.length} expected top-level path(s) under app/: ` +
      `${formatOffenders(missing)}. Either the 'files:' allowlist is too narrow or ALLOWED_APP_ENTRIES ` +
      `was widened without a matching pattern (issue #43). ` +
      `Refusing to ship an incomplete bundle.`
    );
  }

  // Pass 2 - full-depth escape check, factored into assertNoSymlinkEscape (F5)
  // so the same policy backs both this walk and the extra-content dest guards.
  // Dirent.isSymbolicLink() comes from the directory entry, so this costs one
  // readdir per directory and stats only the symlinks. The returned `inside` and
  // `root` back pass 3's main-entry containment check.
  const root = fs.realpathSync(appDir);
  const { files, dirs, symlinks, inside } = assertNoSymlinkEscape(appDir, root, {
    platform,
    allowedAbsoluteLinkRoots,
    relativeTo: resourcesDir,
    label: 'app/',
  });

  // Pass 3 - keep-then-verify. The packed manifest is the authority, so this
  // adds no second hardcoded path. `main` is untrusted input: type-check it, and
  // resolve + containment-check it so a '../' cannot verify an unshipped file.
  const manifestPath = path.join(appDir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Packaged bundle has no app/package.json. The 'files:' allowlist must keep it (issue #43). ` +
      `Refusing to ship a bundle with no manifest.`
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Packaged app/package.json is not readable as JSON (${err.message}). ` +
      `Refusing to ship a bundle whose manifest cannot be read.`
    );
  }
  // Node/Electron default to index.js at the package root when "main" is
  // absent, so use THAT rather than inventing a second hardcoded build path -
  // a bundle whose manifest lost its main field genuinely cannot start, and
  // this guard should say so instead of checking a file the loader ignores.
  const mainRel =
    typeof manifest?.main === 'string' && manifest.main.length > 0 ? manifest.main : 'index.js';
  // Resolve against the realpath'd root, not appDir: on macOS a /var/... build
  // root canonicalises to /private/var/..., and comparing an unresolved path
  // to the resolved root reports a false escape for every entry.
  const mainPath = path.resolve(root, mainRel);
  if (!inside(mainPath) || !fs.existsSync(mainPath) || !fs.statSync(mainPath).isFile()) {
    throw new Error(
      `Packaged bundle has no main entry file at ${mainRel} (declared by app/package.json "main"). ` +
      `Refusing to ship a bundle that cannot start.`
    );
  }

  // NOTE: entries BESIDE app/ (extraResources dest) and ABOVE Resources/
  // (extraFiles dest) are checked by the dedicated issue #55 guards
  // (assertResourcesDestNoRepoLeak / assertResourcesSiblingsAllowlist /
  // assertExtraFilesDestNoRepoLeak), wired separately in afterPack — not here.

  console.log(
    `✅ Packaged app contents verified (${files} file(s), ${dirs} dir(s), ${symlinks} symlink(s); ` +
    `top level: ${[...allowedSet].sort().join(', ')})`
  );
  return { files, dirs, symlinks };
}

// ---------------------------------------------------------------------------
// Extra-content ARTIFACT-layer guards (issue #55) — L-label ↔ function map.
//
// The three functions below are named on different axes (dest vs siblings; leak
// vs allowlist); the L-labels are the stable scheme:
//
//   L2a-1  assertResourcesDestNoRepoLeak     — guards the extraResources dest
//          (beside `app/`: Contents/Resources on macOS, resources/ on Windows).
//          TRIPWIRE (leak-name match). Fatal on BOTH platforms.
//   L2a-2  assertResourcesSiblingsAllowlist  — guards the SAME dest as L2a-1.
//          ALLOWLIST (every sibling must be expected). Fatal on macOS,
//          advisory on win32 pending a Windows packed-tree baseline.
//   L2b    assertExtraFilesDestNoRepoLeak    — guards the extraFiles dest
//          (above Resources/: Contents/ on macOS, app output root on Windows).
//          TRIPWIRE (sentinel + source-extension). Fatal on BOTH platforms.
// ---------------------------------------------------------------------------

/**
 * L2a-1 — FATAL sentinel/leak-name TRIPWIRE for entries beside `app/`.
 *
 * NOT an exhaustive artifact-layer allowlist (that is L1, over the config). This
 * is a leak-name tripwire: it fatally rejects a sibling beside `app/` whose
 * top-level name is a known repo-structure sentinel or a known secret/exfil
 * leak-name (EXTRA_CONTENT_LEAK_NAMES = REPO_ROOT_SENTINELS ∪
 * SUSPICIOUS_SIBLING_NAMES) AND is not an allowlisted extraResources dest. Such
 * a name is never part of Electron's runtime layout at this dest, so it is an
 * unambiguous, platform-agnostic leak signal — FATAL on BOTH platforms.
 *
 * The config leak vector it targets: an `extraResources` (or
 * `--config.win.extraResources`) copy landing a repository/config/secret path
 * beside `app/`. This is the both-platforms-fatal half of the resources split
 * (F2); the broader full-sibling allowlist enumeration (L2a-2) is softened to
 * advisory on win32, this is not.
 *
 * Accepted residual: a config-injected sibling whose top-level name is neither
 * an allowlisted dest nor a known leak-name is caught fatally only at L1 (config
 * layer); at the artifact layer on win32 it is advisory (L2a-2) pending the
 * Windows baseline. The narrower "rename INTO an allowlisted dest" residual
 * (`from: src, to: tessdata`) is now closed at L1 by the runtime `from`-provenance
 * check against ALLOWED_EXTRA_RESOURCES_FROM (F5), and an escaping sibling symlink
 * is caught by the assertNoSymlinkEscape call below (F5).
 *
 * @param {string} resourcesDir directory containing `app/`
 * @param {object} [options]
 * @param {string} [options.platform] platform being packaged (for the message)
 * @param {boolean} [options.skipSymlinkCheck=false] skip the escaping-symlink
 *   walk because the caller (verifyExtraContent) already ran the identical walk
 *   over this dir. Standalone callers leave it false and get the full check.
 * @throws {Error} when a leak-named path beside app/ is not an allowed dest, or
 *   an escaping symlink sits beside app/
 */
function assertResourcesDestNoRepoLeak(
  resourcesDir,
  { platform = process.platform, skipSymlinkCheck = false } = {}
) {
  const allowed = new Set(ALLOWED_EXTRA_RESOURCES_DESTS);
  const offenders = readDirOrThrow(resourcesDir, resourcesDir)
    .map((entry) => entry.name)
    .filter((name) => EXTRA_CONTENT_LEAK_NAMES.includes(name) && !allowed.has(name))
    .sort();
  if (offenders.length > 0) {
    throw new Error(
      `Packaged bundle contains ${offenders.length} repository/secret leak-name(s) beside app/ ` +
      `that are not permitted extraResources destinations: ${formatOffenders(offenders)}. ` +
      `Allowed destinations are [${[...allowed].sort().join(', ')}] ` +
      `(ALLOWED_EXTRA_RESOURCES_DESTS in scripts/fuses.js); leak-names are matched against ` +
      `EXTRA_CONTENT_LEAK_NAMES. This is fatal on ${platform} and every platform (issue #55). ` +
      `Refusing to ship a bundle carrying repository/secret files beside app/.`
    );
  }
  // F5 — a symlink beside app/ whose realpath escapes the packed bundle is a leak
  // vector independent of its NAME (the tripwire above only inspects names). Skip
  // app/ (fully validated by assertPackagedAppContents) and fail closed on any
  // escaping sibling symlink. verifyExtraContent hoists this identical walk out
  // (it also backs L2a-2), so it passes skipSymlinkCheck to avoid the duplicate.
  if (!skipSymlinkCheck) {
    assertNoSymlinkEscape(resourcesDir, fs.realpathSync(resourcesDir), {
      platform,
      relativeTo: resourcesDir,
      label: 'the packed resources dir',
      skipTopLevel: new Set(['app', 'app.asar']),
    });
  }
}

/**
 * L2a-2 — full-sibling enumeration beside `app/`. Every sibling must be in
 * EXPECTED_RESOURCES_ENTRIES (Electron-owned names + config slots) or match
 * `*.lproj`.
 *
 * FATAL on macOS; ADVISORY (console.warn) on win32 until a real Windows
 * packed-tree baseline is captured (F2; see the Windows-baseline follow-up). The
 * Electron-owned names were enumerated on a macOS-only baseline and CI never
 * packs on Windows, so keeping this fatal on win32 would risk a first-Windows-
 * release false-fail. This softens ONLY the Electron-owned enumeration; the
 * config leak vector (L2a-1) stays both-platforms-fatal, and the escaping-symlink
 * check (assertNoSymlinkEscape, F5) is fatal on both platforms regardless.
 *
 * @param {string} resourcesDir directory containing `app/`
 * @param {object} [options]
 * @param {string} [options.platform] platform being packaged
 * @param {boolean} [options.skipSymlinkCheck=false] skip the escaping-symlink
 *   walk because the caller (verifyExtraContent) already ran the identical walk
 *   over this dir. Standalone callers leave it false and get the full check.
 * @throws {Error} on an escaping sibling symlink (both platforms), or an
 *   unexpected sibling when platform !== 'win32'
 */
function assertResourcesSiblingsAllowlist(
  resourcesDir,
  { platform = process.platform, skipSymlinkCheck = false } = {}
) {
  // F5 — an escaping sibling symlink beside app/ is fatal on BOTH platforms,
  // ahead of the platform-variant enumeration below (advisory on win32). Skip
  // app/ (validated by assertPackagedAppContents). verifyExtraContent hoists this
  // identical walk (shared with L2a-1) and passes skipSymlinkCheck to dedupe it.
  if (!skipSymlinkCheck) {
    assertNoSymlinkEscape(resourcesDir, fs.realpathSync(resourcesDir), {
      platform,
      relativeTo: resourcesDir,
      label: 'the packed resources dir',
      skipTopLevel: new Set(['app', 'app.asar']),
    });
  }

  const unexpected = readDirOrThrow(resourcesDir, resourcesDir)
    .map((entry) => entry.name)
    .filter((name) => !EXPECTED_RESOURCES_ENTRIES.includes(name) && !name.endsWith('.lproj'))
    .sort();
  if (unexpected.length === 0) return;

  const detail =
    `Packaged bundle has ${unexpected.length} unexpected entr(y/ies) beside app/ in Resources: ` +
    `${formatOffenders(unexpected)}. Expected only Electron-owned names + extraResources slots ` +
    `[${[...EXPECTED_RESOURCES_ENTRIES].sort().join(', ')}] or *.lproj (check extraResources in ` +
    `electron-builder.yml, issue #55).`;

  if (platform === 'win32') {
    // Advisory on win32 pending a real Windows packed-tree baseline (F2). An
    // unforeseen Windows sibling warns rather than blocking a release; a genuine
    // repo/config leak is caught fatally by L2a-1 (sentinel-based) regardless.
    console.warn(`⚠️  ${detail} Advisory on win32 pending a Windows baseline — add it to EXPECTED_RESOURCES_ENTRIES.`);
    return;
  }
  throw new Error(`${detail} Refusing to ship a bundle carrying unexpected files beside app/.`);
}

/**
 * L2b — COARSE repo-leak TRIPWIRE for the extraFiles dest (`Contents/` on macOS,
 * the app output root on Windows).
 *
 * NOT a sound standalone control (F3): it cannot enumerate Electron's runtime
 * layout at this dest. It recurses ≥2 levels scanning for REPO_ROOT_SENTINELS
 * (closing the `to:'bundled'` nesting evasion) AND — because
 * ALLOWED_EXTRA_FILES_DESTS is empty, so L1 forbids ANY config content here —
 * flags any file with a REPO_SOURCE_EXTENSIONS extension, which NARROWS the
 * renamed-file evasion (it catches source-extension renames only, not an
 * arbitrary rename to a binary extension). Runs FATAL on BOTH platforms. The
 * real guarantee is L1; this exists to catch a gross regression if L1 is ever
 * bypassed. Additionally fails closed (both platforms) on any symlink at the dest
 * whose realpath escapes it, via assertNoSymlinkEscape (F5), skipping the app
 * tree (Resources/resources) that assertPackagedAppContents already validated.
 *
 * @param {string} extraFilesDir the resolved extraFiles destination
 * @param {object} [options]
 * @param {string} [options.platform] platform being packaged (for the message)
 * @throws {Error} on a sentinel (≤2 levels deep), a source-extension file, or an
 *   escaping symlink at the dest
 */
function assertExtraFilesDestNoRepoLeak(extraFilesDir, { platform = process.platform } = {}) {
  if (!fs.existsSync(extraFilesDir)) {
    throw new Error(
      `extraFiles destination ${extraFilesDir} not found (issue #55). ` +
      `Refusing to ship a bundle whose contents could not be verified.`
    );
  }

  // Depth 1 = the dest's direct children, depth 2 = their children. Scanning two
  // levels closes a `to:'bundled'` nested copy; going deeper would false-flag
  // the legitimate app/package.json + app/node_modules that live at depth ≥3.
  const MAX_DEPTH = 2;
  const offenders = new Set();
  const stack = [{ dir: extraFilesDir, depth: 1 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    for (const entry of readDirOrThrow(dir, extraFilesDir)) {
      const rel = path.relative(extraFilesDir, path.join(dir, entry.name));
      if (REPO_ROOT_SENTINELS.includes(entry.name)) {
        offenders.add(rel);
      }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        if (REPO_SOURCE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
          offenders.add(rel);
        }
      } else if (entry.isDirectory() && !entry.isSymbolicLink() && depth < MAX_DEPTH) {
        stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      }
    }
  }

  if (offenders.size > 0) {
    const list = [...offenders].sort();
    throw new Error(
      `Packaged bundle contains ${list.length} repository/extra-content leak(s) at the extraFiles ` +
      `destination (${platform === 'darwin' ? 'Contents/' : 'app output root'}): ` +
      `${formatOffenders(list)}. Nothing is permitted there (ALLOWED_EXTRA_FILES_DESTS is empty; ` +
      `extraFiles must not be configured). This is fatal on both platforms (issue #55). ` +
      `Refusing to ship a bundle carrying repository files beside the app.`
    );
  }

  // F5 — an escaping symlink at the extraFiles dest is a leak vector regardless of
  // name/extension (the tripwire above skips symlinks). Skip the app tree
  // (Resources/resources), already validated by assertPackagedAppContents.
  assertNoSymlinkEscape(extraFilesDir, fs.realpathSync(extraFilesDir), {
    platform,
    relativeTo: extraFilesDir,
    label: 'the extraFiles destination',
    skipTopLevel: new Set(['Resources', 'resources']),
  });
}

/**
 * Run every issue #55 extra-content guard against a packed bundle (F1).
 *
 * Extracted from afterPack so the five guard calls are proven WIRED by unit tests
 * (scripts/fuses.test.mjs): a fabricated context + packed tree with a leak planted
 * at each layer asserts the aggregate throws, so deleting any single guard call
 * fails a test in the required Unit-tests job. afterPack passes the two locals it
 * already resolves (bundleResources, extraFilesDir) so resolution is not duplicated.
 *
 * @param {object} context electron-builder afterPack context (packager.config,
 *   packager.platformSpecificBuildOptions, electronPlatformName)
 * @param {object} deps
 * @param {string} deps.bundleResources dir containing `app/` (the extraResources dest)
 * @param {string|null} deps.extraFilesDir resolved extraFiles dest (null → fail closed)
 * @throws {Error} on any extra-content leak (L1 config-shape, L2a-1/L2a-2 resources,
 *   L2b extraFiles) or an unresolvable extraFiles dest
 */
function verifyExtraContent(context, { bundleResources, extraFilesDir }) {
  console.log(`🔧 Verifying extra-content destinations (${context.electronPlatformName})`);

  // L1 — config-shape over the MERGED (top-level ∪ platform-scoped) config, so it
  // sees --config.* AND --config.win.* / --config.mac.* overrides (F1). The
  // extraResources call additionally binds each entry's `from` to
  // ALLOWED_EXTRA_RESOURCES_FROM (F5), closing the rename-into-allowed-dest residual.
  const cfg = context.packager.config;
  const pcfg = context.packager.platformSpecificBuildOptions;
  assertExtraContentAllowlist(
    mergeExtraContent(cfg.extraResources, pcfg.extraResources),
    {
      kind: 'extraResources',
      allowedDests: ALLOWED_EXTRA_RESOURCES_DESTS,
      allowedFrom: ALLOWED_EXTRA_RESOURCES_FROM,
    }
  );
  assertExtraContentAllowlist(
    mergeExtraContent(cfg.extraFiles, pcfg.extraFiles),
    { kind: 'extraFiles', allowedDests: ALLOWED_EXTRA_FILES_DESTS }
  );

  // L2a — resources dest: sentinel/leak-name tripwire (fatal both platforms) +
  // full sibling enumeration (fatal macOS / advisory win32, F2). Both L2a guards
  // otherwise run the IDENTICAL escaping-symlink walk over the resources dir
  // (same skipTopLevel), so hoist ONE walk here (fatal on both platforms, F5) and
  // pass skipSymlinkCheck to each so neither repeats it. A symlink beside app/
  // whose realpath escapes the bundle still throws.
  const platform = context.electronPlatformName;
  assertNoSymlinkEscape(bundleResources, fs.realpathSync(bundleResources), {
    platform,
    relativeTo: bundleResources,
    label: 'the packed resources dir',
    skipTopLevel: new Set(['app', 'app.asar']),
  });
  assertResourcesDestNoRepoLeak(bundleResources, { platform, skipSymlinkCheck: true });
  assertResourcesSiblingsAllowlist(bundleResources, { platform, skipSymlinkCheck: true });

  // L2b — extraFiles dest coarse tripwire (fatal both platforms).
  if (!extraFilesDir) {
    throw new Error(
      `Unknown electron platform '${context.electronPlatformName}' - cannot locate the extraFiles ` +
      `destination. Refusing to ship an unverified bundle (issue #55).`
    );
  }
  assertExtraFilesDestNoRepoLeak(extraFilesDir, { platform: context.electronPlatformName });
}

async function afterPack(context) {
  // Determine the Electron binary path based on platform.
  // On Linux, electron-builder produces a lowercased binary (the default
  // executableName); on macOS / Windows the binary uses productFilename's
  // case. Try the case-preserved path first, fall back to lowercase, and
  // finally to the explicit executableName if the packager set one.
  const ext = {
    darwin: '.app',
    win32: '.exe',
    linux: ''
  }[context.electronPlatformName];

  const productFilename = context.packager.appInfo.productFilename;
  const candidates = [
    path.join(context.appOutDir, `${productFilename}${ext}`),
    path.join(context.appOutDir, `${productFilename.toLowerCase()}${ext}`),
  ];
  if (context.packager.executableName) {
    candidates.push(
      path.join(context.appOutDir, `${context.packager.executableName}${ext}`)
    );
  }

  let electronBinaryPath = candidates.find((p) => fs.existsSync(p));
  if (!electronBinaryPath) {
    throw new Error(
      `Electron binary not found. Tried: ${candidates.join(', ')}`
    );
  }

  // Log build mode and apply test build modifications
  if (isTestBuild) {
    displayTestBuildWarning();

    console.log('🧪 TEST BUILD: Inspector enabled for Playwright E2E testing');
    console.log('   ⚠️  This build should NEVER be distributed to end users!');
    console.log('');

    // Rename the app to include test suffix for visual differentiation
    electronBinaryPath = renameTestBuildApp(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}${ext}`,
      context.electronPlatformName
    );
  } else {
    console.log('🔒 PRODUCTION BUILD: All security fuses enabled');
  }

  // Resolve the packed resources dir ONCE and reuse it across every step below
  // (prune / spawn-helper / media / packaged-contents / extra-content), so the
  // four near-duplicate resolutions cannot drift (F11). The win32-null policy for
  // the spawn-helper step is branched only at its call site.
  const packedResourcesDir = resolvePackedResourcesDir(
    context.electronPlatformName, context.appOutDir, electronBinaryPath
  );

  // Prune foreign-platform/arch native binaries before signing so the signed
  // bundle ships only its own arch (ffprobe-static ~260 MB, node-pty Windows
  // prebuilds ~58 MB of dead weight on a mac build). Runs for all platforms.
  if (packedResourcesDir) {
    console.log(`🔧 Pruning foreign-arch native binaries (${context.electronPlatformName}/${Arch[context.arch]})`);
    // Require the target binary to survive whenever we pack for the host platform.
    // On macOS that covers BOTH the arm64 and x64 legs (the host vends both, so
    // each leg must keep its own binary). Only a true cross-PLATFORM pack — which
    // never happens in CI, where each OS builds on its own runner — relaxes this
    // to a warning instead of a hard failure.
    const requireMatch = context.electronPlatformName === process.platform;
    pruneForeignFfprobeBinaries(packedResourcesDir, context.electronPlatformName, context.arch, { requireMatch });
    pruneForeignNodePtyPrebuilds(packedResourcesDir, context.electronPlatformName, context.arch, { requireMatch });
  }

  // Restore execute bit on node-pty's spawn-helper before code-signing so
  // the signed bundle ships with mode 0755. Windows uses ConPTY /
  // winpty-agent.exe — no spawn-helper to fix, so the win32-null policy is
  // branched here at the call site (F11) rather than re-resolving the dir.
  const spawnHelperResources =
    context.electronPlatformName === 'win32' ? null : packedResourcesDir;
  if (spawnHelperResources) {
    console.log(`🔧 Restoring spawn-helper execute bit (${context.electronPlatformName})`);
    // Only require a match when packing for the host platform — protects
    // against cross-builds where the foreign-platform prebuild may be
    // intentionally absent.
    const requireMatch = context.electronPlatformName === process.platform;
    chmodNodePtySpawnHelper(spawnHelperResources, { requireMatch });
  }

  // Verify + chmod the packed media binaries (Windows ships ffmpeg.exe, so this
  // runs on every platform — unlike the spawn-helper step above).
  if (packedResourcesDir) {
    console.log(`🔧 Verifying packed media binaries (${context.electronPlatformName})`);
    const requireMatch = context.electronPlatformName === process.platform;
    ensurePackedMediaBinaries(
      packedResourcesDir,
      context.electronPlatformName,
      context.arch,
      { requireMatch }
    );
  }

  console.log(`   Applying fuses to: ${electronBinaryPath}`);

  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,

    // Reset ad-hoc signature on macOS (required for arm64)
    // Must be done before code signing
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',

    // Security Fuses (2025 Best Practices)

    // Disable ELECTRON_RUN_AS_NODE environment variable
    // Prevents attackers from executing arbitrary code via env vars
    [FuseV1Options.RunAsNode]: false,

    // Cookie encryption disabled to avoid keychain prompts
    // Settings will be stored in plaintext
    [FuseV1Options.EnableCookieEncryption]: false,

    // Disable NODE_OPTIONS environment variable
    // Prevents command injection via environment
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,

    // Disable --inspect CLI arguments (production) or enable (test builds)
    // Production: Prevents remote debugging access
    // Test builds: Required for Playwright E2E testing via CDP
    [FuseV1Options.EnableNodeCliInspectArguments]: isTestBuild,

    // NOTE: ASAR integrity validation disabled because asar: false
    // When ASAR is disabled, these fuses cannot be used:
    // - EnableEmbeddedAsarIntegrityValidation
    // - OnlyLoadAppFromAsar
  });

  console.log('✅ Electron fuses applied successfully');
  console.log('   - RunAsNode: disabled');
  console.log('   - CookieEncryption: disabled (no keychain prompt)');
  console.log('   - NodeOptions: disabled');
  console.log(`   - NodeCliInspect: ${isTestBuild ? 'ENABLED (test build)' : 'disabled'}`);
  console.log('   - AsarIntegrity: N/A (asar disabled)');
  console.log('   - OnlyLoadAppFromAsar: N/A (asar disabled)');

  // Display warning again at the end for test builds
  if (isTestBuild) {
    displayTestBuildWarning();
  }

  // Verify the packed app/ tree LAST, so this covers every mutation afterPack
  // makes rather than a snapshot taken mid-hook: ensurePackedMediaBinaries
  // writes into app/, both prunes delete from it, and a future step added at
  // the end of this function would otherwise land after the assertion and go
  // unchecked. flipFuses already ran above (it rewrites the Electron binary, not
  // app/); the only hook after this point is afterSign (scripts/resign.js), which
  // runs codesign - that embeds signatures into existing Mach-O files but adds no
  // top-level entry and no symlink. Still before signing, so a bad tree never becomes a trusted
  // artifact and no notarization minutes are spent.
  const bundleResources = packedResourcesDir;
  if (!bundleResources) {
    throw new Error(
      `Unknown electron platform '${context.electronPlatformName}' - cannot locate the packed app/ ` +
      `tree. Refusing to ship an unverified bundle.`
    );
  }
  console.log(`🔧 Verifying packaged app contents (${context.electronPlatformName})`);
  // Platform-conditional rules (the darwin dangling-symlink refusal, the
  // /System + /Library allowance, win32 case-insensitive containment) must key
  // off the platform being PACKAGED, not the one running the build - a --win
  // pack on macOS would otherwise apply Gatekeeper rules to a Windows tree.
  assertConfigMatchesAllowlist(context.packager.config.files, {
    platformFiles: context.packager.platformSpecificBuildOptions.files,
  });
  assertPackagedAppContents(bundleResources, { platform: context.electronPlatformName });

  // --- Extra-content guards (issue #55): extraResources (beside app/) and
  //     extraFiles (above Resources/), including their platform-scoped forms.
  //     Extracted into verifyExtraContent so the wiring is unit-proven (F1). ---
  const extraFilesDir = resolveExtraFilesDir(
    context.electronPlatformName, context.appOutDir, electronBinaryPath
  );
  verifyExtraContent(context, { bundleResources, extraFilesDir });
}

module.exports = afterPack;
module.exports.chmodNodePtySpawnHelper = chmodNodePtySpawnHelper;
module.exports.ensurePackedMediaBinaries = ensurePackedMediaBinaries;
module.exports.pruneForeignFfprobeBinaries = pruneForeignFfprobeBinaries;
module.exports.pruneForeignNodePtyPrebuilds = pruneForeignNodePtyPrebuilds;
module.exports.SPAWN_HELPER_MODE = SPAWN_HELPER_MODE;
module.exports.MEDIA_BINARY_MIN_BYTES = MEDIA_BINARY_MIN_BYTES;
module.exports.assertPackagedAppContents = assertPackagedAppContents;
module.exports.assertNoSymlinkEscape = assertNoSymlinkEscape;
module.exports.assertConfigMatchesAllowlist = assertConfigMatchesAllowlist;
module.exports.deriveAllowedAppEntries = deriveAllowedAppEntries;
module.exports.resolvePackedResourcesDir = resolvePackedResourcesDir;
module.exports.ALLOWED_APP_ENTRIES = ALLOWED_APP_ENTRIES;
// Extra-content guards (issue #55).
module.exports.mergeExtraContent = mergeExtraContent;
module.exports.assertExtraContentAllowlist = assertExtraContentAllowlist;
module.exports.resolveExtraFilesDir = resolveExtraFilesDir;
module.exports.verifyExtraContent = verifyExtraContent;
module.exports.assertResourcesDestNoRepoLeak = assertResourcesDestNoRepoLeak;
module.exports.assertResourcesSiblingsAllowlist = assertResourcesSiblingsAllowlist;
module.exports.assertExtraFilesDestNoRepoLeak = assertExtraFilesDestNoRepoLeak;
module.exports.ALLOWED_EXTRA_RESOURCES_DESTS = ALLOWED_EXTRA_RESOURCES_DESTS;
module.exports.ALLOWED_EXTRA_RESOURCES_FROM = ALLOWED_EXTRA_RESOURCES_FROM;
module.exports.ALLOWED_EXTRA_FILES_DESTS = ALLOWED_EXTRA_FILES_DESTS;
module.exports.ELECTRON_OWNED_RESOURCES_ENTRIES = ELECTRON_OWNED_RESOURCES_ENTRIES;
module.exports.EXPECTED_RESOURCES_ENTRIES = EXPECTED_RESOURCES_ENTRIES;
module.exports.REPO_ROOT_SENTINELS = REPO_ROOT_SENTINELS;
module.exports.SUSPICIOUS_SIBLING_NAMES = SUSPICIOUS_SIBLING_NAMES;
module.exports.EXTRA_CONTENT_LEAK_NAMES = EXTRA_CONTENT_LEAK_NAMES;

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

  // Restore execute bit on node-pty's spawn-helper before code-signing so
  // the signed bundle ships with mode 0755. Windows uses ConPTY /
  // winpty-agent.exe — no spawn-helper to fix.
  const spawnHelperResolvers = {
    darwin: () => path.join(electronBinaryPath, 'Contents', 'Resources'),
    linux: () => path.join(context.appOutDir, 'resources'),
  };
  const resolveResources = spawnHelperResolvers[context.electronPlatformName];
  if (resolveResources) {
    console.log(`🔧 Restoring spawn-helper execute bit (${context.electronPlatformName})`);
    // Only require a match when packing for the host platform — protects
    // against cross-builds where the foreign-platform prebuild may be
    // intentionally absent.
    const requireMatch = context.electronPlatformName === process.platform;
    chmodNodePtySpawnHelper(resolveResources(), { requireMatch });
  }

  // Verify + chmod the packed media binaries. Separate resolver from the
  // spawn-helper one because Windows ships ffmpeg.exe (no node-pty spawn-helper).
  const mediaResources = {
    darwin: () => path.join(electronBinaryPath, 'Contents', 'Resources'),
    linux: () => path.join(context.appOutDir, 'resources'),
    win32: () => path.join(context.appOutDir, 'resources'),
  }[context.electronPlatformName];
  if (mediaResources) {
    console.log(`🔧 Verifying packed media binaries (${context.electronPlatformName})`);
    const requireMatch = context.electronPlatformName === process.platform;
    ensurePackedMediaBinaries(
      mediaResources(),
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
}

module.exports = afterPack;
module.exports.chmodNodePtySpawnHelper = chmodNodePtySpawnHelper;
module.exports.ensurePackedMediaBinaries = ensurePackedMediaBinaries;
module.exports.SPAWN_HELPER_MODE = SPAWN_HELPER_MODE;
module.exports.MEDIA_BINARY_MIN_BYTES = MEDIA_BINARY_MIN_BYTES;

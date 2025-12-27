/**
 * Electron Fuses Configuration
 *
 * Fuses are compile-time feature toggles that disable unused Electron features
 * to prevent "Living Off The Land" (LOTL) attacks.
 *
 * Security hardening following 2025 best practices.
 *
 * Build Modes:
 * - Production (default): All security fuses enabled, inspector disabled
 * - Test build: Inspector enabled for Playwright E2E testing
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
const path = require('path');

/**
 * Check if this is a test build.
 * Test builds enable the Node CLI inspector for Playwright E2E testing.
 * SECURITY NOTE: Test builds should NEVER be distributed to end users.
 */
const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';

module.exports = async function afterPack(context) {
  // Determine the Electron binary path based on platform
  const ext = {
    darwin: '.app',
    win32: '.exe',
    linux: ''
  }[context.electronPlatformName];

  const electronBinaryPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}${ext}`
  );

  // Log build mode
  if (isTestBuild) {
    console.log('🧪 TEST BUILD: Inspector enabled for Playwright E2E testing');
    console.log('   ⚠️  WARNING: Do NOT distribute test builds to end users!');
  } else {
    console.log('🔒 PRODUCTION BUILD: All security fuses enabled');
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
};

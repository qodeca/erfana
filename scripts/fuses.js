/**
 * Electron Fuses Configuration
 *
 * Fuses are compile-time feature toggles that disable unused Electron features
 * to prevent "Living Off The Land" (LOTL) attacks.
 *
 * Security hardening following 2025 best practices.
 *
 * References:
 * - https://www.electronjs.org/docs/latest/tutorial/fuses
 * - https://www.druva.com/blog/living-off-the-land-lotl-attack-due-to-electron-fuses-misconfiguration
 */

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');

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

  console.log(`🔒 Applying Electron fuses to: ${electronBinaryPath}`);

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

    // Disable --inspect CLI arguments
    // Prevents remote debugging access
    [FuseV1Options.EnableNodeCliInspectArguments]: false,

    // NOTE: ASAR integrity validation disabled because asar: false
    // When ASAR is disabled, these fuses cannot be used:
    // - EnableEmbeddedAsarIntegrityValidation
    // - OnlyLoadAppFromAsar
  });

  console.log('✅ Electron fuses applied successfully');
  console.log('   - RunAsNode: disabled');
  console.log('   - CookieEncryption: disabled (no keychain prompt)');
  console.log('   - NodeOptions: disabled');
  console.log('   - NodeCliInspect: disabled');
  console.log('   - AsarIntegrity: N/A (asar disabled)');
  console.log('   - OnlyLoadAppFromAsar: N/A (asar disabled)');
};

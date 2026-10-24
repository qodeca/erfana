// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * afterSign Hook – Deep re-sign the macOS app bundle (LOCAL DEV ONLY)
 *
 * For local dev builds that use ad-hoc signing (no Developer ID cert),
 * electron-builder signs individual binaries with different ad-hoc code
 * directory hashes. On macOS Sequoia+, dyld rejects @rpath library loads
 * between components with mismatched ad-hoc signatures ("different Team IDs").
 *
 * This hook atomically re-signs the entire .app bundle with a single ad-hoc
 * identity so all components match.
 *
 * IMPORTANT — CI signing must SKIP this hook entirely:
 *   For CI builds using Developer ID Application certificate,
 *   `codesign --force --deep --sign -` would DESTROY the Developer ID
 *   signatures on every helper binary inside the .app and make Apple
 *   notarization reject the archive with errors like:
 *     - "The binary is not signed with a valid Developer ID certificate"
 *     - "The signature does not include a secure timestamp"
 *     - "The executable does not have the hardened runtime enabled"
 *
 *   Prior guard attempted a `codesign -dv` positive assertion on the main
 *   .app to detect Developer ID signing, but that probe proved unreliable
 *   in electron-builder's afterSign hook timing (observed silent pass-
 *   through in dry-run 24902364788, wrecking all helpers).
 *
 *   Simpler + safer: any env var indicating real-identity signing means
 *   this hook is a no-op. Local dev without any of these env vars still
 *   gets the ad-hoc consistency re-sign.
 *
 * Windows: no re-signing. Once electron-builder has edited the executable's
 * resources and Authenticode-signed it, verifySignedWindowsBundle reads the
 * fuse wire and the embedded asar integrity hash back from the SIGNED
 * Erfana.exe and checks them against buildFuseConfig and app.asar on disk, so
 * a signing step that dropped or changed either fails the build. (afterSign
 * runs only when electron-builder actually signed; an unsigned `--dir` build
 * is covered by the same checks in afterPack.)
 *
 * Build lifecycle:
 *   afterPack (fuses.js) → electron-builder signing → afterSign (this) → DMG/ZIP
 */

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Verify the signed Windows executable still carries the pinned fuses and the
 * asar integrity hash of the archive that ships.
 *
 * @param {object} context electron-builder afterSign context
 * @param {object} [deps] injectable `fuses` (scripts/fuses.js exports),
 *   `getCurrentFuseWire`, plus the readEmbeddedAsarIntegrity deps (tests)
 * @returns {Promise<{exe: string, integrity: {algorithm: string, hash: string}}>}
 */
async function verifySignedWindowsBundle(context, deps = {}) {
  const fuses = deps.fuses || require('./fuses.js');
  const getCurrentFuseWire = deps.getCurrentFuseWire || require('@electron/fuses').getCurrentFuseWire;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const archive = path.join(context.appOutDir, 'resources', 'app.asar');
  const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';

  fuses.assertFuseWireMatches(await getCurrentFuseWire(exe), fuses.buildFuseConfig('win32', { isTestBuild }));
  const integrity = fuses.assertEmbeddedIntegrityMatches('win32', exe, archive, deps);
  console.log(`✅ Signed ${path.basename(exe)}: fuse wire matches; asar integrity ${integrity.algorithm} ${integrity.hash} matches app.asar`);
  return { exe, integrity };
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName === 'win32') {
    await verifySignedWindowsBundle(context);
    return;
  }
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const realIdentitySigning =
    process.env.APPLE_API_KEY ||
    process.env.APPLE_API_KEY_ID ||
    process.env.APPLE_API_KEY_PATH ||
    process.env.APPLE_ID ||
    process.env.APPLE_APP_SPECIFIC_PASSWORD ||
    process.env.CSC_LINK ||
    process.env.CSC_KEYCHAIN ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'true' ||
    (process.env.CSC_NAME && process.env.CSC_NAME !== '-');

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  if (realIdentitySigning) {
    console.log('🔏 Real signing identity detected — leaving Developer ID signatures intact');
    // Verify the freshly-signed bundle before notary upload so a partial
    // signature (e.g. on the per-arch ffmpeg chmod'd in afterPack) is caught
    // locally rather than by Apple's notary service.
    console.log('🔍 Verifying Developer ID signature (--deep --strict)...');
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
      stdio: 'inherit'
    });
    console.log('✅ Developer ID signature verified');
    return;
  }

  console.log('🔏 Deep re-signing macOS app bundle for consistent ad-hoc identity (local dev)');
  console.log(`   App: ${appPath}`);

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  });

  console.log('🔍 Verifying code signature consistency...');
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit'
  });

  console.log('✅ App bundle re-signed and verified successfully');
};

module.exports.verifySignedWindowsBundle = verifySignedWindowsBundle;

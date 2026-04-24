/**
 * afterSign Hook – Deep re-sign the macOS app bundle
 *
 * After electron-builder's signing pass, the app bundle contains binaries
 * signed individually with different ad-hoc code directory hashes. On macOS
 * Sequoia+, dyld rejects @rpath library loads between components with
 * mismatched ad-hoc signatures ("different Team IDs").
 *
 * This hook runs codesign to atomically re-sign the entire .app bundle,
 * giving all components a consistent ad-hoc identity.
 *
 * Build lifecycle:
 *   afterPack (fuses.js) → electron-builder signing → afterSign (this) → DMG/ZIP
 */

const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  // Skip ad-hoc re-sign when a real Developer ID identity applied signatures.
  // Overwriting Developer ID with `--sign -` (ad-hoc) would destroy the chain
  // of trust and break notarization. In CI-signed builds we must leave the
  // electron-builder signature intact; notarytool then staples the ticket.
  //
  // Detection strategy: we prefer a positive assertion over an env-var allowlist
  // because electron-builder reads a growing set of CSC_* / APPLE_* variables
  // and a future workflow adding only (say) CSC_KEYCHAIN would slip an env-only
  // guard and destroy signatures. Instead we run `codesign -dv` on the built
  // .app and look for a non-ad-hoc authority; if there is one, skip re-sign.
  //
  // Env-var heuristic is kept as a pre-check to avoid spawning codesign in
  // pure dev builds where we already know there is no signing.
  const envHintsProductionSign =
    process.env.APPLE_API_KEY ||
    process.env.APPLE_API_KEY_ID ||
    process.env.APPLE_ID ||  // legacy flow — guard here even though we ban it in CI
    process.env.CSC_LINK ||
    process.env.CSC_KEYCHAIN ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'true' ||
    (process.env.CSC_NAME && process.env.CSC_NAME !== '-');

  if (envHintsProductionSign) {
    // Positive assertion: if the .app has a real Authority, skip.
    const appPathForCheck = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`
    );
    // codesign -dv writes metadata to stderr (not stdout); capture both.
    const result = require('child_process').spawnSync(
      'codesign',
      ['-dv', appPathForCheck],
      { encoding: 'utf8' }
    );
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    // Developer ID Application authorities look like:
    //   "Authority=Developer ID Application: Qodeca..."
    // Ad-hoc signatures never emit an "Authority=" line.
    if (/^Authority=/m.test(combined)) {
      console.log('🔏 Developer ID signature present — skipping ad-hoc re-sign');
      return;
    }
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log('🔏 Deep re-signing macOS app bundle for consistent ad-hoc identity');
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

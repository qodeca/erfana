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

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log('🔏 Deep re-signing macOS app bundle for consistent ad-hoc identity');
  console.log(`   App: ${appPath}`);

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  });

  console.log('✅ App bundle re-signed successfully');
};

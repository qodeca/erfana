// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Binds the Windows installer configuration (v0.22.0 per-machine install).
//
// Erfana.exe carries the embedded ASAR integrity hash and the Electron fuses, so
// it must be installed where a same-user process cannot rewrite it:
// %ProgramFiles%\Erfana, which needs `nsis.perMachine: true`. These tests fail
// loudly if that setting, the options it depends on, or the per-user → per-machine
// migration that electron-builder's NSIS template performs (and that
// build/installer.nsh completes) drift. See docs/build/windows-installer.md.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const REPO_ROOT = path.join(import.meta.dirname, '..');
const config = yaml.load(fs.readFileSync(path.join(REPO_ROOT, 'electron-builder.yml'), 'utf8'));
const nsis = config.nsis;

// The NSIS templates of the electron-builder this repository actually builds with.
const TEMPLATES = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates', 'nsis');
const readTemplate = (rel) => fs.readFileSync(path.join(TEMPLATES, rel), 'utf8');

/** Strip NSIS line comments (`;` or `#` at the start of a line) so a commented-out line never satisfies a test. */
const code = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !/^\s*[;#]/.test(line))
    .join('\n');

describe('electron-builder.yml: Windows installer', () => {
  it('builds an NSIS installer', () => {
    expect(config.win.target.map((t) => t.target)).toEqual(['nsis']);
  });

  it('installs per machine (Program Files), not per user', () => {
    expect(nsis.perMachine).toBe(true);
  });

  it('keeps the one-click installer users already know', () => {
    // Written out explicitly: a later `oneClick: false` with perMachine still on
    // would be valid but would change the install UX (wizard pages), so it must
    // be a deliberate edit to this test too.
    expect(nsis.oneClick).toBe(true);
  });

  it('sets no option that only an assisted installer understands', () => {
    // electron-builder throws on allowToChangeInstallationDirectory with oneClick,
    // and silently ignores the others; an entry here means someone expected a
    // behaviour this installer does not have.
    for (const key of ['allowToChangeInstallationDirectory', 'allowElevation', 'selectPerMachineByDefault', 'installerHeader']) {
      expect(nsis, key).not.toHaveProperty(key);
    }
  });

  it('never deletes user data on uninstall or upgrade', () => {
    // %APPDATA%\Erfana must survive the per-user → per-machine upgrade, which
    // runs the old uninstaller.
    expect(nsis.deleteAppDataOnUninstall ?? false).toBe(false);
  });

  it('keeps the install folder name, shortcut and uninstall entry as before', () => {
    expect(nsis.shortcutName).toBe('${productName}');
    expect(nsis.uninstallDisplayName).toBe('${productName}');
    expect(nsis.createDesktopShortcut).toBe('always');
    expect(nsis.artifactName).toBe('${name}-${version}-setup.${ext}');
    // perMachine makes electron-builder use productFilename for the folder only
    // when it matches this pattern (targetUtil.getWindowsInstallationDirName);
    // otherwise it falls back to the package name.
    expect(config.productName).toMatch(/^[-_+0-9a-zA-Z .]+$/);
  });

  it('ships no auto-updater feed (so no per-machine update path to elevate)', () => {
    expect(config.publish).toBeNull();
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('electron-updater');
  });
});

describe('build/installer.nsh: per-user → per-machine migration', () => {
  const includePath = path.join(REPO_ROOT, 'build', 'installer.nsh');

  it('is wired in explicitly (buildResources is resources/, so the default lookup would miss it)', () => {
    expect(config.directories.buildResources).toBe('resources');
    expect(nsis.include).toBe('build/installer.nsh');
    expect(fs.existsSync(includePath)).toBe(true);
    // A stray resources/installer.nsh would be the default include if
    // nsis.include were ever dropped; keep exactly one source of truth.
    expect(fs.existsSync(path.join(REPO_ROOT, 'resources', 'installer.nsh'))).toBe(false);
  });

  it('removes only the per-user KeepShortcuts value, in customInit', () => {
    const body = code(fs.readFileSync(includePath, 'utf8'));
    const macros = [...body.matchAll(/^!macro\s+(\S+)/gm)].map((m) => m[1]);
    expect(macros).toEqual(['customInit']);
    const init = body.match(/^!macro customInit\n([\s\S]*?)^!macroend/m)?.[1] ?? '';
    const lines = init.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines).toEqual(['DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" KeepShortcuts', 'ClearErrors']);
    // Never touches HKLM (the per-machine install's own record) or user data.
    expect(body).not.toMatch(/HKLM|SHELL_CONTEXT|RMDir|Delete\s|APPDATA/i);
  });
});

// The migration itself is electron-builder's. These pin the template behaviour
// it depends on, so an electron-builder upgrade that changes it fails here
// instead of on a user's machine.
describe('electron-builder NSIS template: behaviour the migration relies on', () => {
  it('runs the per-user uninstaller from HKCU when installing per machine', () => {
    const section = code(readTemplate('installSection.nsh'));
    expect(section).toMatch(
      /\$\{if\} \$installMode == "all"\s*\n\s*!insertmacro uninstallOldVersion HKEY_CURRENT_USER\s*\n\s*!insertmacro handleUninstallResult HKEY_CURRENT_USER/
    );
    // ...after the same-context (HKLM) uninstall, and before the new files land.
    expect(section.indexOf('uninstallOldVersion SHELL_CONTEXT')).toBeLessThan(
      section.indexOf('uninstallOldVersion HKEY_CURRENT_USER')
    );
    expect(section.indexOf('uninstallOldVersion HKEY_CURRENT_USER')).toBeLessThan(
      section.indexOf('installApplicationFiles')
    );
  });

  it('runs the old uninstaller silently and keeps app data', () => {
    const util = code(readTemplate('include/installUtil.nsh'));
    expect(util).toMatch(/ExecWait '"\$uninstallerFileNameTemp" \/S \/KEEP_APP_DATA \$0 _\?=\$installationDir'/);
    expect(util).toMatch(/StrCpy \$0 "\$0 --updated"/);
    expect(util).toMatch(/\$rootKey == "HKEY_CURRENT_USER"\s*\n\s*StrCpy \$0 "\/currentuser"/);
  });

  it('decides --keep-shortcuts from the KeepShortcuts value under the old root key', () => {
    // build/installer.nsh deletes exactly this value under HKCU.
    const util = code(readTemplate('include/installUtil.nsh'));
    expect(util).toMatch(/readReg \$R5 "\$rootKey" "\$\{INSTALL_REGISTRY_KEY\}" KeepShortcuts/);
    expect(util).toMatch(/StrCpy \$0 "\$0 --keep-shortcuts"/);
  });

  it('inserts customInit in .onInit after the install mode is chosen', () => {
    const installer = code(readTemplate('installer.nsi'));
    const onInit = installer.slice(installer.indexOf('Function .onInit'));
    expect(onInit.indexOf('!insertmacro initMultiUser')).toBeGreaterThan(-1);
    expect(onInit.indexOf('!insertmacro customInit')).toBeGreaterThan(onInit.indexOf('!insertmacro initMultiUser'));
  });

  it('elevates the per-machine installer and uninstaller', () => {
    const installer = code(readTemplate('installer.nsi'));
    expect(installer).toMatch(
      /!ifdef INSTALL_MODE_PER_ALL_USERS\s*\n\s*!ifdef BUILD_UNINSTALLER\s*\n\s*RequestExecutionLevel user\s*\n\s*!else\s*\n\s*RequestExecutionLevel admin/
    );
    // The uninstaller requests elevation itself (UAC plugin) in per-machine mode.
    expect(code(readTemplate('multiUser.nsh'))).toMatch(/!ifdef BUILD_UNINSTALLER\s*\n\s*\$\{IfNot\} \$\{UAC_IsAdmin\}[\s\S]*?UAC_RunElevated/);
  });

  it('defaults the per-machine folder to Program Files and keeps the /D override', () => {
    const multiUser = code(readTemplate('multiUser.nsh'));
    const perMachine = multiUser.slice(multiUser.indexOf('!macro setInstallModePerAllUsers'));
    expect(perMachine).toMatch(/StrCpy \$0 "\$PROGRAMFILES64"/);
    expect(perMachine).toMatch(/!insertmacro GetDParameter \$R0/);
  });

  it('starts the app after install as the signed-in user, not elevated', () => {
    expect(code(readTemplate('common.nsh'))).toMatch(/\$\{StdUtils\.ExecShellAsUser\} \$0 "\$launchLink" "open"/);
  });
});

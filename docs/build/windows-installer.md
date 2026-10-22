<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Windows installer

**Since v0.22.0 Erfana installs per machine**, into `%ProgramFiles%\Erfana`, behind one Windows administrator (UAC) prompt. Up to v0.21 it installed per user, into `%LOCALAPPDATA%\Programs\erfana`, with no prompt. Installing v0.22.0 over a per-user copy replaces that copy: there is one Erfana afterwards, and settings, projects and logs are kept.

| | Up to v0.21 (per user) | From v0.22.0 (per machine) |
|---|---|---|
| Program folder | `%LOCALAPPDATA%\Programs\erfana` | `%ProgramFiles%\Erfana` |
| Who can change the program files | the signed-in user, and any program they run | administrators only |
| Prompt at install | none | one UAC prompt |
| Prompt at uninstall | none | one UAC prompt |
| Registry | `HKCU\Software\{GUID}` and `HKCU\…\Uninstall\{GUID}` | `HKLM\Software\{GUID}` and `HKLM\…\Uninstall\{GUID}` |
| Start menu and desktop shortcuts | the user's own | All Users (`%ProgramData%\Microsoft\Windows\Start Menu\Programs`, `C:\Users\Public\Desktop`) |
| User data (`%APPDATA%\Erfana`, `~/.erfana`) | per user | per user, unchanged |

`{GUID}` is electron-builder's UUID v5 of `appId` (`com.erfana.app`), `6eef5de2-332a-5b1e-a856-892eaae4d2cc` (the `APP_GUID` electron-builder 26.16.1 passes to `makensis`; not yet read back from a Windows registry). It is the same in both modes, which is what lets the new installer find the old copy.

## Why

`Erfana.exe` holds the Electron fuses and, with ASAR integrity on, the hash of `app.asar` that it checks at start ([`asar.md`](./asar.md), [`fuses.md`](./fuses.md)). The check only holds if `Erfana.exe` and the DLLs beside it cannot be swapped. In a per-user folder any program the user runs can rewrite them, so it can turn the check off. `%ProgramFiles%` is writable by administrators only, which hardens the program files against a same-user process. See [`security.md` § Windows install location](../security.md#windows-install-location-v0220).

## Configuration

`electron-builder.yml`:

```yaml
nsis:
  oneClick: true
  perMachine: true
  include: build/installer.nsh
```

| Option | Value | Why |
|---|---|---|
| `oneClick` | `true` (the default, written out) | The same no-pages installer users already know. The only new step is the UAC prompt. An assisted wizard (`oneClick: false`) would add pages nobody asked for. |
| `perMachine` | `true` | With `oneClick`, "always per machine": the installer manifest requests `admin`, and there is no per-user/per-machine choice. |
| `allowElevation` | not set | Assisted installer only; ignored with `oneClick`. |
| `allowToChangeInstallationDirectory` | not set | Assisted installer only; electron-builder rejects it with `oneClick`. Silent installs can still choose a folder with `/D=`. |
| `packElevateHelper` | not set | Ignored when `perMachine` is `true`. It only serves electron-updater, and Erfana has no auto-update. |
| `installerHeader` | not set | Assisted installer only (the wizard's header bitmap). |
| `deleteAppDataOnUninstall` | not set (`false`) | Uninstall and upgrade never delete user data. |
| `include` | `build/installer.nsh` | Must be explicit: `directories.buildResources` is `resources/`, so electron-builder's default lookup would look for `resources/installer.nsh`. |

`scripts/installer-config.test.mjs` pins all of the above, and pins the electron-builder template behaviour the upgrade relies on, so an electron-builder upgrade that changes it fails in the required `Unit tests` job.

## Upgrade from a per-user install

electron-builder does the migration itself. Its install section ([`installSection.nsh`](https://github.com/electron-userland/electron-builder/blob/electron-builder@26.16.1/packages/app-builder-lib/templates/nsis/installSection.nsh)) runs, in order:

1. The usual app-running check for the new folder.
2. `uninstallOldVersion SHELL_CONTEXT` – removes an earlier **per-machine** copy (HKLM). Nothing on the first v0.22.0 install.
3. Because the install mode is `all`: `uninstallOldVersion HKEY_CURRENT_USER` – reads the per-user copy's `UninstallString` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{GUID}`, copies that old `Uninstall Erfana.exe` to a temp folder, and runs it with `/S /KEEP_APP_DATA /currentuser --updated` (up to five tries, then a retry prompt). That old uninstaller closes a running per-user Erfana, deletes `%LOCALAPPDATA%\Programs\erfana`, deletes its Start-menu and desktop shortcuts, and deletes its HKCU keys. `--updated` and `/KEEP_APP_DATA` keep `%APPDATA%\Erfana`. `~/.erfana` is never touched by any installer.
4. The new files go to `%ProgramFiles%\Erfana`, the HKLM keys are written, and All Users shortcuts are created.
5. Erfana starts as the signed-in user, **not elevated** (`StdUtils.ExecShellAsUser`).

The uninstaller that runs in step 3 is the one the **old** version wrote to disk, not one shipped in v0.22.0 (current electron-builder docs, [NSIS § Custom NSIS script, "Uninstaller lifecycle"](https://www.electron.build/nsis); the template code is the same in 26.16.1). Nothing in this change can alter it; it can only alter the arguments it gets.

### What `build/installer.nsh` adds

One registry value removal, in `customInit` (installer only, after the install mode is chosen, before step 3):

```nsis
!macro customInit
  DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" KeepShortcuts
  ClearErrors
!macroend
```

Checked on macOS (2026-10-22) with a minimal probe app and the same `nsis` options: `makensis -WX` (warnings are errors) compiles the installer and the uninstaller with this include, a forced `!error` inside the macro fires only in the installer pass, and `${INSTALL_REGISTRY_KEY}` expands to `Software\6eef5de2-332a-5b1e-a856-892eaae4d2cc` there. Running it needs Windows (checklist below).

Step 3 passes `--keep-shortcuts` to the old uninstaller when the old copy recorded `KeepShortcuts=true` (every electron-builder install does) **and** `%ProgramFiles%\Erfana\Erfana.exe` already exists. That rule is meant for an update in the same folder. Here it would leave the old per-user shortcuts behind, pointing at the folder the uninstaller just deleted – a duplicate, broken "Erfana" in the Start menu. It happens whenever a per-machine copy is already present: a second Windows account that still has its own per-user copy, or a re-run of the v0.22.0 installer. Removing the per-user value makes the old uninstaller always remove its own shortcuts. The per-machine value (HKLM) is untouched, so later per-machine updates keep pinned shortcuts.

### Limits

- **Only the account that elevates is migrated.** The installer runs elevated, so `HKCU` is the hive of the account that approved the UAC prompt. If that is the user's own admin account (the common case), their copy is replaced. If a standard user types a *different* administrator's password, the standard user's per-user copy is not found and stays; they remove it in **Settings > Apps > Installed apps** (it is listed as a second "Erfana"), or run the v0.22.0 installer again from their own account once they have admin rights.
- **Other Windows accounts on the same PC** keep their own per-user copies until each of them runs the v0.22.0 installer. Each such run removes that account's copy and shortcuts (this is the case `installer.nsh` exists for). A per-user copy left in place is still a per-user copy, with the old exposure.
- Unsaved work in a running per-user Erfana: the old uninstaller closes the app. Autosave covers Markdown edits; close Erfana before upgrading to be safe.

## Uninstall

**Settings > Apps > Installed apps > Erfana > Uninstall** (or `%ProgramFiles%\Erfana\Uninstall Erfana.exe`). The uninstaller asks for elevation itself, removes the program folder, the All Users shortcuts and the HKLM keys, and keeps `%APPDATA%\Erfana` and `~/.erfana`.

## Silent install

The NSIS standard switches work, run from an elevated prompt (otherwise Windows shows the UAC prompt first):

```powershell
.\erfana-0.22.0-setup.exe /S                       # silent, default folder
.\erfana-0.22.0-setup.exe /S /D=D:\Apps\Erfana     # silent, custom folder; /D= must be last and unquoted
& "$env:ProgramFiles\Erfana\Uninstall Erfana.exe" /S   # silent uninstall
```

A silent install does not start Erfana unless `--force-run` is passed.

## Auto-update

There is none. `publish: null` in `electron-builder.yml` means no `latest.yml` feed is produced, `release.yml`'s `finalize` job deletes any that leaks, and `electron-updater` is not a dependency. Users install each release by hand, which now shows the UAC prompt once per upgrade. If auto-update is ever added, electron-updater needs its elevation helper for a per-machine install (`packElevateHelper` is forced on for `perMachine`) and will show a UAC prompt on each update.

## Build an unsigned installer locally

The release installer comes from `release.yml` only (signed). For a local test build on a Windows host, without the Azure signing credentials. This is inferred from the electron-builder 26.16.1 source and not yet run; see [#132](https://github.com/qodeca/erfana/issues/132) and [`windows.md`](./windows.md#building-a-windows-installer):

```powershell
npx electron-vite build
$env:ELECTRON_BUILDER_DISABLE_BUILD_CACHE = 'true'   # skips the signing-manager lookup the resource-edit cache does
npx electron-builder --win nsis --x64 --publish never -c.win.signExecutable=false
# unpacked app only (no installer):
npx electron-builder --win dir --x64 --publish never -c.win.signExecutable=false
```

`signExecutable=false` skips every signature but keeps the exe icon and version resource. `signAndEditExecutable=false` would skip those too, and does not stop the installer and uninstaller from being signed. Output goes to `release/<version>/`.

## Windows test checklist

None of this can run on macOS. Use a Windows 11 VM with a snapshot per scenario, a signed draft release build where possible, and the unsigned build above otherwise.

1. **Fresh install** (no Erfana ever installed): one UAC prompt; files under `C:\Program Files\Erfana`; `HKLM\Software\{GUID}` has `InstallLocation`; the uninstall entry is under HKLM; Start menu and Public Desktop shortcuts start Erfana; Task Manager shows Erfana **not** elevated (Details tab, "Elevated" column: No); terminal, git badges, import, export and screenshot work.
2. **Upgrade from v0.21.0 per-user** (install the real `erfana-0.21.0-setup.exe` first, open a project, change a setting, pin Erfana to the taskbar):
   - after v0.22.0: `%LOCALAPPDATA%\Programs\erfana` is gone; `HKCU\Software\{GUID}` and `HKCU\…\Uninstall\{GUID}` are gone; Settings > Apps lists **one** Erfana; the Start menu shows **one** Erfana and it opens the Program Files copy; the old desktop shortcut is gone and the Public one works;
   - user data kept: the setting and the recent project are still there; `%APPDATA%\Erfana` and `~/.erfana` exist with their old timestamps;
   - record what happens to the old taskbar pin (expected: it breaks, because it pointed at the old exe; Windows may drop it) – a known, one-off cost to note in the release notes if confirmed.
3. **Upgrade from v0.20.1 per-user**: as 2.
4. **Upgrade with the old Erfana running**: it is closed by the old uninstaller, the upgrade completes, no "cannot close" loop.
5. **Second account**: account A upgrades; account B (which had its own per-user v0.21.0) then runs the v0.22.0 installer: B's per-user copy, its HKCU keys **and its shortcuts** are removed (this is `build/installer.nsh`'s case); no broken "Erfana" in B's Start menu.
6. **Standard user with another admin's password**: record that the standard user's per-user copy remains and is listed in Settings > Apps (expected by design, see Limits).
7. **v0.22.0 → v0.22.x per-machine update** (later): one UAC prompt; shortcuts and taskbar pin kept.
8. **Uninstall**: one UAC prompt; `C:\Program Files\Erfana`, the HKLM keys and the All Users shortcuts are gone; `%APPDATA%\Erfana` and `~/.erfana` remain.
9. **Program files are admin-only** (as a normal, unelevated user): `Set-Content "$env:ProgramFiles\Erfana\resources\probe.txt" x` and copying any file over `Erfana.exe` or a DLL fail with "Access denied"; `icacls "$env:ProgramFiles\Erfana"` shows only Administrators, SYSTEM and TrustedInstaller with write rights.
10. **ASAR tamper test against the Program Files copy** (needs the ASAR-integrity change, PR #324, in the build): as a normal user, try to change one byte of `resources\app.asar` – refused with "Access denied". As an administrator, change one byte – Erfana refuses to start (ASAR integrity violation). Restore with a reinstall.
11. **Silent install**: from an elevated prompt, `/S` installs with no UI and no app start; `/S /D=D:\Apps\Erfana` installs there; silent uninstall `/S` removes it and keeps user data.
12. **Auto-update**: none – confirm no `latest.yml` beside the draft release assets.

## Sources

- electron-builder 26.16.1 NSIS docs: [`website/docs/nsis.md`](https://github.com/electron-userland/electron-builder/blob/electron-builder@26.16.1/website/docs/nsis.md) (rendered at [electron.build/nsis](https://www.electron.build/nsis)), and the option reference generated from [`nsisOptions.ts`](https://github.com/electron-userland/electron-builder/blob/electron-builder@26.16.1/packages/app-builder-lib/src/targets/nsis/nsisOptions.ts) ([electron.build/app-builder-lib.interface.nsisoptions](https://www.electron.build/app-builder-lib.interface.nsisoptions)).
- electron-builder 26.16.1 NSIS templates: [`installer.nsi`](https://github.com/electron-userland/electron-builder/blob/electron-builder@26.16.1/packages/app-builder-lib/templates/nsis/installer.nsi), [`installSection.nsh`](https://github.com/electron-userland/electron-builder/blob/electron-builder@26.16.1/packages/app-builder-lib/templates/nsis/installSection.nsh), [`multiUser.nsh`](https://github.com/electron-userland/electron-builder/blob/electron-builder@26.16.1/packages/app-builder-lib/templates/nsis/multiUser.nsh), [`include/installUtil.nsh`](https://github.com/electron-userland/electron-builder/blob/electron-builder@26.16.1/packages/app-builder-lib/templates/nsis/include/installUtil.nsh), [`uninstaller.nsh`](https://github.com/electron-userland/electron-builder/blob/electron-builder@26.16.1/packages/app-builder-lib/templates/nsis/uninstaller.nsh).
- NSIS reference: [`RequestExecutionLevel`](https://nsis.sourceforge.io/Docs/Chapter4.html#arequestexecutionlevel), [`SetShellVarContext`](https://nsis.sourceforge.io/Docs/Chapter4.html#setshellvarcontext), [`DeleteRegValue`](https://nsis.sourceforge.io/Docs/Chapter4.html#deleteregvalue), [`ExecWait`](https://nsis.sourceforge.io/Docs/Chapter4.html#execwait), and the [installer command-line switches](https://nsis.sourceforge.io/Docs/Chapter3.html#installerusage) (`/S`, `/D=`).
- Electron: [ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity), [fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).

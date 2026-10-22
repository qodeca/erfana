; SPDX-License-Identifier: GPL-3.0-only
; SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
;
; Custom NSIS include for the Erfana installer, wired in by `nsis.include` in
; electron-builder.yml (the build resources directory is `resources/`, so the
; default `build/installer.nsh` lookup would NOT find this file on its own).
;
; Context (v0.22.0): Erfana moved from a per-user install
; (%LOCALAPPDATA%\Programs\erfana, registered under HKCU) to a per-machine one
; (%ProgramFiles%\Erfana, registered under HKLM). electron-builder's install
; section already migrates: when the install mode is "all" it runs
; `uninstallOldVersion HKEY_CURRENT_USER`, which finds the per-user copy's
; UninstallString under HKCU and runs that old uninstaller silently with
; `/S /KEEP_APP_DATA /currentuser --updated`. The old uninstaller removes the
; per-user program folder, its HKCU registry keys and its shortcuts, and keeps
; %APPDATA%\Erfana and ~/.erfana.
;
; The one gap: the template adds `--keep-shortcuts` to that call when the old
; install recorded `KeepShortcuts=true` (every electron-builder install does) and
; "$INSTDIR\Erfana.exe" already exists. That is right for an in-place update, but
; here $INSTDIR is the NEW Program Files folder, so if a per-machine copy is
; already present (a second Windows user on the same PC, or a re-run of the
; v0.22.0 installer) the old per-user Start-menu and desktop shortcuts would be
; kept, pointing at a folder the same uninstaller just deleted. Removing the
; per-user KeepShortcuts value first makes the old uninstaller always remove its
; own shortcuts. The per-machine value (HKLM) is untouched, so a later
; per-machine update still keeps the user's pinned shortcuts.
;
; customInit runs in .onInit of the installer only (never in the uninstaller),
; after electron-builder has selected the per-machine install mode and before
; the install section calls uninstallOldVersion. DeleteRegValue on a value that
; does not exist only sets the error flag, which the template clears before it
; reads the registry, so a fresh install is unaffected.

!macro customInit
  DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" KeepShortcuts
  ClearErrors
!macroend

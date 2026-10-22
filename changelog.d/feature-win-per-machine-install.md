### Changed

- **Windows: Erfana now installs for all users, in `C:\Program Files\Erfana`, and the installer asks for administrator rights.** You will see one Windows administrator (UAC) prompt when you install or uninstall. Upgrading from v0.21 or earlier replaces the old per-user copy in `%LOCALAPPDATA%\Programs\erfana`: it is uninstalled, its Start-menu and desktop shortcuts are replaced by new ones, and your settings, projects and logs (`%APPDATA%\Erfana`, `~/.erfana`) are kept. A taskbar pin to the old copy may need pinning again. Other Windows accounts on the same PC keep their own old copy until they run the new installer. Silent installs (`/S`, `/D=`) need an elevated prompt. Details: `docs/build/windows-installer.md`.

### Security

- **Windows: the program files are now writable by administrators only** – a per-user install let any program the user ran rewrite `Erfana.exe`, which holds the Electron fuses and the ASAR-integrity hash, and so switch those checks off. The per-machine install in Program Files hardens them against a same-user process.

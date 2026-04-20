# Windows build prerequisites

**Status**: Phase 0 of the [Windows enablement roadmap](../windows/README.md). This document covers what you need to install on a clean Windows 11 machine before `npm install` and `npm run dev` will work. Phases 1+ (terminal, dependency detection, filename validation, etc.) are tracked separately.

> **Scope of Phase 0**: portable npm scripts and build prerequisites only. Runtime code changes for Windows live in later phases.

---

## System requirements

| Component | Version | Notes |
|-----------|---------|-------|
| **Windows** | Windows 11 (or Windows 10 22H2) | Older Windows versions are unsupported. |
| **Node.js** | 24+ | Match CI. Install from [nodejs.org](https://nodejs.org/) or via `nvm-windows`. |
| **Python** | **3.12** (NOT 3.13) | `node-pty` fails to build against Python 3.13. If 3.13 is on PATH first, `node-gyp` will pick it up — uninstall it or put 3.12 ahead of it. |
| **Visual Studio 2022 Build Tools** | "Desktop development with C++" workload + Windows 10 SDK | Required to compile `node-pty` and other native modules. |
| **Git for Windows** | latest | Git Bash is fully supported for running npm scripts. PowerShell and `cmd.exe` should also work after Phase 0. |

---

## Step-by-step setup

### 1. Install Node.js 24+

Download the LTS or Current build from [nodejs.org](https://nodejs.org/) and run the installer. Verify:

```powershell
node --version   # should print v24.x or higher
npm --version
```

### 2. Install Python 3.12

Download Python 3.12 from [python.org](https://www.python.org/downloads/windows/) (NOT 3.13). During installation, tick **"Add python.exe to PATH"**.

```powershell
python --version   # should print Python 3.12.x
```

> **Why 3.12 specifically?** `node-pty` (which powers Erfana's terminal) ships C++ bindings that the `node-gyp` toolchain compiles at install time. The `node-gyp` shipped with Node 24 does not yet handle Python 3.13's removed `distutils` module, so the build fails. Pinning to 3.12 sidesteps the issue.

### 3. Install Visual Studio 2022 Build Tools

Download **"Build Tools for Visual Studio 2022"** from [visualstudio.microsoft.com/downloads](https://visualstudio.microsoft.com/downloads/) (under "Tools for Visual Studio"). Run the installer and select:

- **Workload**: "Desktop development with C++"
- **Individual components** (verify these are checked):
  - MSVC v143 — VS 2022 C++ x64/x86 build tools
  - Windows 10 SDK (10.0.19041.0 or later)
  - C++ CMake tools for Windows

After installation, tell `npm` which Visual Studio version to use:

```powershell
npm config set msvs_version 2022
```

### 4. Enable Developer Mode (for symlinks)

`electron-builder` extracts the `winCodeSign` cache, which contains symbolic links (it bundles macOS signing tools too). Without Developer Mode, Windows blocks symlink creation for non-admin users and `npm run build:win` fails part-way through with:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
```

Enable it once:

1. **Settings → System → For developers → Developer Mode**: On.

(No reboot required. Alternatively, run the npm script from an elevated terminal — but Developer Mode is the cleaner fix.)

### 5. Enable long paths

Erfana's `node_modules` tree easily exceeds the historical Windows 260-character path limit. You need both Git and Windows itself to allow long paths.

**Git**:

```powershell
git config --global core.longpaths true
```

**Windows** (requires admin):

1. Open **Group Policy Editor** (`gpedit.msc`) — or, on Home editions, edit the registry directly.
2. Navigate to **Computer Configuration → Administrative Templates → System → Filesystem**.
3. Enable **"Enable Win32 long paths"**.
4. Reboot.

Registry equivalent (admin PowerShell):

```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

### 6. Clone and install

```powershell
git clone https://github.com/qodeca/erfana.git
cd erfana
npm install
```

`npm install` will run `electron-builder install-app-deps` (via the `postinstall` hook), which rebuilds `node-pty` against Electron's bundled Node.js. If this step fails, you almost always have the wrong Python or are missing the C++ workload — re-check steps 2 and 3.

### 7. Verify the dev loop

```powershell
npm run dev          # should launch Erfana
npm run typecheck    # should pass
npm run test:cov     # should produce coverage/ output
```

---

## Building a Windows installer

```powershell
npm run build:win
```

This produces an NSIS installer in `release/{version}/`. The build runs `prebuild` (the aproba shim) and `electron-builder --win` automatically.

> **Phase 0 boundary**: `build:win` should produce an installer, but the resulting app will still hit Phase 1+ runtime issues (terminal initialization, dependency detection, etc.). Those are tracked in [#154](https://github.com/qodeca/erfana/issues/154) and [#155](https://github.com/qodeca/erfana/issues/155).

---

## Troubleshooting

**`node-pty` fails to compile during `npm install`**
- Check `python --version` is 3.12.x, not 3.13.x.
- Confirm Visual Studio Build Tools 2022 is installed with the "Desktop development with C++" workload.
- Run `npm config get msvs_version` — should return `2022`.

**`ENAMETOOLONG` or `MAX_PATH` errors**
- Verify long paths are enabled in both Git and Windows (step 5).
- Reboot after enabling the group policy — it doesn't apply to running shells.

**`build:win` fails with "Cannot create symbolic link : A required privilege is not held by the client"**
- Developer Mode is not enabled. See step 4.

**`npm run test:cov` complains about missing `out/` directory**
- Run `npm run build` once first. The script preserves an existing `out/` between runs but expects either none or a valid one.

**`npm run dev` launches but the terminal panel is dead**
- Expected on Phase 0. Terminal cmd.exe/PowerShell parity is Phase 1 ([#154](https://github.com/qodeca/erfana/issues/154)).

---

## Contributor expectations (pre-CI)

Windows-targeted CI is deferred to Phase 6. Until it lands, **contributors on Windows are responsible for running the main-process tests locally before merging any PR that touches `src/main/` or test configuration**:

```bash
npm run test:main
```

This is the same job the future CI guard will run. Catches the common regression class of hardcoded Unix paths (`/tmp/...`, `/path/to/...`) that the project's `PATH_TRAVERSAL` validator rejects on Windows. See [#157](https://github.com/qodeca/erfana/issues/157) for the original incident.

---

## See also

- [Build README](README.md) — toolchain overview, macOS instructions
- [Windows enablement roadmap](../windows/README.md) — full phased plan
- [Known issues](../known-issues.md)

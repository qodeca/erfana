# Windows build prerequisites

**Status**: Build prerequisites for Windows hosts. Most of [Windows enablement](../windows/README.md) has shipped:

- **Phases 0–2 + 4** (portable scripts, terminal parity, dependency detection, reserved-filename guard, local Whisper) — v0.9.3 and v0.9.4.
- **Phase 3** (screenshot parity, issue #164) — v0.12.0.
- **Phase 6** (polish, issue #167) — partially shipped in v0.13.0 (advisory Windows CI job, single-bridge renderer platform detection, PII log redaction, D5/D7), with further Windows-quality work through v0.14.0–v0.16.0: bundled Cascadia Mono terminal font, folder-name project-tree header, native-`git` status worker, and the Windows Claude Code context bar.
- **Phase 5** (NSIS installer UX, issue #166) is the main phase still open.

Issue references above are bare numbers on purpose — those issue links no longer resolve on the public repository. [`docs/windows/implementation-plan.md`](../windows/implementation-plan.md) is the canonical, dated status.

> **Scope of this doc**: portable npm scripts and build prerequisites only. Runtime feature status for Windows is in [`implementation-plan.md`](../windows/implementation-plan.md) §"Feature status on Windows today".

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

`npm install` runs the `postinstall` hook, which is `patch-package && electron-builder install-app-deps`. `patch-package` first applies the committed `patches/node-pty+1.1.0.patch`, then `electron-builder install-app-deps` rebuilds `node-pty` against Electron's bundled Node.js. If the rebuild step fails, you almost always have the wrong Python or are missing the C++ workload — re-check steps 2 and 3.

> **Why the patch?** A fresh `npm ci` on a default-hardened Windows 11 box used to fail in two ways during the `node-pty` build; `patch-package` now fixes both automatically. See the [node-pty build failures on Windows 11](#node-pty-build-failures-on-windows-11) note below.

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

> The installer produced here runs the full user-visible feature surface. Phases 1–2 + 4 (terminal parity, dependency detection, reserved-filename guard, local Whisper) shipped in v0.9.3 / v0.9.4, and Phase 3 screenshot capture shipped in v0.12.0 — no feature is gated off on Windows any more. What remains open is installer UX polish (Phase 5, issue #166). Per-feature status lives in [`implementation-plan.md`](../windows/implementation-plan.md) §"Feature status on Windows today".

---

## node-pty build failures on Windows 11

A fresh `git clone && npm ci` on a default-hardened Windows 11 box previously failed in two ways while compiling `node-pty`. Both are now fixed automatically by the committed `patches/node-pty+1.1.0.patch`, applied via `patch-package` in the `postinstall` hook — no manual intervention required.

- **`'GetCommitHash.bat' is not recognized`** – node-pty's `deps/winpty/src/winpty.gyp` invokes `cmd /c "cd shared && GetCommitHash.bat"` / `UpdateGenVersion.bat`. When Windows sets `NoDefaultCurrentDirectoryInExePath=1` (a security-hardening flag, often applied via enterprise / Group Policy baselines), `cmd.exe` no longer searches the current directory, so the `.bat` is "not recognized" and the build aborts. The patch prefixes the calls with `.\` to force current-directory resolution (per Microsoft's `NeedCurrentDirectoryForExePath` contract).
- **`MSB8040: Spectre-mitigated libraries are required for this project`** – node-pty's gyp requests `SpectreMitigation: 'Spectre'`, which fails on a default MSVC install that lacks the Spectre-mitigated libs. The patch sets `SpectreMitigation: 'false'` for node-pty's builds. This is an accepted residual risk: node-pty wraps an operator-driven PTY rather than adversarial cross-boundary input, and the flag is kept off everywhere (local / CI / release) for consistency.

> **Future direction**: node-pty `1.2.0-beta.7+` removes the winpty build step entirely, which would eliminate the first failure at the root. Adopting it is tracked as a follow-up; until then the patch is the supported fix.

---

## Troubleshooting

**`node-pty` fails to compile during `npm install`**
- First confirm the patch is present and applied: `patches/node-pty+1.1.0.patch` should exist, and `npm install` output should show `patch-package` applying it (`node-pty@1.1.0 ✔`). If the patch failed to apply, re-run `npx patch-package` and read the error.
- Check `python --version` is 3.12.x, not 3.13.x.
- Confirm Visual Studio Build Tools 2022 is installed with the "Desktop development with C++" workload.
- Run `npm config get msvs_version` — should return `2022`.
- For `'GetCommitHash.bat' is not recognized` or `MSB8040` (Spectre libs), see [node-pty build failures on Windows 11](#node-pty-build-failures-on-windows-11) above — these are handled by the committed patch.

**`ENAMETOOLONG` or `MAX_PATH` errors**
- Verify long paths are enabled in both Git and Windows (step 5).
- Reboot after enabling the group policy — it doesn't apply to running shells.

**`build:win` fails with "Cannot create symbolic link : A required privilege is not held by the client"**
- Developer Mode is not enabled. See step 4.

**`npm run test:cov` complains about missing `out/` directory**
- Run `npm run build` once first. The script preserves an existing `out/` between runs but expects either none or a valid one.

---

## Contributor expectations

Windows CI **exists**: `.github/workflows/checks.yml` runs a `windows-checks` job on `windows-latest` for every push, executing `npm run typecheck` and `npm run test:main` under `shell: bash`.

It is deliberately **advisory** — excluded from the branch-protection required-checks set until it proves stable, mirroring how `e2e` is kept out. A red `windows-checks` job therefore blocks nothing automatically, so **contributors are still responsible for running the main-process tests locally before merging any PR that touches `src/main/` or test configuration**:

```bash
npm run test:main
```

This is the same command the CI job runs. It catches the common regression class of hardcoded Unix paths (`/tmp/...`, `/path/to/...`) that the project's `PATH_TRAVERSAL` validator rejects on Windows — the original incident was issue #157 (link no longer resolves; closed 2026-04-20).

---

## See also

- [Build README](README.md) — toolchain overview, macOS instructions
- [Windows enablement roadmap](../windows/README.md) — full phased plan
- [Known issues](../known-issues.md)

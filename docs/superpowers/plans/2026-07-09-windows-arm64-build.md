<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# Native Windows-ARM64 Local Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run Erfana natively on a Windows-on-ARM (arm64) host — both `npm run dev` and a working `npm run build:win` arm64 installer — with native ffmpeg-backed media features.

**Architecture:** ffmpeg-static/ffprobe-static ship no win32-arm64 binary, so a new provisioning script downloads a pinned, SHA-verified native arm64 ffmpeg/ffprobe from `tordona/ffmpeg-win-arm64` and drops the exes where the existing runtime resolvers (`src/main/utils/mediaBinaries.ts`) already look. The electron-builder win target gains an explicit arm64 arch; the `beforePack` hook gets a win32-arm64 branch that consumes the pre-provisioned binary instead of ffmpeg-static's 404-ing installer. `afterPack` (`scripts/fuses.js`) is already arm64-generic and needs no change.

**Tech Stack:** electron-vite 5 / electron-builder 26, Node 24, Electron 39, plain `.mjs`/`.js` build scripts, vitest 3 (`main` project includes `scripts/**/*.test.{js,mjs,ts}`).

## Global Constraints

- **Platform guard:** all new build-script logic must be a clean no-op unless `process.platform === 'win32' && process.arch === 'arm64'`. Never perturb the macOS or Windows-x64 build paths.
- **Integrity anchor:** the downloaded archive MUST be verified against the pinned SHA-256 `8af8143ded6804721f6c884f05525c956a5b69809df94dd1036ae90b84614981` before extraction; abort on mismatch.
- **Pinned source:** tordona release tag `8.1.2`, asset `ffmpeg-8.1.2-full-static-win-arm64.7z`.
- **SPDX headers required** on every new source file: `// SPDX-License-Identifier: GPL-3.0-only` + `// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.` (enforced by `npm run check:headers` + `reuse lint`).
- **Design tokens / no UI work** — this plan touches build config, scripts, and docs only.
- **Out of scope:** CI/arm64 runners, code signing, distribution, and local whisper.cpp (stays disabled on arm64; no code change).
- **Verify before done:** `npm run typecheck`, `npm run lint`, `npm run test:main` must pass.

---

## File Structure

- **Create** `scripts/fetch-ffmpeg-arm64.mjs` — provisions native arm64 ffmpeg/ffprobe into `node_modules`. Exports pure helpers for unit testing; `main()` runs only on direct invocation.
- **Create** `scripts/fetch-ffmpeg-arm64.test.mjs` — unit tests for the pure helpers.
- **Modify** `scripts/ensure-media-binaries.js` — add exported `cacheNativeFfmpeg()` helper + win32-arm64 branch in `cacheFfmpegArch()`.
- **Modify** `scripts/ensure-media-binaries.test.mjs` — tests for `cacheNativeFfmpeg()`.
- **Modify** `electron-builder.yml` — add `arch: [arm64]` to the win target.
- **Modify** `package.json` — append the fetch script to `postinstall`.
- **Modify** `docs/build/windows.md` — ARM64 build section.
- **Modify** `THIRD-PARTY-LICENSES.md` — record the tordona ffmpeg binary.

---

### Task 1: electron-builder arm64 win target

**Files:**
- Modify: `electron-builder.yml:42-45` (the `win.target` block)

**Interfaces:**
- Consumes: nothing.
- Produces: an arm64 win target so `electron-builder --win` on an arm64 host emits an arm64 NSIS installer.

- [ ] **Step 1: Edit the win target**

In `electron-builder.yml`, change the `win` target block from:

```yaml
win:
  executableName: Erfana
  target:
    - target: nsis
```

to:

```yaml
win:
  executableName: Erfana
  target:
    - target: nsis
      arch:
        - arm64
```

Leave everything else in the `win:` block (signtoolOptions, azureSignOptions) unchanged.

- [ ] **Step 2: Verify the YAML parses and targets arm64**

Run:
```bash
node -e "const y=require('js-yaml');const fs=require('fs');const c=y.load(fs.readFileSync('electron-builder.yml','utf8'));const t=c.win.target[0];console.log(JSON.stringify(t));if(!t.arch||!t.arch.includes('arm64'))process.exit(1)"
```
Expected: prints `{"target":"nsis","arch":["arm64"]}` and exits 0.

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "build(win): target arm64 NSIS installer"
```

---

### Task 2: `fetch-ffmpeg-arm64.mjs` provisioning script

**Files:**
- Create: `scripts/fetch-ffmpeg-arm64.mjs`
- Test: `scripts/fetch-ffmpeg-arm64.test.mjs`

**Interfaces:**
- Consumes: `ffmpeg-static` and `ffprobe-static` package dirs (present after `npm install`, even though their arm64 binaries are absent); `7zip-bin` (transitive dep of electron-builder) with a `tar` fallback.
- Produces (exports): `isTargetPlatform(platform?, arch?) → boolean`, `sha256File(file) → string`, `assertArchiveSha(file, expected?) → void (throws on mismatch)`, `findExe(root, name) → string|null`, `ffmpegDest() → string`, `ffprobeDest() → string`, plus constants `TAG`, `ASSET`, `ARCHIVE_SHA256`, `DOWNLOAD_URL`, `MIN_EXE_BYTES`. On direct invocation, `main()` downloads → verifies → extracts → places `ffmpeg.exe`/`ffprobe.exe`.

- [ ] **Step 1: Write the failing test**

Create `scripts/fetch-ffmpeg-arm64.test.mjs`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  isTargetPlatform,
  sha256File,
  assertArchiveSha,
  findExe,
  ARCHIVE_SHA256,
} = require('./fetch-ffmpeg-arm64.mjs')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

let dir
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'erfana-fetch-')) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

describe('isTargetPlatform', () => {
  it('is true only for win32 + arm64', () => {
    expect(isTargetPlatform('win32', 'arm64')).toBe(true)
    expect(isTargetPlatform('win32', 'x64')).toBe(false)
    expect(isTargetPlatform('darwin', 'arm64')).toBe(false)
    expect(isTargetPlatform('linux', 'arm64')).toBe(false)
  })
})

describe('assertArchiveSha', () => {
  it('passes when the hash matches', () => {
    const p = join(dir, 'a.bin')
    const buf = Buffer.from('hello world')
    writeFileSync(p, buf)
    expect(() => assertArchiveSha(p, sha256(buf))).not.toThrow()
    expect(sha256File(p)).toBe(sha256(buf))
  })
  it('throws on mismatch', () => {
    const p = join(dir, 'b.bin')
    writeFileSync(p, Buffer.from('hello world'))
    expect(() => assertArchiveSha(p, 'deadbeef'.repeat(8))).toThrow(/mismatch/i)
  })
  it('exposes the real pinned archive hash as the default', () => {
    expect(ARCHIVE_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('findExe', () => {
  it('finds a nested binary case-insensitively', () => {
    const root = join(dir, 'tree')
    mkdirSync(join(root, 'ffmpeg-x', 'bin'), { recursive: true })
    writeFileSync(join(root, 'ffmpeg-x', 'bin', 'ffmpeg.exe'), 'x')
    writeFileSync(join(root, 'ffmpeg-x', 'bin', 'ffprobe.exe'), 'x')
    expect(findExe(root, 'FFMPEG.EXE')).toContain('ffmpeg.exe')
    expect(findExe(root, 'ffprobe.exe')).toContain('ffprobe.exe')
  })
  it('returns null when absent', () => {
    const root = join(dir, 'empty')
    mkdirSync(root, { recursive: true })
    expect(findExe(root, 'ffmpeg.exe')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:main -- fetch-ffmpeg-arm64`
Expected: FAIL — cannot resolve `./fetch-ffmpeg-arm64.mjs` (module does not exist yet).

- [ ] **Step 3: Write the script**

Create `scripts/fetch-ffmpeg-arm64.mjs`:

```js
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Provision native Windows-ARM64 ffmpeg + ffprobe.
 *
 * ffmpeg-static / ffprobe-static publish NO win32-arm64 binary, so on a
 * Windows-on-ARM host their installers 404 and both `npm run dev` and the
 * packaged runtime hit `spawn ffmpeg ENOENT`. This script downloads a pinned,
 * SHA-verified native arm64 build from tordona/ffmpeg-win-arm64 and drops
 * ffmpeg.exe / ffprobe.exe where the runtime resolvers
 * (src/main/utils/mediaBinaries.ts) already look. Clean no-op on every other
 * platform, so it is safe to run from `postinstall` unconditionally.
 *
 * Re-pinning: bump TAG + ASSET + ARCHIVE_SHA256 together. Get the hash from the
 * release's `<asset>.sha256` companion file. See docs/build/windows.md.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'

const require = createRequire(import.meta.url)

export const TAG = '8.1.2'
export const ASSET = `ffmpeg-${TAG}-full-static-win-arm64.7z`
export const ARCHIVE_SHA256 =
  '8af8143ded6804721f6c884f05525c956a5b69809df94dd1036ae90b84614981'
export const DOWNLOAD_URL =
  `https://github.com/tordona/ffmpeg-win-arm64/releases/download/${TAG}/${ASSET}`

/** Size floor guarding against a stub/truncated exe (real ffmpeg is 10s of MB). */
export const MIN_EXE_BYTES = 1_000_000

export function isTargetPlatform(platform = process.platform, arch = process.arch) {
  return platform === 'win32' && arch === 'arm64'
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function assertArchiveSha(file, expected = ARCHIVE_SHA256) {
  const got = sha256File(file)
  if (got !== expected) {
    throw new Error(
      `Archive SHA-256 mismatch for ${file}: expected ${expected}, got ${got}`
    )
  }
}

/** Recursively find the first file whose basename equals `name` (case-insensitive). */
export function findExe(root, name) {
  const wanted = name.toLowerCase()
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.toLowerCase() === wanted) return full
    }
  }
  return null
}

/** node_modules/ffmpeg-static/ffmpeg.exe */
export function ffmpegDest() {
  const dir = path.dirname(require.resolve('ffmpeg-static/package.json'))
  return path.join(dir, 'ffmpeg.exe')
}

/** node_modules/ffprobe-static/bin/win32/arm64/ffprobe.exe */
export function ffprobeDest() {
  const dir = path.dirname(require.resolve('ffprobe-static/package.json'))
  return path.join(dir, 'bin', 'win32', 'arm64', 'ffprobe.exe')
}

function extract7z(archive, outDir) {
  // 7zip-bin ships with electron-builder; 7za reads .7z natively.
  try {
    const { path7za } = require('7zip-bin')
    execFileSync(path7za, ['x', archive, `-o${outDir}`, '-y'], { stdio: 'inherit' })
    return
  } catch (err) {
    console.warn(`⚠️  7zip-bin unavailable (${err.message}); falling back to tar`)
  }
  // Windows 11 bundles bsdtar (libarchive), which reads .7z.
  execFileSync('tar', ['-xf', archive, '-C', outDir], { stdio: 'inherit' })
}

async function main() {
  if (!isTargetPlatform()) return // silent no-op off arm64-win

  const ffmpegOut = ffmpegDest()
  const ffprobeOut = ffprobeDest()
  const present = (p) => {
    try {
      return fs.statSync(p).size >= MIN_EXE_BYTES
    } catch {
      return false
    }
  }
  if (present(ffmpegOut) && present(ffprobeOut)) {
    console.log('✅ native arm64 ffmpeg/ffprobe already present — skipping')
    return
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erfana-ffmpeg-arm64-'))
  try {
    const archive = path.join(tmp, ASSET)
    console.log(`⬇️  downloading ${DOWNLOAD_URL}`)
    const res = await fetch(DOWNLOAD_URL) // follows the release-assets redirect
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()))

    assertArchiveSha(archive)
    console.log('✅ archive SHA-256 verified')

    const ex = path.join(tmp, 'x')
    fs.mkdirSync(ex, { recursive: true })
    extract7z(archive, ex)

    const ffmpegSrc = findExe(ex, 'ffmpeg.exe')
    const ffprobeSrc = findExe(ex, 'ffprobe.exe')
    if (!ffmpegSrc || !ffprobeSrc) {
      throw new Error(`Extracted archive missing ffmpeg.exe/ffprobe.exe under ${ex}`)
    }
    fs.mkdirSync(path.dirname(ffmpegOut), { recursive: true })
    fs.mkdirSync(path.dirname(ffprobeOut), { recursive: true })
    fs.copyFileSync(ffmpegSrc, ffmpegOut)
    fs.copyFileSync(ffprobeSrc, ffprobeOut)
    console.log(`✅ installed native arm64 ffmpeg  → ${ffmpegOut}`)
    console.log(`✅ installed native arm64 ffprobe → ${ffprobeOut}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`❌ fetch-ffmpeg-arm64 failed: ${err.message}`)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:main -- fetch-ffmpeg-arm64`
Expected: PASS (all `isTargetPlatform`, `assertArchiveSha`, `findExe` cases green).

- [ ] **Step 5: Lint + header check**

Run: `npm run lint && npm run check:headers`
Expected: no errors for the two new files.

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-ffmpeg-arm64.mjs scripts/fetch-ffmpeg-arm64.test.mjs
git commit -m "build(win-arm64): add native ffmpeg/ffprobe provisioning script"
```

---

### Task 3: Wire the fetch script into `postinstall`

**Files:**
- Modify: `package.json:26` (the `postinstall` script)

**Interfaces:**
- Consumes: `scripts/fetch-ffmpeg-arm64.mjs` from Task 2 (its no-op guard makes this safe on all platforms).
- Produces: a `npm install` that self-provisions arm64 ffmpeg/ffprobe on an arm64-win host.

- [ ] **Step 1: Edit postinstall**

In `package.json`, change:

```json
"postinstall": "patch-package && electron-builder install-app-deps",
```

to:

```json
"postinstall": "patch-package && electron-builder install-app-deps && node scripts/fetch-ffmpeg-arm64.mjs",
```

- [ ] **Step 2: Verify the no-op path (cross-platform safety)**

Run (this is the exact command postinstall appends; on non-arm64-win it must exit 0 silently, on arm64-win it downloads):
```bash
node scripts/fetch-ffmpeg-arm64.mjs; echo "exit=$?"
```
Expected on macOS / Windows-x64 / Linux: no output, `exit=0`.
Expected on Windows-arm64: download + verify + install logs, `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build(win-arm64): self-provision ffmpeg in postinstall"
```

---

### Task 4: `beforePack` win32-arm64 branch

**Files:**
- Modify: `scripts/ensure-media-binaries.js` (add `cacheNativeFfmpeg`; branch `cacheFfmpegArch`)
- Test: `scripts/ensure-media-binaries.test.mjs` (add a `cacheNativeFfmpeg` describe block)

**Interfaces:**
- Consumes: `verifyBinary`, `MEDIA_BINARY_MIN_BYTES`, `FFMPEG_SHA256` (already in-module); the arm64 `ffmpeg.exe` provisioned by Task 2 at `ffmpegStaticBinary('win32')`.
- Produces (export): `cacheNativeFfmpeg(staticBin, dest, key) → dest` — copies an already-present native ffmpeg into the build cache, size-verified (no pin needed for `win32-arm64`; archive SHA in Task 2 is the integrity anchor). Throws a remediation-pointing error if `staticBin` is absent.

- [ ] **Step 1: Write the failing test**

Append to `scripts/ensure-media-binaries.test.mjs` (add `cacheNativeFfmpeg` to the destructured require at the top: `const { verifyBinary, MEDIA_BINARY_MIN_BYTES, cacheNativeFfmpeg } = require('./ensure-media-binaries.js')`), then add:

```js
describe('cacheNativeFfmpeg', () => {
  it('copies a present native binary into the cache dest and returns it', () => {
    const staticBin = join(dir, 'native-ffmpeg.exe')
    writeFileSync(staticBin, Buffer.alloc(MEDIA_BINARY_MIN_BYTES, 9))
    const dest = join(dir, 'cache', 'win32-arm64', 'ffmpeg.exe')
    const out = cacheNativeFfmpeg(staticBin, dest, 'win32-arm64')
    expect(out).toBe(dest)
    expect(() => verifyBinary(dest, 'win32-arm64')).not.toThrow()
  })

  it('throws a remediation-pointing error when the native binary is absent', () => {
    const staticBin = join(dir, 'does-not-exist.exe')
    const dest = join(dir, 'cache2', 'ffmpeg.exe')
    expect(() => cacheNativeFfmpeg(staticBin, dest, 'win32-arm64')).toThrow(
      /npm install|fetch-ffmpeg-arm64/i
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:main -- ensure-media-binaries`
Expected: FAIL — `cacheNativeFfmpeg is not a function`.

- [ ] **Step 3: Add `cacheNativeFfmpeg` and branch `cacheFfmpegArch`**

In `scripts/ensure-media-binaries.js`, add this function immediately above `cacheFfmpegArch` (after `ffmpegStaticBinary`):

```js
/**
 * Cache an already-present native ffmpeg binary (no download).
 *
 * ffmpeg-static publishes no win32-arm64 binary, so on Windows-on-ARM the
 * native ffmpeg is provisioned into node_modules by
 * scripts/fetch-ffmpeg-arm64.mjs (postinstall). This copies that binary into
 * the per-arch build cache, size-verified. No SHA pin is required for
 * win32-arm64 — the archive SHA-256 checked at fetch time is the integrity
 * anchor.
 * @returns the cache path.
 * @throws if the native binary is absent (points at the provisioning step).
 */
function cacheNativeFfmpeg(staticBin, dest, key) {
  if (!fs.existsSync(staticBin)) {
    throw new Error(
      `Native ffmpeg missing at ${staticBin}. ffmpeg-static has no ${key} ` +
        `build — run \`npm install\` (or \`node scripts/fetch-ffmpeg-arm64.mjs\`) first.`
    )
  }
  verifyBinary(staticBin, key, MEDIA_BINARY_MIN_BYTES, FFMPEG_SHA256[key])
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(staticBin, dest)
  return dest
}
```

Then, inside `cacheFfmpegArch`, immediately after the `if (fs.existsSync(dest)) { ... return dest }` early-return block, insert the arm64 branch:

```js
  // Windows-on-ARM: ffmpeg-static's installer 404s (no win32-arm64 asset).
  // The native binary was placed in node_modules by fetch-ffmpeg-arm64.mjs.
  if (platform === 'win32' && arch === 'arm64') {
    console.log(`ℹ️  using pre-provisioned native arm64 ffmpeg for ${key}`)
    return cacheNativeFfmpeg(ffmpegStaticBinary(platform), dest, key)
  }
```

Finally, add the export at the bottom of the file, next to the other `module.exports.*` lines:

```js
module.exports.cacheNativeFfmpeg = cacheNativeFfmpeg
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:main -- ensure-media-binaries`
Expected: PASS (existing `verifyBinary` tests + the two new `cacheNativeFfmpeg` tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/ensure-media-binaries.js scripts/ensure-media-binaries.test.mjs
git commit -m "build(win-arm64): consume pre-provisioned ffmpeg in beforePack"
```

---

### Task 5: Documentation + third-party license

**Files:**
- Modify: `docs/build/windows.md` (add an ARM64 section after "Building a Windows installer")
- Modify: `THIRD-PARTY-LICENSES.md` (record the tordona ffmpeg binary)

**Interfaces:**
- Consumes: nothing (docs).
- Produces: contributor-facing build docs + license attribution.

- [ ] **Step 1: Add the ARM64 section to `docs/build/windows.md`**

Insert this section immediately after the "Building a Windows installer" section (before "node-pty build failures on Windows 11"):

````markdown
## Building on Windows ARM64

Erfana builds and runs **natively** on Windows-on-ARM (arm64) hosts.

**Extra toolchain requirement:** in the Visual Studio 2022 Build Tools installer,
add the **MSVC v143 — ARM64 build tools** individual component (alongside the
x64 component from step 3). `node-pty`'s native addon is rebuilt for arm64 by
`electron-builder install-app-deps` during `postinstall`, and that needs the
ARM64 compiler.

**ffmpeg / ffprobe:** `ffmpeg-static` and `ffprobe-static` publish no
win32-arm64 binary. `npm install`'s `postinstall` therefore runs
`scripts/fetch-ffmpeg-arm64.mjs`, which downloads a pinned, SHA-256-verified
native arm64 build from
[`tordona/ffmpeg-win-arm64`](https://github.com/tordona/ffmpeg-win-arm64)
(release `8.1.2`, `full-static`) and installs `ffmpeg.exe` / `ffprobe.exe` into
`node_modules`. The script is a no-op on every other platform.

> **Trust caveat:** the tordona binary is a community maintainer's build. We pin
> its published SHA-256 (`8af8143d…4981`), but this is trust-on-first-use — it
> is **not** covered by the minisign-signed trust chain used for whisper.cpp.
> Re-pin by bumping `TAG` / `ASSET` / `ARCHIVE_SHA256` in
> `scripts/fetch-ffmpeg-arm64.mjs` together (hash from the release's
> `<asset>.sha256` companion).

**Build:**

```powershell
npm run build:win
```

produces an arm64 NSIS installer in `release/{version}/`.

**Local Whisper transcription is not available on ARM64** (upstream whisper.cpp
ships no win-arm64 binary). Transcription still works via the OpenAI API
backend. See [`docs/windows/README.md`](../windows/README.md) for the ARM64
scope boundary.
````

- [ ] **Step 2: Add the third-party license entry**

Append an entry to `THIRD-PARTY-LICENSES.md` following the file's existing entry format (match the surrounding heading level and field layout). Content:

```markdown
### FFmpeg (Windows ARM64 binary)

- **Source:** https://github.com/tordona/ffmpeg-win-arm64 (release `8.1.2`, `full-static`)
- **Component:** FFmpeg — https://ffmpeg.org
- **License:** GPL/LGPL (per the FFmpeg build configuration)
- **Usage:** bundled `ffmpeg.exe` / `ffprobe.exe` on Windows-ARM64 builds only,
  provisioned by `scripts/fetch-ffmpeg-arm64.mjs`. Not present on macOS or
  Windows-x64 builds (those use `ffmpeg-static` / `ffprobe-static`).
```

- [ ] **Step 3: Verify docs lint + headers**

Run: `npm run check:headers && npx reuse lint`
Expected: no new violations. (If `reuse lint` flags `THIRD-PARTY-LICENSES.md` or the docs, they are pre-existing/allowlisted — confirm no *new* errors were introduced by these edits.)

- [ ] **Step 4: Commit**

```bash
git add docs/build/windows.md THIRD-PARTY-LICENSES.md
git commit -m "docs(win-arm64): document native ARM64 build + ffmpeg attribution"
```

---

### Task 6: End-to-end verification on the ARM64 host

**Files:** none (acceptance gate).

**Interfaces:**
- Consumes: all prior tasks.
- Produces: proof the build works and runs on Windows-ARM64.

> Run these on the Windows-on-ARM machine. This is the real acceptance test; the
> unit tests above only cover the pure helpers.

- [ ] **Step 1: Clean install self-provisions ffmpeg**

Run:
```bash
npm install
node -e "const fs=require('fs');const f='node_modules/ffmpeg-static/ffmpeg.exe';const p='node_modules/ffprobe-static/bin/win32/arm64/ffprobe.exe';console.log('ffmpeg',fs.statSync(f).size);console.log('ffprobe',fs.statSync(p).size)"
```
Expected: `npm install` completes (node-pty rebuilds for arm64); both files exist and are multi-MB.

- [ ] **Step 2: Confirm the binaries are native arm64 (not x64)**

Run:
```bash
node -e "const fs=require('fs');const b=fs.readFileSync('node_modules/ffmpeg-static/ffmpeg.exe');const off=b.readUInt32LE(0x3c);const machine=b.readUInt16LE(off+4);console.log('0x'+machine.toString(16))"
```
Expected: `0xaa64` (IMAGE_FILE_MACHINE_ARM64). `0x8664` would mean an x64 binary slipped in — fail.

- [ ] **Step 3: Static checks**

Run: `npm run typecheck && npm run lint && npm run test:main`
Expected: all pass.

- [ ] **Step 4: Dev smoke test**

Run: `npm run dev`
Expected: Erfana launches; the terminal panel opens (node-pty works). Close it.

- [ ] **Step 5: Build the arm64 installer**

Run: `npm run build:win`
Expected: succeeds; `release/<version>/Erfana-<version>-setup.exe` exists. The beforePack log shows `using pre-provisioned native arm64 ffmpeg for win32-arm64`, and afterPack logs `Packed media binaries verified (win32-arm64)` and the ffprobe/node-pty prune keeping `win32/arm64`.

- [ ] **Step 6: Install + launch**

Install from the generated `-setup.exe` and launch. Confirm the app opens, the terminal works, and (optional) importing a short video for API transcription resolves ffmpeg/ffprobe without an ENOENT error (requires an OpenAI API key configured).

- [ ] **Step 7: Final commit (if any doc/status tweaks were needed)**

```bash
git add -A
git commit -m "chore(win-arm64): verification pass" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- arm64 win target → Task 1 ✓
- native ffmpeg/ffprobe fetch (pinned, SHA-verified, extract, place) → Task 2 ✓
- postinstall self-provisioning → Task 3 ✓
- beforePack arm64 branch (no installer 404; size-only verify) → Task 4 ✓
- afterPack unchanged → documented (no task needed) ✓
- docs + trust caveat + license → Task 5 ✓
- whisper.cpp stays disabled, no code change → confirmed in Global Constraints; no task ✓
- node-pty / Electron arm64 handled by existing tooling → documented in Task 5 + verified in Task 6 ✓
- end-to-end build + run → Task 6 ✓

**Placeholder scan:** no TBD/TODO; all code steps show full code; all commands have expected output.

**Type consistency:** `cacheNativeFfmpeg(staticBin, dest, key)` defined in Task 4 matches its test call and its use inside `cacheFfmpegArch`. `isTargetPlatform`/`assertArchiveSha`/`findExe`/`ffmpegDest`/`ffprobeDest` signatures match between the Task 2 script and its test. `ARCHIVE_SHA256` value is identical across the script, the docs, and the Global Constraints.

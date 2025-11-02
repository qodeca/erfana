# Build Optimization

Guide for optimizing Erfana's production build size and configuration.

## Overview

Erfana uses electron-builder 25.1.8 to package the application for distribution. This document covers build optimization patterns, common pitfalls, and troubleshooting.

**Current Build Size** (v0.3.7, macOS universal):
- DMG: 231 MB
- ZIP: 223 MB
- app.asar: 289 MB

These sizes are normal for a universal Electron app with Monaco Editor and Mermaid.

## electron-builder.yml Configuration

### Critical Exclusions

**Problem Solved** (v0.3.7): Recursive packaging caused 3.6GB DMG instead of 231MB.

**Root Cause**: Missing `!release/**` exclusion caused each build to include all previous builds recursively.

**Solution**: Add exclusions to `files:` array in `electron-builder.yml`:

```yaml
files:
  - '!**/.vscode/*'
  - '!src/*'
  - '!electron.vite.config.{js,ts,mjs,cjs}'
  - '!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}'
  - '!{.env,.env.*,.npmrc,pnpm-lock.yaml}'
  - '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
  - '!docs/**'
  - '!release/**'           # ✅ Critical - prevents recursive packaging
  - '!coverage/**'          # Exclude test coverage
  - '!tests/**'             # Exclude test files
  - '!vitest.*.ts'          # Exclude vitest configs
  - '!tsconfig.test.json'   # Exclude test TypeScript config
  - '!*.md'                 # Exclude markdown files
```

**Why These Exclusions Matter**:
- `!release/**`: Prevents exponential growth from including previous builds
- `!coverage/**`: Excludes test coverage reports (not needed in production)
- `!tests/**` + `!vitest.*.ts`: Excludes test files and configurations
- `!*.md`: Excludes documentation (CLAUDE.md, README.md, etc.)

### Directory Configuration

```yaml
directories:
  buildResources: resources
  output: release/${version}  # Creates versioned output directories
```

The `output` pattern creates separate folders for each version (e.g., `release/0.3.7/`), which is why excluding `release/` is critical.

### Universal Binary Configuration

```yaml
mac:
  target:
    - target: dmg
      arch: universal
    - target: zip
      arch: universal
```

Universal builds support both Intel (x64) and Apple Silicon (arm64), resulting in larger package sizes:
- Single architecture: ~150-180 MB
- Universal (x64 + arm64): ~230-250 MB

This is expected and normal.

## Build Size Breakdown

### Normal Size Components (231 MB DMG)

1. **Electron Framework**: ~120 MB
   - Universal binary includes both x64 and arm64 versions
   - Core Chromium engine and Node.js runtime

2. **Monaco Editor**: ~93 MB in node_modules
   - Includes all language definitions and features
   - Consider tree-shaking for size optimization (see below)

3. **Mermaid**: ~65 MB in node_modules
   - Diagram rendering engine with all diagram types
   - Difficult to tree-shake due to dynamic imports

4. **Other Dependencies**: ~50 MB
   - lucide-react (~33 MB): Icon library
   - dockview (~27 MB): Layout library
   - xterm.js addons (~10 MB): Terminal functionality
   - react-markdown + rehype/remark plugins (~15 MB)

5. **Application Code**: ~16 MB
   - Vite-bundled renderer (10.3 MB)
   - Main process (73 KB)
   - Preload script (7.6 KB)

### Abnormal Size Indicators

If your build exceeds 500 MB, investigate:
- Recursive packaging (check for `release/` in app.asar)
- Unexcluded development files (tests, coverage, docs)
- Source code accidentally included (check for `src/` in app.asar)
- Multiple copies of dependencies

## Verification Steps

### 1. Check DMG Size

```bash
ls -lh release/0.3.7/erfana-0.3.7.dmg
# Expected: ~230-250 MB for universal build
```

### 2. Inspect app.asar Contents

```bash
# List all files in app.asar
npx asar list release/0.3.7/mac-universal/Erfana.app/Contents/Resources/app.asar

# Check file count
npx asar list release/0.3.7/mac-universal/Erfana.app/Contents/Resources/app.asar | wc -l
# Expected: ~20,000-22,000 files

# Check for excluded directories (should return nothing)
npx asar list release/0.3.7/mac-universal/Erfana.app/Contents/Resources/app.asar | grep -E '^/(release|coverage|tests|vitest|src)'

# Check app.asar size
du -sh release/0.3.7/mac-universal/Erfana.app/Contents/Resources/app.asar
# Expected: ~280-300 MB
```

### 3. Check for Recursive Packaging

```bash
# Extract and inspect app.asar
npx asar extract release/0.3.7/mac-universal/Erfana.app/Contents/Resources/app.asar /tmp/erfana-asar-extracted

# Check for release directory (should not exist)
ls /tmp/erfana-asar-extracted/release
# Expected: ls: /tmp/erfana-asar-extracted/release: No such file or directory
```

## Troubleshooting Large Packages

### Issue: DMG exceeds 1 GB

**Likely Cause**: Recursive packaging

**Check**:
```bash
npx asar list release/0.3.7/mac-universal/Erfana.app/Contents/Resources/app.asar | grep "^/release"
```

**Fix**: Add `!release/**` to electron-builder.yml, delete `release/` directory, rebuild

### Issue: app.asar exceeds 500 MB

**Likely Cause**: Development files included

**Check**:
```bash
npx asar list release/0.3.7/mac-universal/Erfana.app/Contents/Resources/app.asar | grep -E "^/(coverage|tests|src|docs)"
```

**Fix**: Add appropriate exclusions to electron-builder.yml

### Issue: Source maps included

**Check**:
```bash
npx asar list release/0.3.7/mac-universal/Erfana.app/Contents/Resources/app.asar | grep "\.map$"
```

**Fix**: Ensure Vite build doesn't generate source maps in production (already configured in electron.vite.config.ts)

## Optional Optimizations

These won't solve packaging issues but can reduce final size by 10-20%:

### 1. Monaco Editor Tree-Shaking

**Potential Savings**: ~30-50 MB

Add to `electron.vite.config.ts`:

```typescript
import MonacoWebpackPlugin from 'monaco-editor-webpack-plugin'

export default defineConfig({
  renderer: {
    plugins: [
      react(),
      MonacoWebpackPlugin({
        languages: ['markdown', 'typescript', 'javascript', 'json', 'yaml'],
        features: [
          'bracketMatching',
          'clipboard',
          'coreCommands',
          'find',
          'folding',
          'links',
          'wordHighlighter'
        ]
      })
    ]
  }
})
```

**Trade-off**: Removes unused language support and features. Test thoroughly.

### 2. Universal Binary ASAR Merging

**Potential Savings**: ~20-30 MB

Add to `electron-builder.yml`:

```yaml
mac:
  mergeASARs: true  # Merge x64 and arm64 ASAR files
  x64ArchFiles: "Contents/Resources/app.asar.unpacked/node_modules/node-pty/**/*"
```

**Trade-off**: More complex build process. Only benefits universal builds.

## Production Build Checklist

Before creating a release:

- [ ] Clean `release/` directory: `rm -rf release/`
- [ ] Run tests: `npm run test`
- [ ] Run typecheck: `npm run typecheck`
- [ ] Run lint: `npm run lint`
- [ ] Build: `npm run build:mac`
- [ ] Verify DMG size: ~230-250 MB for universal
- [ ] Verify app.asar doesn't contain excluded directories
- [ ] Test DMG installation and app launch
- [ ] Check app functionality (project open, file operations, terminal)

## Build Commands

```bash
# Full production build for macOS
npm run build:mac

# Build for specific architecture
npm run build && electron-builder --mac --x64
npm run build && electron-builder --mac --arm64

# Build without packaging (faster for testing)
npm run build:unpack

# Build for other platforms
npm run build:win
npm run build:linux
```

## Common Issues

### Issue: "Failed to build on Python 3.13"

**Cause**: node-pty dependency requires distutils (removed in Python 3.13)

**Fix**: Use Python 3.12 or earlier

### Issue: "Code signing failed"

**Expected**: Erfana doesn't have a Developer ID certificate

**Result**: Build succeeds but app isn't code-signed (warns on first launch)

**For Distribution**: Obtain Apple Developer ID certificate for code signing

### Issue: "DMG creation failed on Intel Mac"

**Cause**: APFS format requires macOS 10.12+, detected arm64 process tries to use APFS

**Result**: electron-builder automatically falls back to compatible format

**No Action Needed**: Build will succeed with appropriate format

## References

- [electron-builder Documentation](https://www.electron.build/)
- [File Patterns](https://www.electron.build/configuration/contents.html#files)
- [macOS Configuration](https://www.electron.build/configuration/mac.html)
- [Vite Build Configuration](https://vitejs.dev/config/build-options.html)

## Related Documentation

- [Development Tasks](../development-tasks.md) - Build commands and workflows
- [Architecture](../architecture.md) - Application structure
- [Testing](../testing/README.md) - Quality assurance

---

**Last Updated**: v0.3.7 (November 2, 2025)

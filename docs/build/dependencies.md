# Dependency exclusions

**Last verified**: 2026-06-03 against v0.11.2 (`electron-builder.yml:28-30`).

This document explains which dependencies are excluded from production builds and why.

---

## Current Configuration

```yaml
# electron-builder.yml
files:
  - '!node_modules/jsdom/**'
  - '!node_modules/canvas/**'
  - '!node_modules/@mapbox/node-pre-gyp/**'
```

---

## Excluded Dependencies

### jsdom

**What**: JavaScript implementation of web standards for Node.js
**Size**: ~30 MB
**Used for**: Vitest + React Testing Library (test environment)
**Production need**: None

### canvas

**What**: Cairo-backed Canvas implementation for Node.js
**Size**: ~15 MB
**Used for**: Image manipulation in tests (jsdom dependency)
**Production need**: None

### @mapbox/node-pre-gyp

**What**: Native module installer
**Size**: ~5 MB
**Used for**: Installing canvas native binaries during development
**Production need**: None

---

## Why Exclusion Is Safe

1. **All three are devDependencies**:
   - Listed in `package.json` under `devDependencies`
   - Never imported by production code
   - Only used during `npm test`

2. **Test coverage unaffected**:
   - All tests still pass in development
   - Tests run before build, not during build

3. **App functionality unaffected**:
   - Production app never uses these modules
   - No runtime errors from exclusion

---

## Benefits

### Smaller app size

- **Saved by these exclusions**: ~50 MB.
- **Total app size**: figures below are from the v0.6.0 measurement and have not been re-measured against v0.11.2 (which dropped the macOS x64 + `.zip` + Windows portable artifacts; see `docs/CHANGELOG.md` v0.11.2). Re-measure on the next packaged build if a current figure is needed; the exclusions list itself is still correct.
  - *v0.6.0 reference*: 172-179 MB (vs 222-229 MB without exclusions).

### Faster Builds

- Less to copy during packaging
- Faster DMG/ZIP creation

### Cleaner Production Bundle

- Only production dependencies included
- Easier to audit for security issues

---

## Verification

To verify exclusions work correctly:

1. Build the app: `npm run build:mac`
2. Check excluded dependencies aren't present:
   ```bash
   ls release/*/mac/Erfana.app/Contents/Resources/app/node_modules/ | grep -E "jsdom|canvas|node-pre-gyp"
   # Should return nothing
   ```
3. Install and launch app - all functionality works

---

## Future Exclusions

Potential candidates for future exclusion:
- Test-only dependencies added later
- Documentation generators
- Development-only tooling

**Criteria for exclusion**:
- Listed in `devDependencies`
- Never imported by `src/main/`, `src/preload/`, or `src/renderer/`
- Size > 1 MB

---

See also: [ASAR Packaging](./asar.md) | [Build README](./README.md)

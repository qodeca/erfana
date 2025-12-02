# Electron Builder Configuration

**Last Updated**: December 2025 (v0.6.0)

This document explains the electron-builder version choice and the aproba workaround.

---

## Version Selection

### Current Configuration

```json
"electron-builder": "^26.0.0"
```

### Why Version 26?

- Latest version with newest features and security fixes
- Full support for Electron 39.2.4
- Correctly applies fuses via `afterPack` hook
- Workaround is simple and reliable

**Alternative Considered**:
- Downgrade to electron-builder 25.1.8 (works without workaround)
- **Rejected**: We want to stay current with latest tooling

---

## Known Issue: Aproba Bug

### Problem

electron-builder 26.0.0 has a dependency scanning bug ([Issue #8068](https://github.com/electron-userland/electron-builder/issues/8068)) that causes builds to fail with:

```
ENOENT: no such file or directory, scandir 'node_modules/aproba'
```

### Root Cause

- `aproba` is a deep transitive devDependency:
  - `jsdom → canvas → @mapbox/node-pre-gyp → npmlog → gauge → aproba`
- npm flattens dependencies to top-level, but electron-builder 26 expects nested structure
- Dependency scanner fails when transitive devDependency isn't found in expected location

---

## Automated Workaround

**Now automated** via `prebuild` npm script (runs before any `build:*` command):

```json
// package.json
"scripts": {
  "prebuild": "mkdir -p node_modules/aproba && echo '{}' > node_modules/aproba/package.json"
}
```

Just run:
```bash
npm run build:mac  # prebuild runs automatically
```

### How It Works

1. npm lifecycle: `prebuild` runs before `build:mac`
2. Creates `node_modules/aproba/` directory
3. Creates minimal `package.json` to satisfy dependency scanner
4. electron-builder proceeds without error

### Manual Override

If using custom build commands:
```bash
mkdir -p node_modules/aproba && echo '{}' > node_modules/aproba/package.json
```

---

## Status and Future

**Status**: Workaround automated in v0.6.0 via `prebuild` script

**Future**: Bug may be fixed in electron-builder 27+, at which point the `prebuild` script can be removed.

---

## References

- [electron-builder Issue #8068](https://github.com/electron-userland/electron-builder/issues/8068)
- [electron-builder Documentation](https://www.electron.build/)

---

See also: [Build README](./README.md) | [Troubleshooting](./troubleshooting.md)

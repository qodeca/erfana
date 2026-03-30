# Electron Builder Configuration

**Last Updated**: March 2026 (v0.9.0)

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
- Automated workaround for aproba bug (via `prebuild` script)

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

## Code signing hooks

electron-builder supports two lifecycle hooks that erfana uses for macOS builds:

| Hook | Script | Purpose |
|------|--------|---------|
| `afterPack` | `scripts/fuses.js` | Applies Electron fuses, resets ad-hoc signature on main binary |
| `afterSign` | `scripts/resign.js` | Deep re-signs entire `.app` bundle atomically |

```yaml
# electron-builder.yml
afterPack: ./scripts/fuses.js
afterSign: ./scripts/resign.js
```

**Why both hooks?** `flipFuses` modifies the main binary's code directory hash, causing signature mismatches with helper processes (GPU, Renderer, Network) and Electron Framework. The `afterSign` hook re-signs everything so macOS Sequoia+ accepts `@rpath` library loads between components.

See [Fuses](./fuses.md) for fuse configuration and [Security](../security.md) for the full signing rationale.

---

## Status and future

**Aproba**: Workaround automated in v0.6.0 via `prebuild` script. May be fixed in electron-builder 27+.

**Code signing**: Added in v0.8.2 after macOS Sequoia dyld crashes.

---

## References

- [electron-builder Issue #8068](https://github.com/electron-userland/electron-builder/issues/8068)
- [electron-builder Documentation](https://www.electron.build/)

---

See also: [Build README](./README.md) | [Troubleshooting](./troubleshooting.md)

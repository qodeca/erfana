### Internal

- **Release builds bundle with a bigger Node heap and a pinned Node patch.** The v0.23.0 tag run's
  macOS leg ran out of JavaScript heap in `electron-vite build` (exit 134), after its dry-run on the
  same commit had passed, so v0.23.0 was never published. The bundle step in `build_mac.yml` and
  `build_win.yml` now sets `--max-old-space-size=4096`, and both legs install Node 24.22.1 instead
  of whatever `24` the runner image caches. Incident memo: `docs/release-incidents/v0.23.0-attempt-1.md`.

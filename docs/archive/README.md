# Documentation Archive

This directory contains historical specification documents that are not part of active development.

## Contents

- [resolved-issues.md](./resolved-issues.md) – Issues fixed in past versions
- [2026-03-07-video-import-fixes.md](./2026-03-07-video-import-fixes.md) – Completed implementation plan for video import (#110)
- [changelog-v03-v05.md](./changelog-v03-v05.md) – Changelog entries for v0.3.0–v0.5.4
- [changelog-v08.md](./changelog-v08.md) – Changelog entries for the v0.8.x series (archived from `docs/CHANGELOG.md` during the Phase 2 Windows enablement trim)

## Restoring Archived Documentation

To restore archived documentation, use git to retrieve from history:
```bash
git log --all -- docs/archive/
git checkout <commit-hash> -- docs/archive/<folder>
```

## Previously Archived

### graph-engine-spec-2025 (Removed Dec 2025)
- **Reason**: Duplicate of `docs/future/graph-engine/`
- **Status**: Content preserved in `docs/future/graph-engine/`

# Local kit patches

This file lists local changes to copied kit files that an upgrade must preserve or upstream, so a kit refresh does not silently remove project-specific operating guarantees.

- Added `.xezar/docs/briefs.md` and linked it from the kit documentation and leader-guide detail to standardize row-specific dispatch briefs for issue #175.
- Configured the repository gate's two application lanes in `.xezar/pipeline/config.json`, bounded its config read in `gate-parallel.mjs`, recorded the resolved schedule, kept coverage ahead of unit tests and build, and switched lint to read-only `lint:check` for issue #169.

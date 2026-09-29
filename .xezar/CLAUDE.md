# The Xezar kit in this repository

- `.xezar/checks/`, `.xezar/workflows/`, `.xezar/skills/` and `.xezar/docs/` are copied from the
  kit (MIT, see `REUSE.toml`). Change them through a pull request; every change is a trust boundary
  (`CODE_REVIEW.md`).
- The committed project config carries no global resource limits (`maxParallel`, `memoryLimitMb`):
  a machine-sized ceiling is a property of a machine, not of the project.
- Never stop a process by command-line pattern (`pkill -f`): it matches every peer agent on this
  machine. Stop only a PID you started.
- Local working state lives in `.local/xezar/` (git-ignored), in its named subfolders only.
- Routing is `.xezar/routing.json`, read only through `node .xezar/checks/route.mjs`.

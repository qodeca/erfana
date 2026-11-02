# ADR 0009: The browser profile and its trust decisions live in the project folder

- **Status**: proposed – revised 2026-11-02 after the expert panel (the location itself is an owner decision of 2026-11-01)
- **Date**: 2026-11-02
- **Deciders**: Marcin Obel (owner, pending), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-006, 025-FR-008, 025-FR-011, 025-FR-015, 025-FR-016, 025-FR-018, 025-FR-019, 025-FR-021 to 025-FR-023, 025-FR-039, 025-FR-063 · [05-notes](../../specs/spec-t4-025-built-in-browser/requirements/05-notes.md) § Accepted risks · [ADR 0010](./0010-turn-on-cookie-encryption.md) · [ADR 0012](./0012-local-files-through-a-dedicated-scheme.md) · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 3

## Context

Each project keeps its browser profile in `<project>/.erfana/browser/` (owner, 2026-11-01). The accepted risks: the agent, scripts, sync, archives and build contexts can read or change it; `git clean -fdx` deletes it. Open points: how the folder is created and guarded, where Erfana's own trust decisions live, how a **cloned** profile is treated, how deletes stay inside the project, how Linux without a keyring behaves, and how Erfana's separate window processes share a session.

Facts: `session.fromPath` gives a persistent session per absolute path ([Electron session](https://www.electronjs.org/docs/latest/api/session)); a session cannot be destroyed while the app runs; there is no per-session cache-size setter, and `--disk-cache-size` sets the maximum of each disk cache (per session, inferred). Erfana opens each window as its own process and locks a project to one of them (`ProjectLockService`). `lockHmac.ts` keeps a `safeStorage`-encrypted secret and **turns signing off** on Linux `basic_text`.

## Decision

1. **Layout.** `.erfana/browser/.gitignore` (exactly `*`, spec change S-20); `profile/` (Chromium); `profile/Erfana/` (Erfana: `marker.json`, `trust.json`, `credentials.json`, `zoom.json`, `history.json`, `notices.json`, `keyring-canary.bin`); `captures/`.
2. **Guards before the session exists** (`browserProfileGuards.ts`): canonical project path (`realpathSync.native`); per level (`.erfana`, `browser`, `.gitignore`, `profile`, `profile/Erfana`, `captures`) `lstat` without following links, refuse symlinks and junctions, require the real path inside the project; create one level at a time; files with exclusive no-follow flags (Windows: `wx`, then `fstat` and a real-path re-check). Re-run before each capture write. Failure refuses the tab with a toast. `erfanaDirGate.ts`'s first step is reused.
3. **A cloned or copied profile is set aside** (spec change S-12). `marker.json` holds the canonical project path and creation time, HMAC-signed; a copy of the signed marker is kept in `~/.erfana/browser-profiles/<hash of canonical path>.json`. At session creation the profile is trusted only if both copies verify and match. It is also untrusted if `git ls-files .erfana/browser` lists anything (the folder was committed). An untrusted profile is renamed to `.erfana/browser/profile.untrusted-<UTC time>` (guarded like a delete) and a fresh one is created – a cloned repository's service worker, cache or local storage never runs.
4. **One session per project, one process per project** (spec change S-24). `session.fromPath(<canonical>/.erfana/browser/profile)` in the process that holds the project lock. Since every window is its own process, "share one session across windows" means across windows of that process; a second process that opens the project's browser while the lock is held elsewhere is refused with a toast naming the holder, and a stale lock is taken over through `ProjectLockService`'s existing rules. Popups are the only windows that share a tab's session across windows.
5. **Registered ids, not session lookups, decide exemptions.** `browserSessionRegistry.ts` records each browser session; `BrowserTabService` and `BrowserPopupWindow` register each view's `webContents` id **synchronously** when they create it. In `web-contents-created`, a `webContents` whose session is a browser session but whose id is not registered is destroyed at once and logged (fail closed); only registered ids skip the `webContentsBaseline`.
6. **Signed trust files.** `trust.json`, `credentials.json`, `zoom.json`, `history.json` and `notices.json` carry HMAC-SHA-256 over `{ kind, generation, canonical project path, content }`; the generation counter lives in `~/.erfana/browser-profiles/<hash>.json`, so an older signed file replayed into the folder is refused. A failing file is ignored, replaced on the next write, and logged (event and path only).
7. **Linux `basic_text` (no keyring).** There is no OS-protected key, and `lockHmac` signs nothing there. Behaviour: trust decisions, saved sign-ins and zoom are kept **in memory for the session only** (spec change S-26, extending 025-FR-022's rule); history and notices are kept unsigned; the per-folder origin key of ADR 0012 comes from a per-install random salt in `~/.erfana/` (unencrypted); no keyring canary is written; a switch from a keyring backend to `basic_text` is detected from the backend name recorded in `notices.json` and shows "Logins were reset because the keyring changed". Unit tests run every rule per backend (`keychain`, `dpapi`, `gnome_libsecret`, `kwallet*`, `basic_text`).
8. **Keyring canary** (other backends): at session creation decrypt `keyring-canary.bin`; on failure show the reset notice once and rewrite it.
9. **Cache cap**: `--disk-cache-size=536870912` before `app.whenReady()` (spec change S-5).
10. **Kept out of Erfana's views**: `.erfana/browser` always excluded from the project tree, watcher and git polling. Best effort against cloud sync: set `com.dropbox.ignored` and the macOS File Provider ignore attribute on `.erfana/browser` where the platform supports it; failures are logged, never fatal.
11. **Deletes stay inside.** Before **every** delete (Clear's capture step, Forget, expiry, setting a profile aside) the per-level link check of decision 2 runs again, and the target's real path must equal `<canonical>/.erfana/browser` or a path under it. Windows pending deletes are stored in `~/.erfana/browser-pending-deletes.json` as project canonical path plus relative path, HMAC-signed, and re-guarded before they run at the next start.
12. **Clear and Forget**: Clear uses `clearStorageData`, `clearCache`, `clearAuthCache`, `closeAllConnections` and the matching keys of Erfana's files, each under a 10 s `withTimeout`. Forget closes the project's browser tabs, clears every storage, then deletes `.erfana/browser/`.
13. **No tabs restored**: no tab list is stored anywhere (025-FR-006).
14. **Project switch in a window** (`ProjectService` session change): end pick mode, abort a capture write and delete its partial files, then close the old project's browser views – in that order – before the new project opens.

## Consequences

- Planted or replayed trust files grant nothing; a cloned profile never runs; reading cookies, storage and cache stays possible for same-user processes, as accepted.
- Linux without a keyring forgets permissions, certificate exceptions and zoom at quit.
- On Windows the project folder cannot be moved or deleted while the session is open (user guide).
- The HMAC is a guard, not a secret store: on Windows and Linux any same-user program can decrypt the `safeStorage` secret.

## Alternatives considered

- **Profile under the app's user-data folder** – out of the agent's reach, but the owner chose the project folder. Rejected by the owner.
- **Trust decisions in Chromium's stores** – Electron persists none of them. Rejected.
- **Unsigned trust files** – any project script could grant the camera or trust a forged certificate. Rejected (owner question Q3 confirms).
- **Trust a cloned profile** – a repository could ship a service worker that runs on the user's first visit. Rejected.

## References

- [Electron – session](https://www.electronjs.org/docs/latest/api/session), [command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches)
- `src/main/utils/lockHmac.ts`, `src/main/services/ProjectLockService.ts`, `src/main/services/preview/erfanaDirGate.ts`

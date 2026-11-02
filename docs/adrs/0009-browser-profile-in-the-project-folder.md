# ADR 0009: The browser profile and its trust decisions live in the project folder

- **Status**: proposed
- **Date**: 2026-11-02
- **Deciders**: Marcin Obel (owner, pending – the location itself is an owner decision of 2026-11-01), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-006, 025-FR-015, 025-FR-016, 025-FR-018, 025-FR-019, 025-FR-021, 025-FR-022, 025-FR-023, 025-FR-039, 025-FR-063 · [05-notes](../../specs/spec-t4-025-built-in-browser/requirements/05-notes.md) § Accepted risks, § Data inventory · [ADR 0010](./0010-turn-on-cookie-encryption.md) · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 3

## Context

The owner decided on 2026-11-01 that each project keeps its own browser profile inside the project, in `<project>/.erfana/browser/`, so a signed-in staging session follows the project and never leaks to another project. The accepted risks list what that costs: the agent, project scripts, cloud sync, archives and Docker build contexts can read or change the profile, and `git clean -fdx` deletes it.

What is left to decide is how Erfana creates and guards that folder, where Erfana's own trust decisions go (site permissions, certificate exceptions, pop-up exceptions, saved sign-ins, per-site zoom, address history, the keyring notice), and how the session is shared and released. Facts that constrain it:

- Electron 44 offers `session.fromPath(path, options)`: a persistent session at an absolute path, returned again for the same path ([Electron session API](https://www.electronjs.org/docs/latest/api/session)). Electron cannot destroy a session while the app runs; its files stay open until quit.
- Electron has no per-session HTTP cache size setter; the process-wide `--disk-cache-size` switch is the documented control ([command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches)).
- Electron does not persist Chromium's per-host zoom levels across restarts (inferred: Electron has no prefs store for the host zoom map), so 025-FR-008's "kept for that site across restarts" needs Erfana's own store.
- The project folder is writable by the agent the user runs. A planted file could grant a site the camera, or trust a forged certificate.
- `src/main/utils/lockHmac.ts` already keeps a random secret encrypted with `safeStorage` and signs project-lock files with it.

## Decision

1. **Layout.**

   | Path | Owner | Holds |
   |---|---|---|
   | `.erfana/browser/.gitignore` | Erfana | `*` (025-FR-016) |
   | `.erfana/browser/profile/` | Chromium | Cookies, storage, cache, service workers |
   | `.erfana/browser/profile/Erfana/` | Erfana | `trust.json` (permissions, certificate exceptions, pop-up exceptions), `credentials.json` (saved sign-ins, each value `safeStorage`-encrypted), `zoom.json`, `history.json`, `notices.json`, `keyring-canary.bin` |
   | `.erfana/browser/captures/` | Erfana | Context files, screenshots, crops (025-FR-033) |

   Erfana's files sit inside `profile/` so that "profile data shall live in `.erfana/browser/profile/`" holds and Clear and Forget find them; the capitalised `Erfana` folder name is not one Chromium writes.
2. **Guards before the session exists** (`browserProfileGuards.ts`, new). On the first browser tab of a project: resolve the project's canonical path with `fs.realpathSync.native`; for each of `.erfana`, `.erfana/browser`, `.gitignore`, `profile`, `profile/Erfana` and `captures`, `lstat` without following links and refuse a symlink or junction (Node reports a Windows junction as a symbolic link), then confirm the real path stays inside the project. Create folders one level at a time and files with exclusive, no-follow flags (`O_CREAT | O_EXCL | O_NOFOLLOW` on macOS and Linux; on Windows, which has no `O_NOFOLLOW`, `wx` followed by an `fstat` and real-path re-check of the opened file). Ensure `.gitignore` holds a `*` line (append if other lines exist; never edit the project's own `.gitignore`). A failure refuses the tab with an error toast naming the path or reason. The same guard runs again before each capture write.
3. **One session per canonical project path**, created by `session.fromPath(<canonical>/.erfana/browser/profile, { cache: true })` only after step 2, and before any page loads in it the deny-by-default handlers of 025-FR-019 are installed (`browserSessionPolicy.ts`). `fromPath` returns the same session to every Erfana window that opens the project, which gives 025-FR-015's "share one session per project across windows". Erfana records the session in a process-wide set of browser sessions (`browserSessionRegistry.ts`), which the `webContentsBaseline` exemption and the IPC gate consult by identity.
4. **HTTP cache cap** with `app.commandLine.appendSwitch('disk-cache-size', '536870912')` before `app.whenReady()`. It is process-wide; the app's own session caches almost nothing, and preview sessions are in-memory.
5. **Erfana's trust decisions are signed.** `trust.json`, `credentials.json` and `zoom.json` carry an HMAC-SHA-256 over their content with a per-user secret kept like the lock secret (`safeStorage`-encrypted under `~/.erfana/`), bound to the project's canonical path. A file that fails verification is ignored and replaced on the next write, and the event is logged (event name and path only). A planted grant or certificate exception therefore has no effect, and a profile copied to another machine or account starts with no trust decisions, as it starts signed out (025-FR-015). On Linux `basic_text` the HMAC still runs, with Chromium's built-in key – weak, as 025-FR-018 says.
6. **Kept out of Erfana's own views.** `.erfana/browser` is an always-excluded path for the project tree, the directory watcher and git polling (`projectPathFilter.ts`, `DirectoryWatcherCore.ts`, `GitPollingService.ts` change).
7. **Clear and Forget.** Clear uses `clearStorageData` with the ticked storages, `clearCache`, `clearAuthCache`, `closeAllConnections` and the matching keys of Erfana's files, each step under a 10 s `withTimeout`. Forget closes the project's browser tabs, clears every storage, then deletes `.erfana/browser/`; files the running session holds open on Windows are recorded in `~/.erfana/browser-pending-deletes.json` and deleted at the next start, before any session exists.
8. **No tabs restored** (025-FR-006): Erfana stores no list of open browser tabs anywhere.
9. **Keyring changes are detected with a canary.** At session creation Erfana decrypts `keyring-canary.bin` with `safeStorage` (the same OS key that encrypts cookies). A failure, or a stored backend name that differs from `safeStorage.getSelectedStorageBackend()` on Linux, shows "Logins were reset because the keyring changed" once and writes a new canary (025-FR-018).

## Consequences

- **The accepted risks stand**, narrowed in one place: tampering with Erfana's trust files no longer grants anything, but reading the cookie database, local storage and cache stays possible for any same-user process, as documented (025-FR-044).
- **On Windows the project folder cannot be moved or deleted** while the session is open. The user guide says so (025-FR-015).
- **`git clean -fdx` deletes the profile and captures**, as accepted.
- **The cache switch is global**; a later feature that wants a different cap for another persistent session needs its own control.
- **The HMAC is a guard, not a secret store.** On Windows and Linux any same-user program can decrypt the `safeStorage` secret, as `lockHmac.ts` already records.

## Alternatives considered

### Profile under the app's user-data folder, keyed by project

- **Pros**: outside the agent's reach; no `.gitignore` handling; Erfana's own views never see it.
- **Cons**: the owner chose the project folder so the profile travels and is cleared with the project, and so a reviewer sees it next to the code.
- **Verdict**: rejected by the owner (2026-11-01).

### Erfana's trust decisions in Chromium's own stores

- **Pros**: one store.
- **Cons**: Electron exposes no persistent store for permissions, certificate exceptions or zoom; they reset at every start.
- **Verdict**: rejected; Erfana keeps its own files.

### Unsigned trust files

- **Pros**: simpler; a user can edit them by hand.
- **Cons**: any process in the project, the agent included, can grant a site the camera or trust a forged certificate by writing a JSON file.
- **Verdict**: rejected.

## References

- [Electron – session](https://www.electronjs.org/docs/latest/api/session) – `session.fromPath`, `clearStorageData`, `clearAuthCache`, `closeAllConnections`; no cache size setter
- [Electron – command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches) – `--disk-cache-size`
- `src/main/utils/lockHmac.ts` – the `safeStorage`-backed secret pattern reused here
- `src/main/services/preview/erfanaDirGate.ts` – the existing `.erfana/` symlink gate (`lstat`, non-recursive `mkdir`, real-path containment through `realPathWithin`); `browserProfileGuards.ts` reuses its first step and extends the same rule to every level below

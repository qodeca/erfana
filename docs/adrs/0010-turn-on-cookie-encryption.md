# ADR 0010: Turn on the `EnableCookieEncryption` fuse

- **Status**: proposed – supersedes the decision recorded in `scripts/fuses.js` (the `EnableCookieEncryption` comment, lines 705–709) and in [`docs/spikes/2026-10-22-asar-integrity.md`](../spikes/2026-10-22-asar-integrity.md) § Cookie encryption
- **Date**: 2026-11-02
- **Deciders**: Marcin Obel (owner, pending), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-015, 025-FR-017, 025-FR-018, 025-NFR-007, 025-NFR-010 · [05-notes](../../specs/spec-t4-025-built-in-browser/requirements/05-notes.md) 025-CA-005 · [ADR 0009](./0009-browser-profile-in-the-project-folder.md)

## Context

`scripts/fuses.js` keeps `EnableCookieEncryption` off, with the reason "the app persists no cookies worth protecting (file:// main window, in-memory preview partitions), and turning it on adds a keychain read at every start". The October 2026 spike reached the same answer and added: "Revisit if Erfana ever keeps a signed-in web session."

Spec 025 does exactly that: each project keeps a persistent browser profile in which the user signs in to staging and production sites (025-FR-015), and 025-FR-017 requires cookies on disk to be encrypted with the operating system's key store.

What Electron says about the fuse ([Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)):

- It encrypts the on-disk cookie store with OS-level keys; default off.
- Existing unencrypted cookies are encrypted on write.
- It is a one-way transition: disabling it later "will make your cookie store corrupt and useless".

What the code already does: `src/main/utils/lockHmac.ts` and `ApiKeyService` use `safeStorage`, which reads the same "Erfana Safe Storage" key from the OS key store the fuse would use (the spike records this), so a key-store read already happens at runtime whenever a project lock is taken.

## Decision

1. **Set `[FuseV1Options.EnableCookieEncryption]: true`** in `buildFuseConfig` (`scripts/fuses.js`), replacing the comment with one that names this ADR, the one-way rule and the start-up budget. Ship it in the first release that ships the browser, never earlier and never behind a flag (025-FR-040).
2. **Never turn it off again.** The fuse comment and the fuse unit test say so; a change to `false` fails the test with a message pointing here.
3. **Migration is "encrypt on write".** Nothing in Erfana's persistent stores today holds cookies (the app window's default session has none worth keeping; previews are in-memory), so there is no data to lose. Plain-text cookies from any earlier build are encrypted when next written (025-FR-017).
4. **Test where it applies.** Fuses are flipped only on packaged builds, so 025-AC-017 and 025-NFR-007 run in the `packaged` lane: the fuse read back from the packaged binary (`npx @electron/fuses read`), and a sign-in on the staging fixture followed by a search of the profile's cookie database for the plain-text cookie value (0 hits on macOS and Windows).
5. **Budget the start-up cost.** 025-NFR-010's ≤ 150 ms median growth over 10 cold starts is measured on each platform in the `bench` lane before release (025-AC-082). Because `safeStorage` already reads the same key, the added cost is expected to be small (inferred, unmeasured).
6. **Linux without a keyring** keeps working with Chromium's built-in key; 025-FR-018's notice and ADR 0009's keyring canary cover the weak protection and key changes.

## Consequences

- **One-way door, accepted.** Reverting signs every user out of every site in every project (025-CA-005).
- **The key lives in the OS**, so a profile copied to another machine or user account starts signed out, with no error (025-FR-015); ADR 0009's signed trust files reset the same way.
- **Every user pays the start-up read**, including users who never open a browser tab.
- **Only cookies are encrypted.** Local storage, IndexedDB, service-worker storage and the HTTP cache stay plain text, and on Windows any same-user process can decrypt the key; the user guide says both (025-FR-017, 025-FR-044).
- **Dev and unpackaged runs do not encrypt.** Developers testing sign-ins in `npm run dev` write plain-text cookies into the fixture projects; the e2e fixtures use throwaway credentials only.
- **A macOS keychain prompt** can appear for unsigned local builds the first time the key is created, as `safeStorage` already causes today; signed releases are not affected (inferred from the spike's notes).

## Alternatives considered

### Keep the fuse off and encrypt nothing

- **Pros**: no start-up cost; reversible.
- **Cons**: session cookies for client staging and production sites sit in plain text inside project folders that sync, archive and go into build contexts; fails 025-FR-017 and 025-NFR-007.
- **Verdict**: rejected – the spike's reason ("no cookies worth protecting") no longer holds.

### In-memory browser sessions (no cookies on disk)

- **Pros**: nothing to encrypt; nothing in the project folder.
- **Cons**: every restart signs the user out of every site; fails 025-FR-015 and 025-AC-015.
- **Verdict**: rejected.

### Encrypt the whole profile folder with Erfana's own key

- **Pros**: would cover local storage and the cache too.
- **Cons**: Chromium writes the profile directly; Electron offers no hook to encrypt its storage backends; a FUSE-style layer is out of reach for a desktop app on three platforms.
- **Verdict**: rejected; the limit is documented instead.

## References

- [Electron – fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) – `cookieEncryption`: encrypt-on-write, one-way
- `scripts/fuses.js` – `buildFuseConfig`, the comment this ADR supersedes
- `docs/spikes/2026-10-22-asar-integrity.md` § Cookie encryption – the earlier "off for now" and its revisit condition
- `src/main/utils/lockHmac.ts` – `safeStorage` already reading the same key

# Review record: 025-AC-040 (no flag or off-switch)

Reviewed 2026-11-03 on branch `feature/built-in-browser`. Requirement: 025-FR-040 – the browser ships on for everyone, with no setting, feature flag or hidden switch. The acceptance text is in `specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md` (section "025-AC-040: No flag").

## What was checked

| Check | Result | Evidence |
|---|---|---|
| A unit test walks every key of the global and project settings schemas and fails on any name matching `browser`, `webview`, `builtin web` or `inapp web` | Present, and the test proves the walk would catch a planted switch | `src/shared/browser/noBrowserSwitch.test.ts:32-36` (schemas), `:50-53` (planted `tools.builtInBrowser.enabled` is found) |
| The app store's `Settings` interface holds no browser key | Interface has five keys, none about the browser | `src/main/services/SettingsService.ts:24-30`; test at `noBrowserSwitch.test.ts:38-43` |
| The default global settings hold no browser key | Pinned by test | `noBrowserSwitch.test.ts:45-48` |
| No browser key in any settings schema file | Search for `browser` and `webview` (case-insensitive) in `src/shared/ipc/*settings-schema.ts` returned no match | review search, 2026-11-03 |
| No flag or environment switch in source | Search of `src/` for `enableBrowser`, `browserEnabled`, `disableBrowser`, `BROWSER_ENABLED`, `builtInBrowser`, `browser.enabled` matched only the planted fixture in the test above; search for `process.env.*BROWSER|WEBVIEW*` matched nothing | review search, 2026-11-03 |
| **New browser tab** is available by default | The File menu item is built with no condition, no `enabled` field and no `visible` field | `src/main/menu.ts:126-132` |

## Result

No setting, flag, environment variable or hidden control turns the browser off. The unit lane of 025-AC-040 is covered by the four tests above; this record covers the review lane.

## Limits of this review

- The search covers `src/`. A follow-up search (lead, 2026-11-03) of `package.json`, `electron.vite.config.ts`, `electron-builder*` and `scripts/*.js`/`*.mjs` for the same names found no compile-time switch.
- The menu check reads the source. It does not launch a fresh install.

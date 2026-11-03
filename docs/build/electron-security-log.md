# Electron security-release log

**Last updated**: November 2026 (spec 025, built-in browser)

Erfana's built-in browser (spec 025) opens any web site, so the Chromium inside Electron must stay patched. This log is the running record that 025-NFR-002 asks for: every Electron **security release** and the Erfana release that ships it, with the days between them. The target is **14 calendar days or fewer** for every row.

- **Security release**: an Electron release whose release notes list a Chromium security backport or a CVE.
- **Trigger**: Dependabot opens one pull request per Electron update, daily, outside the grouped npm updates (`.github/dependabot.yml`, 025-FR-041). That pull request is the owner's signal to start the clock.
- **Owner**: the project owner.
- **Supported major**: Erfana stays on an Electron major version that Electron still supports.
- **Review**: the log is reviewed at each Erfana release (025-AC-047, checked after the first release that ships the browser).
- **Cadence decision (2026-11-03)**: the owner kept the daily schedule for the whole npm block. Dependabot allows one block per ecosystem, directory and target branch, so Electron cannot have a daily block of its own; it stays out of both groups, and the grouped minor and patch pull requests are refreshed daily too. `scripts/dependabot-electron.test.mjs` (025-AC-041) fails if `electron` joins a group or the block leaves `daily`.
- **Baseline**: the browser is built on Electron 44.9.3 (Chromium 152.0.7977.167, `package.json` range `^44.9.0`). The first log row is the first Electron security release after the browser ships.

## How to add a row

1. When an Electron update pull request opens, read its release notes. If they name a Chromium security backport or a CVE, add a row with the Electron version and its release date.
2. When the Erfana release that bundles it is published, fill in the Erfana version, its date and the days between.
3. A row over 14 days gets a one-line reason in the Note column.

## Log

| Electron version | Electron release date | Security content (CVE or backport) | Erfana release | Erfana release date | Days | Note |
|---|---|---|---|---|---|---|
| – | – | – | – | – | – | No row yet: the browser has not shipped. The first row is added with the first security release after it ships. |

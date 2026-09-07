<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

## Summary

<!-- What does this PR change, and why? Link any related issue (e.g. "Closes #123"). -->

## Changes

<!-- Bullet the notable changes. -->

-

## Checklist

- [ ] Work is on a `feature/...` branch cut from the right integration branch, and this PR targets that same branch, not `main` — `develop` for general work, `graph` for graph-engine work.
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`).
- [ ] `npm run lint`, `npm run lint:css` and `npm run typecheck` pass.
- [ ] `npm run design -- --check` passes (regenerate with `npm run design` and commit if it does not).
- [ ] `npm run test:ci` passes (added/updated tests where it makes sense).
- [ ] `npm run test:cov` passes (`Coverage` is a required check, and `test:ci` does not run it).
- [ ] `npx electron-vite build` succeeds.
- [ ] `npm run check:headers` and `reuse lint` pass (SPDX headers / REUSE compliance).
- [ ] No secrets introduced — `Secret scan` is a required check and gitleaks scans every ref in the repo, not just this branch.
- [ ] Ran `npm run test:e2e` locally if this touches Electron-specific paths (CI does not cover e2e).
- [ ] Documentation updated if behavior or APIs changed.

> By opening this PR you agree to the project [Contributor License Agreement](../CLA.md); your Git author identity is your signature of record. (Automatic signature recording via a CLA-assistant bot may be added in the future.)

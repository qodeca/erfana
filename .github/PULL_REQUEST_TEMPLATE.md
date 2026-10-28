<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

## Summary

<!-- What does this PR change, and why? Link any related issue (e.g. "Closes #123"). -->

## Changes

<!-- Bullet the notable changes. -->

-

## Design

<!-- UI in scope = the renderer's screens, panels, dialogs and the preview, the words users read in them, the design system in docs/design-system/, or anything under docs/designs/. SDLC.md § The design gate. -->
- [ ] Not UI in scope
- [ ] UI in scope. Design: `docs/designs/<functionality>/` or "fix-sized"
- [ ] UI in scope, rendered output unchanged, because: <say why>
- [ ] UI changed: follows every card it touches; each departure has a `/* deviates: docs/design-system/<card>.html – why */` marker and a row in the card's Exceptions; a part no card covers has a new `proposed` card in this PR; no card was promoted to `decided`, changed in what it requires, or superseded (those are the owner's).

Design review evidence: <link to the "## Design review" comment or the design README section>

## Risk

<!-- Say whether the change touches a trust boundary (CODE_REVIEW.md § Trust boundaries): the preload bridge or IPC sender/schema validation, the HTML preview sandbox, the terminal/PTY, the Whisper or release trust chains, CI and release workflows, agent settings, a contract in BACKWARD_COMPATIBILITY.md, or broad edits across the tree. Say which, or "ordinary". A trust-boundary change gets a security review. -->

- [ ] This change touches a trust boundary: <which>

## Checklist

- [ ] Work is on a `feature/...` branch cut from the right integration branch, and this PR targets that same branch, not `main` — `develop` for general work, `graph` for graph-engine work.
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`).
- [ ] `npm run lint`, `npm run lint:css` and `npm run typecheck` pass.
- [ ] `npm run design -- --check` passes (stale values: run `npm run design` and commit; a guard failure – JavaScript, a broken link, a `deviates:` marker its card does not list – needs a fix).
- [ ] `npm run test:cov` passes – it runs every unit test once and checks the coverage floors the required `Unit tests` and `Coverage` checks enforce (added/updated tests where it makes sense).
- [ ] `npx electron-vite build` succeeds.
- [ ] `npm run check:headers` and `reuse lint` pass (SPDX headers / REUSE compliance).
- [ ] No secrets introduced — `Secret scan` is a required check and gitleaks scans every ref in the repo, not just this branch.
- [ ] Ran `npm run test:e2e` locally if this touches Electron-specific paths (CI runs e2e only in the advisory `E2E (Linux, xvfb)` job, which never blocks a merge).
- [ ] Documentation updated if behavior or APIs changed.

> By opening this PR you agree to the project [Contributor License Agreement](../CLA.md); your Git author identity is your signature of record. (Automatic signature recording via a CLA-assistant bot may be added in the future.)

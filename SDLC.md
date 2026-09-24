<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# How work moves in Erfana

Branches: `feature/<name>` -> `develop` -> `main`. `main` holds released code only; `develop` is the
integration branch and the base branch for all agent work. `graph` is the integration branch for
the graph engine (spec 004 and the #21 chain): graph-engine work branches from `graph`, merges back
into `graph`, and is started only by the owner. Pull requests squash-merge through the pipeline, so
the title becomes the commit: Conventional Commits.

The gate is `.xezar/checks/repo-gates.sh` (the list is in `AGENTS.md`). The GitHub checks that gate
a merge are `Lint`, `Typecheck`, `Unit tests`, `Build`, `Coverage`, `License compliance` and
`Secret scan`. `e2e` does not run in CI: a change to Electron-specific paths runs
`npm run test:e2e` locally before it merges.

## The QA gate

On. A change a user can see carries `needs-qa` and does not merge until `qa-approved` (or the
self-verification exception below). A change with no visible effect carries `skip-qa`.

## The design gate

On, because Erfana has screens: the renderer, its panels, dialogs and the preview. A change marked
`needs-design` does not pass review until `design-approved`. The design system is `design/`
(open `design/index.html`); a card marked `status="decided"` is binding. Designs live in
`docs/designs/`. The whole design half is installed either way; to switch the gate off, set
`gates.designGate` to `false` in `.xezar/pipeline/config.json`.

## Review loop

Every change is reviewed by a different model from the one that wrote it. A finding is closed only
as fixed (with the commit), disputed with evidence, or deferred to a filed issue.

**Naming the break.** A new or changed behaviour test names a concrete regression - the file, the
line, and the change that would cause it - and the author records an actual failing run, quoting
the assertion that failed. A test written after the diagnosis passes against the bug more often
than anyone expects, and a green-either-way test is how the same regression ships twice. Guard tests
that pass both ways are fine and worth keeping; the record just says which kind each one is.

## Self-review inside the author phase, and the repair counters

The author runs the gate and reads its own diff before handing over. Two repair rounds on the same
piece of work are normal; a third needs the owner.

## The QA and design self-verification exceptions

A run may verify its own visible change only when no independent QA is available, and then it applies
`qa-self-verified` beside the approval, so a reader can tell a self-check from a sign-off. The same
rule applies to design review.

## Security review

A change that touches a trust boundary (see `CODE_REVIEW.md`) or carries `risk-high` gets the
security-review row. It reads `SECURITY.md` and `docs/security.md` first.

## Architecture review

A change that binds future work - a new IPC domain, a new main-process service, a new trust
boundary, a new dependency with native code - gets an architecture review, and a decision record in
`docs/adrs/` when it is expensive to reverse.

## Acceptance

Acceptance checks each accepted criterion of the issue (and of its spec in `specs/`, when it has
one) against the merged change on `develop`.

## Deploy authority

Erfana has no deploy environment: it ships as signed desktop releases. A release is the owner's
call and runs through the `releasing-erfana` skill and `release.yml` from a signed `v*.*.*` tag on
`main`. The pipeline's own deploy and rollback workflows are asleep here: `deploy.environments`
and `deploy.rollback` are `[]`. Performance budgets are `[]`. Localisation is `[]`: the app has no
locale files. Each of these parts is installed; adding an entry to its list in
`.xezar/pipeline/config.json` wakes it.

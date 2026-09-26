# Dispatch brief templates

Use these templates after classifying the task with `node .xezar/checks/route.mjs --rows`
and selecting its row. They turn the row into a bounded dispatch: replace every angle-bracket
field with task-specific facts, retain the standing lines verbatim, and remove sections that do
not apply only when the brief explains why. A route is data, not authority: the accepted issue,
campaign plan, and project rules still define what may be done.

The examples reflect recent dispatched work: a dependency-maintenance change named the package,
lockfile, packaging guard, tests, and current documentation; a docs-writing task named its source
pages and retained inbound anchors; and review briefs named the exact PR head, base, and verdict
boundary. Keep that concrete level of detail without copying a previous task's conclusions.

## Bounded bug fix (`bounded-bug-fix`)

Use when both the failing test and the one file that needs changing are known.

```text
Fix <observable bug> by changing <single file>. The failing test is <test path and test name>.

Owned paths: <path>, <test path>.
Do not touch: <paths or areas owned by other work>.
Success means: <the named regression is fixed and the test proves it>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Multi-file implementation (`multi-file-implementation`)

Use when the design is settled and implementing it spans multiple non-UI files.

```text
Implement <settled behaviour> from <issue/spec/accepted decision>. Preserve <relevant contract or compatibility rule>.

Owned paths: <implementation paths>, <test paths>, <directly affected docs if any>.
Do not touch: <UI/design paths, shared files, or parallel-task paths>.
Acceptance criteria: <criterion IDs and observable outcomes>.
Dependencies and interfaces to preserve: <named modules, schemas, or APIs>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Kit refactor (`kit-refactor`)

Use for pipeline tooling, checks, workflows, skills, routing, or other kit mechanics rather than
product behaviour. State the current guarantee explicitly, because these paths are a trust boundary.

```text
Refactor <kit mechanism> while preserving <load-bearing guarantee and default-path behaviour>.
Before changing it, identify every terminal state or caller that depends on the current mechanism.

Owned paths: <.xezar paths>, <tests/fixtures>, <kit docs>.
Do not touch: <project product paths, owner-maintained files, or parallel-task paths>.
Proof required: <focused fixtures/checks proving the preserved default path>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Dependency maintenance (`dependency-maintenance`)

Use for a dependency bump or resolution change, with the gate judging compatibility.

```text
Update <dependency and old/new version or resolution> for <reason>. Check the resulting lockfile and any install, build, packaging, or runtime path affected by the dependency.

Owned paths: <manifest>, <lockfile>, <direct tests/docs/allowlists>.
Do not touch: <unrelated dependency entries, generated output, or parallel-task paths>.
Evidence required: <install/build/package or regression evidence appropriate to the dependency>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Docs writing (`docs-writing`)

Use when the task needs authored prose, not merely moving paths or repairing links.

```text
Write or revise <document/audience/topic> using <canonical sources>. State what is observed, tested, live-verified, or still unknown; keep historical observations dated.

Owned paths: <documentation paths>, <indexes>, <assets if any>.
Do not touch: <generated copies, owner-maintained pages, or parallel-task paths>.
Reader outcome: <what a reader can now decide or do>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Full cold review (`full-cold-review`)

Use for an independent, read-only review of the full candidate rather than a claimed repair.

```text
Review <PR/commit> at head <SHA> against base <branch/SHA> and <issue/spec/accepted criteria>. Do not edit the author's checkout. Report only findings supported by file and line evidence; distinguish unverified claims from observed facts.

Owned paths: <review evidence/verdict path only, if applicable>.
Do not touch: <author checkout, product files, labels or comments not authorized by the review workflow>.
Review boundary: <what is in scope and what cannot be assessed>.

Finish in the foreground.
Do not run the gate; judge the author's gate evidence. Run a focused check only in your own prepared isolated checkout when a finding needs it.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
Keep the verdict under 3,000 characters, plain text, no backticks or dollar signs; if posting is refused, do not retry and do not post test comments; end with the full verdict as your final message.
```

## Scoped recheck (`scoped-recheck`)

Use to judge whether specified review findings are fixed; it does not authorize unrelated new review scope.

```text
Recheck <finding IDs> on <PR/commit> at head <SHA>. Compare each finding with <prior verdict/comment and required repair>; say fixed, still failing, disputed with evidence, or out of scope.

Owned paths: <review evidence/verdict path only, if applicable>.
Do not touch: <author checkout, product files, unrelated findings, or workflow state outside the recheck>.
Recheck boundary: <named findings and the prior head/base or comment>.

Finish in the foreground.
Do not run the gate; judge the author's gate evidence. Run a focused check only in your own prepared isolated checkout when a finding needs it.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
Keep the verdict under 3,000 characters, plain text, no backticks or dollar signs; if posting is refused, do not retry and do not post test comments; end with the full verdict as your final message.
```

## Security review (`security-review`)

Use for a read-only review of a trust boundary, a high-risk change, or a security claim. Name the
boundary and any evidence the reviewer cannot independently reproduce.

```text
Security-review <PR/commit> at head <SHA> against base <branch/SHA>. Assess <named trust boundary, threat, or security claim> and read the applicable security guidance before reaching a verdict.

Owned paths: <review evidence/verdict path only, if applicable>.
Do not touch: <author checkout, product files, secrets, or deployment/release state>.
Security boundary and evidence: <paths, threat model, known limitations, and required evidence>.

Finish in the foreground.
Do not run the gate; judge the author's gate evidence. Run a focused check only in your own prepared isolated checkout when a finding needs it.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
Keep the verdict under 3,000 characters, plain text, no backticks or dollar signs; if posting is refused, do not retry and do not post test comments; end with the full verdict as your final message.
```

## Browser QA (`browser-qa`)

Use for a one-time, independent judgment that this change works in the real interface; use
`ui-tests` instead when the requested output is a reusable automated test suite.

```text
QA <PR/commit> at head <SHA> in <environment/platform>. Exercise <user journeys and expected states>, including <error, empty, or regression states that matter>.

Owned paths: <QA evidence/verdict path only, screenshots if authorized>.
Do not touch: <author checkout, product files, generated captures not requested, or unrelated workflow state>.
QA boundary: <platform, data/setup, journeys, and known untestable conditions>.

Finish in the foreground.
Do not run the gate; judge the author's gate evidence. Run a focused check only in your own prepared isolated checkout when a finding needs it.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
Keep the verdict under 3,000 characters, plain text, no backticks or dollar signs; if posting is refused, do not retry and do not post test comments; end with the full verdict as your final message.
```

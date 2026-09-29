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

## Tracker only (`tracker-only`)

Use when the whole change is tracker state and no repository file changes; it produces no review verdict.

```text
Update <issue/PR> tracker state from <authorized source>; make no repository changes.

Owned paths: <authorized tracker labels/comments only>.
Do not touch: <repository files, unrelated tracker state, or parallel-task paths>.
Outcome: <the requested labels or comment reflect the authorized decision>.

Finish in the foreground.
Do not run the gate; judge the authorized tracker state. Run a focused check only when it is needed to support the update.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Issue filing (`issue-filing`)

Use when a problem or proposal needs one new issue and no repository change; it produces no review verdict.

```text
File one issue for <problem or proposal> from <authorized brief>, with the required title and fields.

Owned paths: <new issue only>.
Do not touch: <repository files, existing issues, or labels beyond the brief>.
Outcome: <one complete issue makes the problem or proposal actionable>.

Finish in the foreground.
Do not run the gate; judge the authorized filing brief. Run a focused check only when it is needed to support the filing.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Record recheck (`record-recheck`)

Use when one comment claims one record is wrong and the work is comparing those two things.

```text
Recheck <record> against <comment>; report whether the claimed discrepancy is supported.

Owned paths: <review evidence/verdict path only, if applicable>.
Do not touch: <author checkout, source record, unrelated comments, or workflow state>.
Evidence boundary: <the one record and one comment being compared>.

Finish in the foreground.
Do not run the gate; judge the author's gate evidence. Run a focused check only in your own prepared isolated checkout when a finding needs it.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
Keep the verdict under 3,000 characters, plain text, no backticks or dollar signs; if posting is refused, do not retry and do not post test comments; end with the full verdict as your final message.
```

## Evidence pass (`evidence-pass`)

Use when the work records what already happened and decides nothing new.

```text
Collect <gate evidence, phase record, or close-out facts> into <record> without deciding new work.

Owned paths: <evidence/record paths only>.
Do not touch: <author checkout, product files, prior evidence, or workflow state outside the record>.
Evidence boundary: <completed events and sources to record>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Mechanical docs (`mechanical-docs`)

Use when documentation needs only paths, counts, renames, or link fixes.

```text
Make mechanical documentation edits for <paths/counts/renames/links> from <canonical source>.

Owned paths: <documentation and index paths>.
Do not touch: <authored prose, generated copies, or parallel-task paths>.
Proof required: <link, path, count, or rename check>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Root-sync (`root-sync`)

Use when the checkout only needs a fast-forward to the moved base branch; the leader performs this itself and sends no brief.

## Analysis, specs, research (`analysis-specs-research`)

Use when a larger-than-one-file judgement or design is the output.

```text
Produce <analysis/spec/research> for <question> using <evidence and constraints>.

Owned paths: <analysis/spec/research paths>.
Do not touch: <product implementation, accepted decisions, or parallel-task paths>.
Outcome: <a documented judgement or design for the stated question>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Business analysis (`business-analysis`)

Use when the question is what to build or why rather than how; it produces no review verdict.

```text
Analyze <what to build or why> for <audience/context> using <evidence>.

Owned paths: <analysis paths>.
Do not touch: <technical design, product implementation, or parallel-task paths>.
Outcome: <a supported product or business judgement>.

Finish in the foreground.
Do not run the gate; judge the supplied question and evidence. Run a focused check only when it is needed to support the analysis.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Architecture decision (`architecture-decision`)

Use when the system cut, ownership, or a lasting quality must be decided beyond one feature.

```text
Decide <system cut, ownership, or quality> for <scope> and record the decision.

Owned paths: <decision record and directly affected architecture docs>.
Do not touch: <product implementation, feature-only decisions, or parallel-task paths>.
Outcome: <a recorded decision that guides work beyond this feature>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Spike (`spike`)

Use when one open technical question must be answered by trying it.

```text
Investigate whether <technical question> is possible, how hard it is, or how it behaves by trying <bounded experiment>.

Owned paths: <spike notes, experiment, and disposable fixtures>.
Do not touch: <production implementation, accepted decisions, or parallel-task paths>.
Evidence required: <observed experiment result and its limits>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Deprecation plan (`deprecation-plan`)

Use when something people depend on — a feature, an API, or a dependency — must be retired before anything is removed.

```text
Plan retirement of <feature/API/dependency> by documenting affected people, replacement, and dates.

Owned paths: <deprecation plan and affected documentation>.
Do not touch: <removal implementation, consumer data, or parallel-task paths>.
Acceptance criteria: <affected users, replacement, and dates are written down>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## UX design (`ux-design`)

Use when a surface needs its flow, first view, and every state designed before implementation.

```text
Design <surface> for <users and flow>, including what appears first and every state.

Owned paths: <UX design files and supporting docs>.
Do not touch: <product implementation, design-system changes, or parallel-task paths>.
Acceptance criteria: <flow, first view, and all states are represented>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Design review (`design-review`)

Use when a rendered screen or mockup must be judged visually.

```text
Review <screen/mockup> at <revision> against <design and states>; report visual findings with evidence.

Owned paths: <review evidence/verdict path only, if applicable>.
Do not touch: <author checkout, product files, design files, or unrelated workflow state>.
Review boundary: <rendered screen/mockup, design source, and states assessed>.

Finish in the foreground.
Do not run the gate; judge the author's gate evidence. Run a focused check only in your own prepared isolated checkout when a finding needs it.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
Keep the verdict under 3,000 characters, plain text, no backticks or dollar signs; if posting is refused, do not retry and do not post test comments; end with the full verdict as your final message.
```

## Design system (`design-system`)

Use when changing a token, component, or system page rather than one feature.

```text
Create, extend, or correct <token/component/system page> used by every design.

Owned paths: <design-system paths and tests>.
Do not touch: <feature-specific implementation, unrelated components, or parallel-task paths>.
Proof required: <system-wide rule and affected design states>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## UI design (`ui-design`)

Use when a landed flow needs components, tokens, layout, and all states in both themes.

```text
Design the visual layer for <landed surface> with <components, tokens, layout, and states> in both themes.

Owned paths: <UI design files and supporting docs>.
Do not touch: <product implementation, UX flow, design-system paths, or parallel-task paths>.
Acceptance criteria: <components, tokens, layout, and every state in both themes>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Generated images (`generated-images`)

Use when documentation or design needs an invented picture rather than a deterministic capture.

```text
Create <illustration/icon/image> for <documentation or design purpose>.

Owned paths: <image assets and direct references>.
Do not touch: <deterministic screenshot tooling, unrelated assets, or parallel-task paths>.
Outcome: <a new invented visual asset for the stated purpose>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Diagrams (`diagrams`)

Use when structure or data must be drawn correctly, usually from text or a plotting script.

```text
Draw <structure or data> as <Mermaid/SVG/chart/script>; establish correctness before appearance.

Owned paths: <diagram source and direct references>.
Do not touch: <unrelated visuals, source data, or parallel-task paths>.
Proof required: <the diagram's structure or numbers are correct>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Diagnose bug (`diagnose-bug`)

Use when the cause, failing file, and regression test are not yet known.

```text
Diagnose <broken behaviour>; find and prove its cause before proposing a fix.

Owned paths: <diagnostic evidence and minimal reproduction paths>.
Do not touch: <product fix, unrelated code, or parallel-task paths>.
Evidence required: <cause, affected file, and failing test or reproduction>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## UI implementation (`ui-implementation`)

Use when the change alters what a person sees on a screen.

```text
Implement <settled UI behaviour> from <design/accepted criteria>.

Owned paths: <UI implementation, tests, and direct docs>.
Do not touch: <design source, unrelated surfaces, or parallel-task paths>.
Acceptance criteria: <observable screen behaviour and states>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Conflict repair (`conflict-repair`)

Use when a PR conflicts with its base and the resolution needs judgement.

```text
Resolve <PR> conflicts with <base>; push the judged resolution to the PR branch.

Owned paths: <conflicted files and direct tests>.
Do not touch: <merge operation, unrelated files, or parallel-task paths>.
Boundary: <conflict resolution only; merge-chain lands the PR afterwards>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Merge chain (`merge-chain`)

Use when several approved PRs must land in order.

```text
Land approved PRs <in order> into <target branch>.

Owned paths: <named PR integration state only>.
Do not touch: <PR source changes, conflict resolution, or unrelated PRs>.
Outcome: <each approved PR lands in the required order>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Hotfix (`hotfix`)

Use when people are hitting a live fault and a narrow immediate fix costs less than waiting.

```text
Ship the narrowest fix for live fault <fault> now, with follow-up <full fix>.

Owned paths: <narrow fix, regression test, and release notes if required>.
Do not touch: <unrelated refactoring, broad remediation, or parallel-task paths>.
Acceptance criteria: <the live fault is relieved while the full fix remains tracked>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Refactor (`refactor`)

Use when product code structure changes but observable behaviour must not.

```text
Restructure <product code> without changing any user or caller observable behaviour.

Owned paths: <refactored code and proof tests>.
Do not touch: <behavioural contracts, kit tooling, or parallel-task paths>.
Proof required: <tests or comparison proving behaviour is unchanged>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Migration (`migration`)

Use when existing data, a schema, or a hand-authored format changes shape.

```text
Migrate <existing data/schema/format> from <old shape> to <new shape>.

Owned paths: <migration, compatibility tests, and direct docs>.
Do not touch: <unrelated data, external data without authorization, or parallel-task paths>.
Acceptance criteria: <existing material reaches the new shape safely>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Observability (`observability`)

Use when signals are needed to understand a part of the system without changing behaviour.

```text
Add <logs/metrics/alerts/runbook> so people can tell what <system part> is doing.

Owned paths: <observability code, runbook, and tests>.
Do not touch: <product behaviour, unrelated signals, or parallel-task paths>.
Outcome: <new signals explain the stated system behaviour without changing it>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Localisation (`localisation`)

Use when text must become translatable or a listed language must be added or updated.

```text
Make <text> translatable or add/update listed locale <language>.

Owned paths: <locale resources, implementation, tests, and direct docs>.
Do not touch: <unlisted locales, unrelated copy, or parallel-task paths>.
Acceptance criteria: <the stated text is translatable or the listed locale is current>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## UI tests (`ui-tests`)

Use when a real-interface browser test must protect a user-visible behaviour repeatedly.

```text
Build or maintain automated UI coverage for <user-visible behaviour> in the real interface.

Owned paths: <UI test, fixtures, and direct test docs>.
Do not touch: <product behaviour, one-time QA evidence, or parallel-task paths>.
Proof required: <the browser test protects the stated behaviour again and again>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Unit tests (`unit-tests`)

Use when one function, module, or class needs tests with collaborators faked.

```text
Add or maintain unit tests for <function/module/class> with collaborators faked.

Owned paths: <unit test, direct fixtures, and test docs if needed>.
Do not touch: <product behaviour, integration coverage, or parallel-task paths>.
Proof required: <one part is tested on its own>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Integration tests (`integration-tests`)

Use when the proof is that two real parts work together across a boundary.

```text
Add or maintain integration tests proving <real part A> works with <real part B> across <boundary>.

Owned paths: <integration test, fixtures, and direct test docs>.
Do not touch: <product behaviour, isolated unit coverage, or parallel-task paths>.
Proof required: <the two real parts work together>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Regression suite (`regression-suite`)

Use when curating the suite that pins past bugs.

```text
Curate regression coverage for <past bugs>, adding, repairing, or retiring <tests>.

Owned paths: <regression tests, fixtures, and direct test docs>.
Do not touch: <product behaviour, tests outside the stated history, or parallel-task paths>.
Proof required: <each kept test pins a past bug and each retired test guards nothing>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Performance (`performance`)

Use when speed must be measured against an owner-stated budget.

```text
Measure <operation/load> against owner-stated budget <budget>.

Owned paths: <benchmark, results, and direct docs>.
Do not touch: <unstated budgets, unrelated optimization, or parallel-task paths>.
Acceptance criteria: <measured result answers the stated budget>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Review response, one verdict (`review-response-one`)

Use when one review verdict must be answered or fixed.

```text
Answer or fix review verdict <verdict ID> on <PR/commit> with <evidence>.

Owned paths: <files needed for this verdict and response evidence>.
Do not touch: <unrelated findings, other review verdicts, or parallel-task paths>.
Acceptance criteria: <the one verdict is fixed, disputed with evidence, or deferred>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Review response, several verdicts (`review-response-several`)

Use when several review verdicts disagree or interact.

```text
Reconcile and answer review verdicts <verdict IDs> on <PR/commit>.

Owned paths: <files needed for the interacting verdicts and response evidence>.
Do not touch: <unrelated findings, non-interacting verdicts, or parallel-task paths>.
Acceptance criteria: <interactions are resolved and each verdict has an evidence-backed outcome>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Architecture review (`architecture-review`)

Use when a plan, spec, or diff must be judged against recorded architecture decisions.

```text
Review <plan/spec/diff> at <revision> against <recorded architecture decisions>.

Owned paths: <review evidence/verdict path only, if applicable>.
Do not touch: <author checkout, product files, architecture records, or unrelated workflow state>.
Review boundary: <artifact and recorded decisions being judged>.

Finish in the foreground.
Do not run the gate; judge the author's gate evidence. Run a focused check only in your own prepared isolated checkout when a finding needs it.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
Keep the verdict under 3,000 characters, plain text, no backticks or dollar signs; if posting is refused, do not retry and do not post test comments; end with the full verdict as your final message.
```

## Acceptance verification (`acceptance-verification`)

Use when a finished change must be run against every accepted issue criterion.

```text
Verify <finished change> against accepted criteria <criterion IDs> one by one by running it.

Owned paths: <acceptance evidence/verdict path only, if applicable>.
Do not touch: <author checkout, product files, acceptance criteria, or unrelated workflow state>.
Evidence boundary: <each accepted criterion and its observed run result>.

Finish in the foreground.
Do not run the gate; judge the author's gate evidence. Run a focused check only in your own prepared isolated checkout when a finding needs it.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
Keep the verdict under 3,000 characters, plain text, no backticks or dollar signs; if posting is refused, do not retry and do not post test comments; end with the full verdict as your final message.
```

## Verify strong claim (`verify-strong-claim`)

Use when a weaker lane reports a Major or Blocker that has not been confirmed.

```text
Verify <Major/Blocker claim> from <weaker lane> on <PR/commit> before it is treated as confirmed.

Owned paths: <review evidence/verdict path only, if applicable>.
Do not touch: <author checkout, product files, severity labels, or unrelated workflow state>.
Evidence boundary: <the reported claim, its source, and independent confirmation>.

Finish in the foreground.
Do not run the gate; judge the author's gate evidence. Run a focused check only in your own prepared isolated checkout when a finding needs it.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
Keep the verdict under 3,000 characters, plain text, no backticks or dollar signs; if posting is refused, do not retry and do not post test comments; end with the full verdict as your final message.
```

## Release (`release`)

Use when the owner gave the release go and quoted the commit.

```text
Release owner-approved commit <full SHA> under <release instructions>.

Owned paths: <named release state and release metadata only>.
Do not touch: <unapproved commits, deploy state, or parallel-task paths>.
Boundary: <the owner's release go and quoted commit>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Deploy (`deploy`)

Use when the owner authorized deployment to a named environment and quoted the full commit SHA.

```text
Deploy owner-approved commit <full SHA> to named environment <environment>, copying the owner's authorization into the launch text.

Owned paths: <named deployment state and deployment record only>.
Do not touch: <other environments, unquoted commits, or parallel-task paths>.
Boundary: <the owner's deployment go, named environment, and full SHA>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

## Rollback (`rollback`)

Use when the owner authorized a named environment to return to a named revision.

```text
Roll back named environment <environment> to <full SHA>, copying the owner's accepted one-way migration words into the launch text.

Owned paths: <named rollback state and rollback record only>.
Do not touch: <other environments, unapproved revisions, or parallel-task paths>.
Boundary: <the owner's rollback go, named environment, full SHA, and accepted migration>.

Finish in the foreground.
Run targeted tests while working. The workflow's gates step runs the full gate once, so do not run it yourself. In a standalone task with no gates step, run the gate once after the final commit.
Do not poll CI; the leader watches it.
Do not print, commit, upload, or put secrets in evidence; redact sensitive values in diagnostics.
Never stop a process by command-line pattern.
If a real decision comes up, write BLOCKED with the options.
```

# Leader guide – the reasoning

`.xezar/docs/leader-guide.md` is injected in full at every session start, resume, clear and
compaction, so it holds the **rules** and nothing else. This document holds the **reasons**. Open
it when a rule looks wrong, before you decide it does not apply. Nothing here relaxes the guide:
where the two seem to differ, the guide wins and the difference is a finding for the owner.

## Session start

- **Why re-read the campaign state every time.** A compaction keeps your sense of being mid-task
  and loses the facts. The four files are the facts. On an agent tool without a session-start hook
  nothing injects them, which is why the guide makes reading them a requirement.
- **Why loops are compared on both fields.** A schedule-only check passes a loop whose prompt has
  drifted, and a drifted prompt is a loop doing something nobody decided. Tearing all three down
  and re-creating them looks tidy and drops a pending L3 wake.
- **Why the file-ownership table is re-read before dispatch.** It is the input to every selection
  decision and the first thing a compaction loses.
- **Why an unreadable `unattended.json` is not `on`.** `on` removes three stops. A file you cannot
  parse must never be the thing that removes them.

## Standing loops

- **Why only L3 dispatches.** With one dispatcher and at most one pending wake, a double dispatch
  is impossible by construction rather than by timing. L1 and L2 can run at any moment precisely
  because they cannot start work.
- **Why least file overlap beats priority.** Two tasks on one file means the second one rebases,
  conflicts, or fails its gate at merge. A high-priority task that collides costs more than it
  saves; priority only chooses between tasks that do not collide.

## Owner-only decisions

- **The release go** reaches the world and cannot be recalled.
- **Deleting a record** means throwing away the trail of what happened — an issue, a branch, a
  campaign file, a git tag or a label. A worktree is your own scaffolding, not history, so it is
  not covered. Code removed inside a reviewed pull request is not covered either: it is reviewed
  before it lands, git retains it regardless, and stopping there would halt you on almost every
  refactor.
- **Why three stops survive unattended mode.** The release go, deleting a record and opening a
  campaign cannot be undone in the morning. The other three can, which is why you may decide them
  alone — and why each one is parked with how to undo it, and asked back.
- **Why nothing enforces the stops.** No hook guards them. If you misread one at 03:00, nothing
  catches it until the owner reads the morning report. The owner accepted that cost knowingly,
  which is a reason for more care, not less.
- **Why the restart budget lives on disk.** A resume is exactly the event that wipes the count
  from context, so it is incremented and committed before anything else. At three you stop: a
  crash then costs minutes, and a leader dying repeatedly on one cause must not loop on it until
  dawn.

## Records and honesty

- **Why write, then commit, then report.** The owner acts on what you report. A report about an
  event whose record is not committed is a claim nobody can check.
- **Why a confident wrong report is the worst outcome.** An admitted gap costs the owner a
  question. A confident wrong report costs whatever they do next on the strength of it.

## Direct pushes

Branch protection is configured without admin enforcement so that a record write does not cost a
pull request. Be clear about what that means:

- Nothing in the repository restricts the bypass to the three paths. It is scope-free. The list
  is a rule you follow, not a boundary that stops you.
- Two of the three are your own governing files. `leader-guide.md` defines what is owner-only, and
  `unattended.json` decides whether that list is six items or three. You can therefore rewrite
  your own constraints and push the change unreviewed.

That is a deliberate, accepted trade. It only stays safe because you do not use it for anything
else.

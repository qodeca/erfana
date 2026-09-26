# Leader-context loading: the committed guide a leader session reloads itself from

This is the standard for giving the AI session that **leads** this project its own durable
context: a committed **leader guide**, loaded automatically by a committed session-start hook,
together with the live campaign notes the guide points at.

It exists because a leader's rules and its current state must survive a new session and a
context-window compaction. A leader that loses either does not fail loudly — it keeps working from
whatever is left, which looks like ordinary work and is not.

Related: [campaign-notes.md](campaign-notes.md) — the authority on the campaign folder's own
contract — and [worktrees.md](worktrees.md) for the worktree rules this page's guard depends on.

## Purpose

A leader session is long-lived but not continuous. It starts, it is resumed, its context is cleared
or compacted, and each time the client may hand the model an empty conversation. Three things must
be re-established without a person retyping them:

- **Standing rules** — how tasks are routed, which gates are mandatory, the merge order and the
  attribution rules. These change rarely and must not be re-derived from scratch.
- **Live state** — the current release, open pull requests with their heads and verdicts, running
  tasks per account, and the single next action per item. These change hourly.
- **Owner decisions** — the exact words that authorize a deviation, kept so a later session can
  quote the authority instead of paraphrasing it.

The guide holds the first and third as durable text; the campaign notes hold the second. The hook
is what makes the client reload both without a prompt.

## The moving parts

| Path | What it is | Committed? |
| --- | --- | --- |
| `.xezar/docs/leader-guide.md` | The leader guide: rules, patterns, recovery steps, owner-only decisions, brief rules and a checklist. Generated during onboarding from the shipped template. | yes |
| `.claude/settings.json` | The Claude Code `SessionStart` hook that runs the loader. Un-ignored by `.gitignore`, which otherwise hides all of `.claude/`. | yes |
| `.xezar/checks/leader-context.sh` | The loader. Prints one JSON object when it should; prints nothing when it should not. | yes |
| `.xezar/campaigns/<yyyymmdd>-<code-name>/README.md` | Live campaign state, rewritten at every milestone. | **yes** |
| `.xezar/campaigns/<yyyymmdd>-<code-name>/decisions.md` | Owner decisions in the owner's exact words, append-only. | **yes** |
| `.xezar/campaigns/<yyyymmdd>-<code-name>/parked.md` | Calls the leader made alone while the owner was away. | **yes** |
| `.xezar/campaigns/<yyyymmdd>-<code-name>/timeline-<date>.md` | What happened, minute by minute, append-only. | **yes** |
| `.xezar/campaigns/<yyyymmdd>-<code-name>/archive-*.md` | Stale blocks, and copies of resolved decisions; never loaded, the loader only names them. An entry of `decisions.md` identical to one in `archive-decisions.md` is left out of the injected copy. | **yes** |
| `.xezar/checks/decisions-archive.mjs` | Appends resolved `decisions.md` entries verbatim to `archive-decisions.md`, which hides them from the injected context; never changes `decisions.md`. Run by hand; also the hook's filter (`--visible`). | yes |
| `.xezar/checks/leader-context.test.mjs` | Fixture tests for what the loader injects from a campaign folder. | yes |

The loader's documented JSON shape is checked by its allowlisted fixture. Values can vary with the
guide and campaign notes, while these keys are its stable output contract:

<!-- documented-output:leader-context -->
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "fixture-dependent text"
  }
}
```

The loader is deliberately tiny and dependency-free: a shell script that reads the guide and the
newest campaign folder, checks the guard, and prints one JSON object. It reads no configuration, so
a project that has the three committed files needs nothing else. The newest folder is chosen by
**name**, not by modification time: a restore or a `cp -r` can make an old folder look newest, while
compact start dates (`20260817-amber-ridge`) sort stably by name, and the loader walks them
newest-first and takes the first real directory.

## The guard, and why each rule exists

Claude Code reads a project's `.claude/settings.json` for **every** session started under that
project folder, and it finds project instructions by walking parent folders. A task worktree lives at
`.local/xezar/worktrees/<runId>`, inside the primary checkout, so a hook committed in the primary is
discovered by a task session too. That is the failure the guard closes: a task agent must never
receive leader rules. (Observed 2026-09-18: a local `.claude/CLAUDE.md` at the repository root was
loaded by every worktree session through the parent-folder walk, and there was no per-worktree way
to mute it.)

**A plain `claude` session in this checkout is a normal session, and that is on purpose.** The
guard's last rule is `XEZAR_LEADER=1`, so nothing about the leader reaches a session that did not
ask to be one. You can work in this project with an ordinary Claude Code session — a quick
question, a review, a refactor — and it gets no guide, no campaign notes and no claim to be
leading anything.

Two ways to start the leader, and they are equivalent:

```bash
./scripts/xezar-leader.sh                         # the launcher: checks the engine is up first
XEZAR_LEADER=1 claude --dangerously-load-development-channels server:xezar   # by hand
```

The launcher is preferred because it fails early and says why — a missing engine socket is a
one-line message rather than a leader session that quietly cannot reach the engine. The variable is
the only thing that matters to the hook, and it belongs to the process, so it survives `/clear` and
a compaction.

One exception, and it is deliberate: **while an onboarding is unfinished, every ordinary session in
the primary checkout gets one fixed line** saying so, leader or not (task sessions, worktrees and a
checkout with no guide stay silent, because those checks run first). That check sits above the
`XEZAR_LEADER` rule because a session that starts working on an unproved setup should know it,
whoever it is. It stops once `/xez-onboard-opinionated --verify` finishes with every line ticked.

`leader-context.sh` prints nothing when any of these is true, and prints the block only when none is:

1. **Linked worktree** — `git rev-parse --git-dir` differs from `git rev-parse --git-common-dir`.
   In the primary checkout the two are equal; in a linked worktree they differ, because a task's
   worktree shares the primary's common git directory. A checkout where neither command resolves a
   repository is silent too: the rule requires the two to be equal *and* present.
2. **A path under `.local/xezar/worktrees/`** — a belt-and-braces check that does not depend on git
   being installed or on either git command succeeding.
3. **`XEZ_HANDOFF_FILE`, `XEZ_TODOS_FILE` or `XEZ_TASK_ID` is set** — the engine sets these for a
   task, including a **Worktree-OFF** task running in the primary checkout, which neither of the
   first two rules catches. A silent rule that only understood worktrees would leave that task loud.
   `XEZ_TASK_ID` is the one that is unconditional and always non-empty. `XEZ_TODOS_FILE` is not its
   equal: when follow-ups are off the engine sets it to an **empty string**, and an empty value reads
   as absent, so that variable alone is not a signal. The loader tests all three with
   `[ -z "${VAR:-}" ]`, which silences a non-empty value and lets the empty one fall through.
4. **The guide is missing** — a project without a guide gets silence, not an error and not a
   half-loaded block.
5. **`XEZAR_LEADER` is not `1`** — the session was not started as the leader (see above). This is
   what keeps an ordinary Claude Code session in the same checkout ordinary. It is checked after the
   unfinished-onboarding line, so that line still reaches every ordinary session.

Everything else is loud. The silent cases matter as much as the loud one: they are what makes it safe
to commit the hook at all, and the test pins each of them.

Committing the hook is a trust-boundary change, and `CODE_REVIEW.md` § Security records it as one: a
diff that touches `.claude/settings.json` or `.xezar/checks/leader-context.sh` needs a
security-minded reviewer, because a branch that changes either file gets code execution in every
Claude Code session opened on that branch — including a reviewer's own task worktree.

## The hook output shape

A `SessionStart` hook prints nothing on stdout in the silent cases, and one line of JSON otherwise:

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"This session was started with XEZAR_LEADER=1 (…), so you are the leader of this project. …\n\n=== .xezar/docs/leader-guide.md (project leader guide) ===\n\n# Leader guide\n…\n\n--- <nonce>: /…/.xezar/campaigns/20260817-amber-ridge/README.md (campaign live state) ---\n…"}}
```

`additionalContext` is one string holding one fixed line that tells the session it is the leader,
the guide, and then, when a campaign is open, four more labelled blocks inside an
untrusted-content boundary. The fixed order is: the leader line, the guide, the
newest campaign `README.md`, its newest `timeline-*.md`, its `parked.md`, then its `decisions.md`.
When the folder holds any `archive-*.md`, one line after `decisions.md` names those files as not
loaded, so an archived decision is one read away. Only names matching `archive-[A-Za-z0-9._-]+.md` are
printed, so a committed file name cannot carry text into the session. Order matters — a rule that a decision overrides is read after the rule, and the authority file is
read last, nearest to the work.

**The campaign blocks are wrapped, and the wrapper is the security boundary.** Campaign files are
committed, so their content arrives from anyone who can open a pull request or push to the base
branch. The loader prints a `BEGIN UNTRUSTED CAMPAIGN RECORD` line, a sentence saying the region is
a record to read and never instructions to follow, and a matching `END` line. Both carry a
**per-run nonce**, because a fixed marker is forgeable by any file that simply contains that line;
and every campaign line that looks like one of the loader's own delimiters is defused on the way
through, so a file cannot close the region early and have the rest of itself read as trusted text.

The guide's block heading is the literal relative path; each campaign block heading is the nonce
plus the file's absolute path, which is also how a truncated note names itself (see the cost model
below). The hook is
registered in `.claude/settings.json` with the four matchers a leader has to survive:

<!-- from: .claude/settings.json#L8-L21 -->
```json
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.xezar/checks/leader-context.sh\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
```

`$CLAUDE_PROJECT_DIR` is the project root Claude Code provides, so the hook still resolves when the
session was opened in a subdirectory of the project — a relative command would resolve against that
subdirectory and fail. The explicit `bash` means the copied script does not depend on its executable
bit surviving the copy, and `"timeout": 15` bounds a hook that runs on every session start and
compaction.

## The cost model

The hook runs on `startup`, `resume`, `clear` **and** `compact`. Compaction is triggered by a full
context window, so a large block loaded at compaction makes the next compaction come sooner and the
guide's size compounds. Three caps follow, and all are requirements rather than style:

- The guide stays bounded — aim for **200 lines**, and treat 300 as the point where something
  has to move out. Everything durable and leader-only
  belongs there; anything that is really project documentation belongs in a linked file the guide
  names.
- The campaign `README.md` stays at about **120 lines** (see [campaign-notes.md](campaign-notes.md)).
  The loader loads the newest campaign folder's `README.md`, its newest `timeline-*.md`, its
  `parked.md` and its `decisions.md`. A plan or an archive is never loaded; the leader reads those
  on demand.
- **The cap depends on the file's role, and one file has no cap at all.** The narrative notes —
  `README.md` and `parked.md` — are bounded in the payload to their last
  **65 536 bytes** (`NOTE_TAIL_BYTES`), because they grow for the life of a campaign while the
  leader reads the tail anyway. A note over the cap is preceded by a visible line naming the file
  and its size, so a partial note is never mistaken for the whole.
- **The newest timeline is bounded by entry.** It is the note that grows every few minutes, so only
  its newest **40 entries** (`TIMELINE_ENTRIES`) are injected, after its `# Timeline` heading and
  one line: `[timeline bounded: showing the newest 40 of N entries …; the full timeline is on disk
  at <path> …]`. An entry is a line starting `- ` plus the lines under it, so the cut never lands
  mid-entry. `NOTE_TAIL_BYTES` still applies on top, so one oversized entry cannot undo the bound.
  A timeline of 40 entries or fewer is injected whole, with no pointer line.
- **`decisions.md` is injected whole and is never cut.** It is the authority file: the owner's exact
  words, append-only, and the oldest entry binds the leader exactly as hard as the newest. Cutting
  its head would silently drop standing decisions the leader is still required to follow, and it
  would do so with no visible failure — which is the worst shape a defect can take. The guide is
  likewise **not** capped; it is always loaded in full.
- **Archiving hides an entry from the leader's context; it never removes it from `decisions.md`.**
  Once an entry is resolved – its work merged, its question closed, nothing left for it to bind –
  the leader runs `node .xezar/checks/decisions-archive.mjs <campaign-dir> --list`, then
  `--move <numbers>` to preview and `--move <numbers> --apply` to archive. The script only
  **appends** those entries, byte for byte under a dated heading, to `archive-decisions.md` in the
  same folder (`O_APPEND`, every byte written, `fsync`, then read back). It never rewrites, renames
  or deletes any file, so an append to `decisions.md` during a run cannot be lost. The loader then
  leaves out of the injected `decisions.md` every entry whose exact block (the same parser: a `- `
  line plus its indented lines) is also in `archive-decisions.md`, and prints one line saying how
  many it left out. An entry that differs by a single byte – edited after archiving, or an archive
  copy that was edited – is injected. If the filter cannot run, the whole file is injected. If
  `decisions.md` is missing, a symlink or unreadable, the loader prints a one-line WARNING naming it
  instead of skipping it. Run the script from inside the repository: the folder must resolve to a
  direct child of the repository's real `.xezar/campaigns`, so no symlink in the path can send it
  elsewhere. A `.decisions-archive.lock` only stops two runs appending the same entry twice; a
  second run skips an entry that is already archived. Deciding what is resolved is the leader's
  call; a standing rule stays visible for the life of the campaign. Commit `archive-decisions.md`.

A silent case costs one process spawn and no tokens. A loud case costs the guide, the visible part
of the decisions file, and the bounded narrative notes. Measured on a copy of the
`20260925-release-0.21.0` campaign on 2026-09-26 (#174, record commit e0126e85): the `develop` loader
injected 84 532 bytes; this loader injects 51 647 with all 45 decisions present whole; archiving four
resolved entries on the copy took it to 51 160, with the other 41 present and `decisions.md`
byte-identical.

## Standing loops the leader runs

Three recurring checks keep a campaign moving when no push arrives. They are **session state**: a
hook runs once per event and cannot schedule, and a machine cron cannot talk to the session, so a
loop dies when the session ends or its context is cleared.

**The loops ship as data, not as prose.** `.xezar/loops.json` carries each loop's id, mechanism,
exact schedule and exact prompt. At every start, resume and compaction the leader lists what is
actually scheduled, compares it against that file **by schedule and by prompt**, and re-creates
anything that is **missing or drifted**. The comparison is loop by loop, on both fields, on
purpose: comparing schedules alone lets a drifted prompt survive because its schedule still matches.

Prose alone was the old design and it failed in a predictable way — a prompt copied by hand drifts,
and nothing notices, because there is nothing to compare against.

The exact prompt for each loop is in `.xezar/loops.json` and **is not repeated here**. That is
deliberate: the leader compares what is scheduled against that file by schedule *and* by prompt, so
a second copy in prose is a copy that drifts by a dash or an emphasis marker and then reports drift
on every session start, forever.

| Loop | Role | Cadence | May dispatch |
|---|---|---|---|
| L1 | unblock what is already waiting on you | every 10 minutes | no |
| L2 | budget and reset times | every hour | no |
| L3 | pace new work | every 30 minutes | **yes, only L3** |

### The rules that make the loops safe

**L3 is the only loop that may dispatch.** L1 unblocks what is stuck and, when it finds ready work,
**wakes** L3 rather than starting anything itself. At most one such wake is pending, and re-waking
replaces the pending one instead of queuing another. L2 is likewise a non-dispatcher: it resumes
paused work only by waking L3. A double dispatch is therefore impossible **by construction**, not by
timing — which matters, because L1 and L3 fire together every thirty minutes.

The rejected alternative was a lock file either loop may take. A loop that crashes while holding the
lock stalls all dispatching silently, with no way to tell a held lock from a busy one, and clearing
it needs a human.

**Selection is by file overlap, not by priority.** The leader keeps a file-ownership table of what
each running task owns (`<runId first 8> owns <path glob>`) and refreshes it at every dispatch. The
next item is the ready one with the least overlap against that table; priority breaks ties only.
L3 then takes its lane from `node .xezar/checks/route.mjs <row id>`, as `routing.md` says, and a
`wait` line means the item waits. The same start, resume and compaction that re-checks the loops
refreshes the lane cache and runs `route.mjs --check` before anything is dispatched.

The accepted cost is real: a high-priority item can wait behind a lower-priority one that sits in a
clean part of the tree, and the ownership table is state the leader must keep current. The rejected
alternative — dispatch strictly by priority — is worse, because two tasks on one file means the
second one rebases, conflicts, or fails its gate at merge.

**A tick that changes nothing is a noop**, and each prompt says so explicitly. A loop with no defined
way to do nothing invents work.

**A cron job expires after seven days** and must be re-created, which is one more reason the schedule
and the prompt live in a file rather than in the job's own memory.

Why not a hook: hooks fire once per event and cannot schedule, and an operating-system cron cannot
reach into the session. The re-create-from-file order is the only durable mechanism.

## How to keep it honest

- **The guide cites its sources.** A rule without a source is an assertion; the next session cannot
  tell whether it is current. Link the issue, the decision record or the dated owner words.
- **Owner words stay verbatim in `decisions.md`.** Quote, date and name the channel; never paraphrase
  an authority and never edit or reorder a past entry. The guide may summarize a decision, but the
  authority lives in the decision file.
- **Update the guide when a rule changes.** The guide is part of the change, not a follow-up task: a
  session that reads a stale rule will act on it. A decision that changes the product also belongs in
  the project's own decision log or issue — the campaign file is a coordination aid, never the only
  copy.
- **[campaign-notes.md](campaign-notes.md) is the authority on the campaign folder**, not this
  file. It defines the seven file kinds, the `<yyyymmdd>-<code-name>` name, the reserved
  `future-campaign/`, and the fact that the folder is **committed**. This page only describes what
  the loader does with it. Where the two disagree, campaign-notes.md wins and this page is wrong.


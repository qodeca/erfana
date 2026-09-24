# `.xezar/docs/` — the leader's operating documents

These are the operational documents for a project whose work is coordinated by a leader and
carried out by dispatched task agents. They describe **how this project is run**, not what it
builds. The product's own documentation lives elsewhere.

`leader-guide.md` is written for this project during onboarding; the rest ship as they are. The
routing itself is data, not a document: `.xezar/routing.json`, read through `.xezar/checks/route.mjs`.

## Read these first

| Document | What it answers |
|---|---|
| `leader-guide.md` | Who the leader is, what only the owner may decide, how a session starts and recovers, what gets logged where. **Generated during onboarding.** |
| `leader-context-loading.md` | How the guide gets reloaded at every session start and compaction, the guard that keeps it out of task agents, and the three standing loops. |
| `leader-guide-detail.md` | The reasoning behind each rule in the leader guide. The guide loads at every session start, so it carries rules only; open this when a rule looks wrong. |
| `campaign-notes.md` | What a campaign folder is, its seven file kinds, and which of them load at session start. |
| `routing.md` | How the leader picks the lane — a runner plus a model — and the login for each task: classify with `route.mjs --rows`, order with `route.mjs <row id>`, then budget and never the author. |

## Running the work

| Document | What it answers |
|---|---|
| `worktrees.md` | How a task gets its own checkout, and how one is cleaned up. |
| `parallel-tasks.md` | How to decide whether to fan work out at all, and why the gate tail is a queue even when the tasks are not. The numeric ceilings are in `.xezar/loops.json`, not here. |
| `account-limits.md` | How to read each login's budget with `read_quota`, how to probe a login still `unknown`, and how to recover a lane that is out. |
| `recovery.md` | What to do when a task, a merge or a session fails part-way. |
| `phase-record.md` | What each phase of a task writes down, and where. |
| `close-out.md` | How a campaign ends and what has to be true before it does. |

## Specialised

| Document | What it answers |
|---|---|
| `business-analysis.md` | How a "what should we build" question is answered as a task. |
| `ui-operations.md` | How UI work and its evidence are handled. |
| `documented-output.md` | The allowlisted script-output marker and its fail-closed trust boundary. |
| `fenced-quotes.md` | The source marker for byte-checked fenced quotes. |

## Two rules that hold across all of them

**Records are committed; runtime is not.** Campaign folders, this directory and the leader guide
live in git, because they are the trail of what happened and who decided it. Everything under
`.local/xezar/` is working state: rebuildable, never committed, and never the only copy of anything.

**These documents describe the process, not the evidence.** A document says how something is
done; what actually happened on a given day belongs in the campaign's timeline, and a verdict
belongs on the pull request that earned it.

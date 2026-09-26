# Campaign notes: a folder, committed

A campaign is a folder under `.xezar/campaigns/<yyyymmdd>-<code-name>/`, and it is **committed**.
Not a single file that becomes a folder once it gets big — a folder from the first minute, always.

## Why a folder from the start, and why committed

Two decisions sit behind that one sentence, and both were made against the obvious alternative.

**Always a folder, never split-on-growth.** The tempting design is a single file that splits into a
folder once it outgrows a comfortable load. It fails in the only case that matters: the split lands
in the middle of a busy campaign, which is exactly when nobody has attention to spare for moving
records around. It also means every reader must handle two layouts, and every tool must guess which
one it is looking at. One shape, from the first minute, costs a few empty files and removes all of
that.

**Committed, not runtime state.** A campaign folder holds the owner's own decisions in their own
words. If it lives only in an ignored directory, it dies with the machine, and there is no history
of who decided what or when. In git, the record survives a rebuild and carries its own timestamps.
The cost is accepted and named: record files are pushed straight to the base branch rather than
through a pull request, which is why branch protection is configured **without** admin enforcement.

Campaign files, the leader guide and the mode file are the only files that may be pushed directly.
Everything else goes through a pull request.

## The seven file kinds

| File | Shape | Loaded at session start |
|---|---|---|
| `README.md` | live state, **rewritten** at every milestone | yes |
| `decisions.md` | owner's exact words, dated, **append-only** | yes, **whole** less archived entries |
| `parked.md` | calls the leader made alone while the owner was away | yes |
| `merges.md` | one line per day: every merge as `#PR -> sha` | no, read on demand |
| `plan.md` | the owner-approved plan, copied in once, never edited | on demand |
| `timeline-YYYY-MM-DD.md` | one file per day, append-only | newest day only, newest 40 entries |
| `archive-*.md` | stale blocks, and records of resolved decisions | never (only named) |

- **`README.md`** — live state. Rewritten, not appended, at every milestone, as the last act of
  handling that event and before reporting to the owner. Stamp `Updated:` from `date`. Keep: a
  State block (base-branch sha, merges so far, checkpoints met); open pull requests with head sha,
  verdict and the single next action; the serial merge line; running tasks per lane; the account
  table with state and reset times (see `.xezar/docs/account-limits.md`); held or queued work;
  owner items; a "rules that bit" list for briefs; restart and re-attach steps; and the
  **file-ownership table** — one line per running task, `<runId first 8> owns <path glob>`,
  refreshed at every dispatch. That table is the input to every selection decision and it is the
  first thing a compaction loses, which is exactly why it lives in a file rather than in context. Target 120 lines —
  past that, move a stale block into an `archive-*.md` rather than trim history silently.

- **`decisions.md`** — owner decisions in the owner's exact words, with the date and the channel
  (chat or a direct question), plus the campaign's standing rules. **Append-only**: never edit or
  reorder a past entry. This file is injected **whole** at session start, never truncated, because
  the oldest entry binds the leader exactly as hard as the newest one. To keep the injected copy
  small, archive a **resolved** entry – never cut one – with `node .xezar/checks/decisions-archive.mjs
  <campaign-dir> --move <numbers> --apply` (`--list` numbers the entries; without `--apply` it only
  previews). Archiving hides an entry from the leader's context; it never removes it from
  `decisions.md`: the script only appends a record to `archive-decisions.md` naming that one
  entry (its byte offsets, the SHA-256 of its bytes and of the file up to it), and the loader leaves
  out only entries a valid record names. Keep `decisions.md` append-only: editing, inserting or
  reordering anything at or before an archived entry makes its record stale, and the entry is
  loaded again. Never edit a record – a malformed one makes the loader hide nothing.
  Standing rules stay visible.

- **`parked.md`** — one entry per decision the leader made on the owner's behalf during unattended
  mode. Each entry records what it chose, why, the alternative it rejected, and how to undo it.
  Emptied by the morning interview, which asks every entry back. Created empty with its heading the
  moment a campaign opens, so the leader always has somewhere to write.

- **`merges.md`** — one line per day listing that day's merges. Each merge's own verification
  (parent count, file count, issues left open, base-branch CI result) lives in that day's timeline
  entry. This file is the index, not the evidence.

- **`plan.md`** — the owner-approved plan, copied in once and never edited. A plan change goes
  through the owner and lands as a dated entry in `decisions.md`, never as a silent edit here.

- **`timeline-YYYY-MM-DD.md`** — one file per day, append-only. Every line starts
  `- YYYY-MM-DD HH:MM - ...` stamped from `date` and names run ids by their first 8 characters.
  Never read this file whole; read its tail. Only its newest 40 entries are injected at session
  start, after a line naming the full file on disk.

- **`archive-*.md`** — stale blocks kept for history, and records of resolved
  `decisions.md` entries (`archive-decisions.md`), each naming one entry by byte offsets and hashes;
  the loader leaves it out of its copy of `decisions.md` while the record still matches. Never loaded at session start; the loader prints one line
  naming them, so the leader knows they exist.

## `future-campaign/`

`.xezar/campaigns/future-campaign/` is reserved. It holds work aimed at a campaign that has not
opened yet, and it carries the same seven file kinds so nothing has to be invented later.

It is **never** the live campaign. Every lookup for the live campaign takes the last folder whose
name **starts with a digit**, so `future-campaign` is excluded by shape rather than by remembering
its name — which matters, because it sorts after every `2026...` name and an unfiltered lookup
picks it every single time.

```sh
LIVE=$(ls -1 .xezar/campaigns 2>/dev/null | grep -E '^[0-9]' | sort | tail -n 1)
```

Sort by **name**, not by modification time. The name carries the start date, so reading, grepping
or copying an old campaign no longer promotes it to "current".

## Opening and closing a campaign

**Opening a campaign is the owner's decision, always.** The leader never opens one — not when the
work obviously needs it, not overnight, not with the owner's general approval of the direction. In
unattended mode it does not even ask: it closes the finished campaign, keeps watching CI, and idles
until the owner returns.

Closing is ordinary work: finish the close-out, leave `README.md` describing the end state, and
leave the folder in place. Campaigns are never deleted.

## Loading

The leader's session-start hook injects `README.md`, the newest 40 entries of the newest
`timeline-*.md`, `parked.md` and the whole of `decisions.md` less its archived entries (a missing `decisions.md` is a loud warning). `plan.md`, older timelines and the
archives are read on demand. Agent memory holds a
pointer to the folder, never a copy of its content.

## Writing rules

- Stamp every line from `date`; never hand-write a time.
- Fill a run-id placeholder in a brief right after the matching create call returns the real id —
  never leave a placeholder in a note.
- Never put backticks inside a double-quoted shell string when appending to a note file: the shell
  executes them. Use single quotes, or a Python heredoc, for any append containing a command.
- A safety hook can block note text that contains a destructive git phrase, even inside a quoted
  description of what **not** to do. Describe such a rule in words instead of pasting the command.

## When a day ends

Start a new `timeline-YYYY-MM-DD.md`; do not keep appending to the old one. The README's State
block carries the running merge count and the checkpoints met, so a new day starts from a written
number rather than a recount.

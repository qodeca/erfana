# Account limit probing and recovery

Xezar can run tasks under several agent accounts (Settings → agent profiles). From engine 0.19.0 the leader reads each login's budget before it dispatches; this page says how, what to do when the answer is `unknown`, and how to recover the lane once a login is out.

## Read the budget first

Call `project_config` action `read_quota` (optionally with `provider` or `accountId`). It returns one row per Claude or Codex login, with `status` `ok`, `out` or `unknown`, and `resetsAt` when it is out. Route away from an `out` login until `resetsAt`. `unknown` means the engine could not read it – never that the login has budget. `check_quota` forces a fresh check, at most once per five minutes per login. A failed run still marks its login out. Only Claude and Codex logins have a row.

## What cannot be read

- `check_account_status` and `get_account_details` are refused for a leader. Account identity is not served to a project leader; accounts are person-administered.
- The cockpit's "Connected" / "Check again" state is a login check, not a quota check. An account can show "Connected" and still be over its limit.
- Claude Code itself only shows usage through the interactive `/usage` command, run per login, inside a terminal session. There is no headless command and no API for it.

So when `read_quota` and `check_quota` still say `unknown` for a login you need, the only working signal left is: dispatch a task under the account and see whether it runs.

## The probe

Send one tiny task per account, all in a single message so they run in parallel. Each is the built-in `quick-task` (no `source` field, so no kit, no gates, one agent step):

```
task_create {
  operationId: "probe-<handle>-<yyyymmdd-hhmm>",
  runner: "claude",
  model: "haiku",
  agentProfile: "<handle>",
  worktree: false,
  autonomous: true,
  generateFollowups: false,
  prompt: "Account limit probe. Do nothing else: run no tool, read no file, write nothing. Answer with exactly two lines: the first line `PROBE OK`, the second line `XEZ:DONE`."
}
```

Notes on the shape:

- `worktree: false` means no branch and no worktree to clean up later; the task still waits briefly for the repository-root lease.
- `haiku` and the two-line prompt keep the cost near zero: a few hundred tokens on a healthy account, nothing on a limited one.
- Never dispatch a probe to the leader's own login (see below).

Wait for the `task.done` / `task.failed` events; they normally arrive within a few seconds. Read a failed probe with `task_read` (`view: task` for the `error` field, or `view: history` for the first assistant item).

- `done` → the account works.
- `failed` with an error like `You've hit your session limit · resets 6:30pm (Europe/Warsaw)` → a 5-hour window limit, a short outage.
- `failed` with an error like `You've hit your weekly limit · resets Sep 19 at 6pm (Europe/Warsaw)` → the account is out for days.

Example shape: a machine carries the leader's own login plus one task account per extra profile — `default` (`~/.claude`, the leader's own login) and one handle per additional config directory. A handle is the account label with every `.` turned into `-`, so `~/.claude.<label>` is read as the handle `<label>`. Never write real account labels into this document or any other committed file; read them from the live configuration instead.

## Recovery

1. Read the reset time from the error text itself, not from any schedule the engine shows you. See the known defect below.
2. For every failed probe, call `execution_control` `cancel_auto_resume` with that run's `runId` and `expectedVersion` (from `task_read`). Do this for a weekly limit and for every probe alike: a probe run must never be allowed to auto-resume on its own.
3. For a short session limit, if the reset is close, you can leave that account idle until it resets. For a weekly limit, or any long wait, rotate: re-dispatch the exact same brief on the next login in that runner's rotation (`agentProfile`), in the order `route.mjs` prints under `logins=`; the rotation lives in `.xezar/routing.json`. The lane — the tool and the model — stays the same; only the login under it changes. A lane is out only when every account in its rotation is.
4. Keep the budget table in the budget section of the live campaign's `README.md`, keyed runner × login (`claude` / `<login>` → `ok`, `unknown` or `out` with its reset time), and update it on every probe. That table is the record of the check; nothing else remembers it, and `routing.md` reads it at every dispatch.
5. Run one stream of work per account. That way a single limited account stalls one stream, not the whole campaign.
6. If two accounts show the same reset minute, they are probably the same underlying login window, not two independent limits.
7. The leader's own login (`default`, `~/.claude`) never gets probe or work tasks. Probing it would spend the leader's own session on a check it does not need.
8. Re-probe only when you are about to rely on an account for a burst of work and are unsure of its state, or once its recorded reset time has passed. Do not probe on a fixed interval or in a loop.

## Known engine defect

The engine has scheduled a weekly-limit auto-resume one day early at least once (seen 2026-09-17: a "resets Sep 19" message produced a resume scheduled for Sep 18). Read the reset time from the error text, and always cancel auto-resume on a probe run rather than trusting the schedule. Tracked as [#581](https://github.com/qodeca/xezar/issues/581).

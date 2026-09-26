<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Spike: leader liveness – where the parked time goes, and a 30-minute silence alert

- **Issue:** [#179](https://github.com/qodeca/erfana/issues/179).
- **Date:** 2026-09-26. **Time box:** about 90 minutes; used about 75.
- **Campaign measured:** `release-0.21.0`, from 2026-09-24 22:14Z to 2026-09-26 16:20Z.

## The question and the answer

**Question.** Of the time xezar runs sat parked waiting for the leader, how much needed a decision,
how much was a mechanical stop, and how much was the leader simply not there? What does the engine
already offer for auto-continue, and what is the cheapest reliable alert when the leader goes silent?
**Yes** meant: minutes per cause, a list of what this repo can configure versus what needs the engine,
and an alert rule that fires on the real outages in the record.

**Answer: yes, with one surprise.** The parked time is **1 280 minutes over 25 stops**. Stops that
needed no decision – the target of engine auto-continue – cost **14 minutes (1 %)**: the leader was
present each time and answered in under 10 minutes. The big costs are elsewhere:

| Cause | Minutes | Share |
|---|---:|---:|
| (a) Waiting on an owner or leader decision (`XEZ:ASK`, `BLOCKED`, an open option) | 743.0 | 58 % |
| – of which the leader was also silent | 622.3 | |
| (b) Mechanical stop, no decision needed (readiness, timeout kill, `MONITORING`) | 14.2 | 1 % |
| (c) Leader absent while a review was waiting to be dispatched or relayed | 190.3 | 15 % |
| (d) Review run itself running | 145.4 | 11 % |
| (e) Leader present, but slow to dispatch or relay a review | 187.2 | 15 % |

So a **30-minute silence alert** targets 812 minutes (a-silent plus c, 63 %), and replaying it over the
record catches all three real outages. **Engine auto-continue at no-decision stops** would have saved at
most 14 minutes in these two days, and it needs an upstream engine change.

## What I did

- **Data.** 150 run logs in `.local/xezar/runs/*.ndjson` (94 MB, 39 154 events) on the owner's Mac
  (Darwin 25.5.0). Leader activity from the two campaign timelines
  `.xezar/campaigns/20260925-release-0.21.0/timeline-2026-09-2{5,6}.md` (198 entries, written in CEST,
  converted to UTC) and cross-checked against `git log -- .xezar/campaigns` on `develop`: the commit
  times match the timeline entries one for one.
- **Parked gap.** From a run's stop (`run finished`, `run failed – …`) to the next leader
  `user-message` with a `continue-N` step id on the same run. Messages sent into a still-running step
  (6 of the 31) are not parked time and are left out.

  ```bash
  jq -r --arg r "$id" 'select(.type=="user-message" or .type=="lifecycle" or .type=="step-end")
    | [$r, .ts, .type, (.stepId//""), (.status//""), ((.message // .text // "")|.[0:110])] | @tsv' "$f"
  ```

- **Review gaps split in three.** For a `run finished` stop that waited on a review, the review run was
  identified from the continue message (task id or verdict time) and its start and end taken from its
  own log: stop → review start is dispatch latency, review start → end is the review running, and review
  end → continue is relay latency.
- **Leader silence.** Any gap of more than 30 minutes between two timeline entries. Dispatch and relay
  latency that falls inside a silence counts as (c); the rest as (e). Decision gaps stay (a), with the
  part inside a silence shown separately.

## What I measured

### The 25 parked gaps

| Run | Stop (UTC) | Kind | Gap | Breakdown |
|---|---|---|---:|---|
| 9f1fd373 | 24 22:17 | b – ended on `XEZ:MONITORING` | 0.2 | |
| 03de6de3 | 25 18:20 | b – readiness failed (empty phase record) | 4.4 | |
| 5bf6cc9a | 26 15:58 | b – readiness failed (empty phase record) | 0.4 | |
| 2a1e4316 | 25 15:46 | b – killed at the 2-hour step limit | 9.2 | |
| 2a80ec06 | 25 08:52 | a – `XEZ:ASK` | 8.8 | |
| 4458b282 | 25 13:16 | a – `XEZ:ASK` | 13.6 | |
| 4458b282 | 25 13:35 | a – `XEZ:ASK` | 135.8 | 99.0 in leader silence |
| 320bec53 | 25 10:56 | a – owner option open in the PR | 145.1 | 86.0 in leader silence |
| 43131e43 | 26 15:18 | a – owner decision | 24.0 | 22.9 in silence (leader with the owner) |
| d71e7bf0 | 26 06:56 | a – question in prose, no `XEZ:DONE` | 415.6 | 414.5 in leader silence |
| 2a80ec06 | 25 09:13 | review | 23.4 | dispatch 3.2, review 19.4, relay 0.7 |
| 8d85e234 | 25 10:33 | review | 31.9 | dispatch 23.4, review 2.4, relay 6.1 |
| a410722c | 25 11:11 | review | 93.7 | dispatch 81.0 (all silent), review 11.2, relay 1.5 |
| 320bec53 | 25 13:29 | review | 115.6 | dispatch 10.7, review 5.2, relay 99.7 (97.5 silent) |
| 4458b282 | 25 15:57 | security review | 27.4 | dispatch 18.5, review 4.0, relay 4.8 |
| 2a1e4316 | 25 16:09 | code + design review | 35.8 | dispatch 7.3, review 19.8, relay 8.7 |
| 4458b282 | 25 16:35 | security recheck | 19.7 | dispatch 13.3, review 3.4, relay 3.0 |
| 2a1e4316 | 25 17:16 | code + design recheck | 38.0 | dispatch 10.7, review 23.6, relay 3.7 |
| bb9b584c | 25 19:11 | review | 24.3 | dispatch 6.2, review 17.8, relay 0.3 |
| 7b28e450 | 25 21:14 | code + design review | 30.1 | dispatch 12.7 (11.3 silent), review 10.7, relay 6.6 |
| 3f8af2d8 | 25 22:48 | review | 16.5 | dispatch 9.0, review 7.2, relay 0.2 |
| d71e7bf0 | 26 14:06 | review | 40.6 | dispatch 36.2, review 3.5, relay 0.9 |
| 347fc1ce | 26 14:42 | review | 12.0 | dispatch 5.5, review 5.6, relay 0.8 |
| 43131e43 | 26 14:48 | code + security review | 10.3 | dispatch 0.0, review 9.8, relay 0.5 |
| 5bf6cc9a | 26 16:15 | review | 3.8 | dispatch 1.6, review 1.8, relay 0.4 |

Leader silences over 30 minutes (UTC): 25 11:10–12:36 (86), 25 13:48–15:27 (99), 25 20:55–21:26 (31),
the night 25 23:46 – 26 06:40 (hourly idle ticks only), 26 06:49–13:51 (422) and 26 14:58–15:41 (43).

The parked total, 1 280 minutes, is 57 % of the 2 240 minutes the author runs were open and 49 % of all
2 599 run-minutes in the window, in line with the 51 % the issue quotes.

### Replaying the alert rule over the record

The rule: *some run log was last written more than 30 minutes ago, and after the leader's last commit to
`.xezar/campaigns` on `develop`*. Replayed minute by minute, with each log's modification time at that
minute taken from its own last event:

| Alert (UTC) | Held for | Run waiting | Real outage? |
|---|---:|---|---|
| 25 11:36 – 12:31 | 55 min | 19b6c719 | yes – silence 11:10–12:36 |
| 25 14:06 – 15:26 | 80 min | 4458b282 | yes – silence 13:48–15:27 |
| 26 07:27 – 13:52 | 385 min | d71e7bf0 | yes – silence 06:49–13:51 |
| 26 15:27 – 15:42 | 15 min | 0d8a560d | no – leader was talking with the owner and did not commit |

A plain "no commit for 30 minutes" rule fires **11 times** over the same window, mostly overnight when
nothing was waiting. Requiring a stopped run is what removes those.

The prototype script also ran against a simulated outage (a scratch repository whose last campaign commit
was 50 minutes old and a run log 40 minutes old): it raised the alert once, stayed quiet on the next
poll, and stayed quiet when the run had stopped only 10 minutes before. Against the live checkout at
16:20Z it stayed quiet, correctly: the leader was active.

## What the engine offers today

From `.xezar/docs/ui-operations.md`, `recovery.md`, `account-limits.md` and `.xezar/workflows/*.yaml`:

| Mechanism | What it does | Configurable here? |
|---|---|---|
| `execution_control` `continue`, `answer_question`, `send_message` | The leader's manual Continue; opens a synthetic agent step, then resumes the remaining workflow | Leader-only MCP action, no automatic trigger |
| Auto-resume (`cancel_auto_resume`, "auto-resume" in the task version) | The engine schedules a resume **after an account usage limit resets** | No – only cancellable; it covers limit failures, not step stops |
| `onFail: retry: <step>, max: N` in a workflow | Sends a failed check back to the author step with the output | Yes, per step – today only on `gates`, in all 25 workflows; `readiness` (also in 25) has none |
| Agent-step failures (`XEZ:ASK`, `XEZ:MONITORING`, no `XEZ:DONE`, timeout) | The run fails and waits for a Continue | No – the failure kind is decided inside the engine |

So:

- **Configurable from this repo:** an `onFail` retry on `readiness` would auto-continue the two
  empty-phase-record stops. But `readiness` also refuses on a `BLOCKED` record, and one `onFail` cannot
  tell the two apart, so it would bounce decisions back to the author – the one thing #179 forbids. It
  needs the readiness check split in two (a `BLOCKED` check with no retry, a phase-record check with
  one), which is a new `worktree-preflight.sh` mode plus 25 workflow edits: a kit change, so an upstream
  kit PR or a recorded local patch. Whether the engine accepts `onFail` on a step other than `gates`, and
  which repair counter it would consume, I did not test.
- **Needs an upstream engine change:** continuing after an agent-step stop by its kind. The record argues
  for caution: the one "no `XEZ:DONE`" stop (d71e7bf0) carried a question in prose, and the timeout kill
  (2a1e4316) needed the leader to read red CI first. Only `XEZ:MONITORING` looks safe to continue blind,
  and it cost 15 seconds.

## Alert design

**Signal: the leader's last commit to `.xezar/campaigns` on `develop`, combined with a stopped run.**

| Signal | Cost | Verdict |
|---|---|---|
| Last campaign commit | Free: the leader already commits at every tick, and the times match the timeline one for one | Use it, gated on a stopped run |
| `leader_events` `status` | Needs an MCP client inside the job; says "attached", not "working" – a stuck session still reads attached | No |
| New heartbeat file | Needs a leader-guide change, and it goes quiet exactly when the commits do | No gain over commits |

Two limits of the commit signal: `--all` must not be used, because author branches sometimes carry
campaign files (8d85e234's review flagged exactly that), so the check reads `develop` only; and a leader
talking with the owner without committing looks silent (the 15-minute false alert above).

**Delivery: a user `launchd` agent and `osascript`.** Both ship with macOS; `terminal-notifier` is not
installed here. A Claude Desktop scheduled task was rejected: it only runs while the Desktop app is open,
spends model tokens on every poll, and is itself a session that can die – the failure it is meant to
catch.

The check script, as prototyped (the stamp file belongs outside `.local/xezar/`, whose subfolders are
reserved, so it goes to `$TMPDIR`):

```bash
#!/bin/bash
# Alert when a xezar run stopped more than N minutes ago and the leader has
# recorded nothing in .xezar/campaigns since. Alerts only; never acts on a task.
set -u
REPO="${LEADER_WATCH_REPO:?set LEADER_WATCH_REPO to the main checkout}"
LIMIT_MIN="${LEADER_WATCH_MINUTES:-30}"
STAMP="${TMPDIR:-/tmp}/erfana-leader-watch.last"
now=$(date +%s)
last=$(git -C "$REPO" log -1 --format=%ct develop -- .xezar/campaigns) || exit 0
waiting=""
for f in "$REPO"/.local/xezar/runs/*.ndjson; do
  m=$(stat -f %m "$f")
  if [ "$m" -gt "$last" ] && [ "$m" -le $((now - LIMIT_MIN * 60)) ]; then
    waiting=$(basename "$f" .ndjson | cut -c1-8); break
  fi
done
[ -z "$waiting" ] && { rm -f "$STAMP"; exit 0; }
# one alert per LIMIT_MIN, not one every poll
if [ -f "$STAMP" ] && [ $((now - $(stat -f %m "$STAMP"))) -lt $((LIMIT_MIN * 60)) ]; then exit 0; fi
touch "$STAMP"
msg="Run $waiting stopped and the leader has recorded nothing for $(( (now - last) / 60 )) min."
osascript -e "display notification \"$msg\" with title \"Erfana leader silent\" sound name \"Submarine\""
```

The launch agent (`~/Library/LaunchAgents/com.qodeca.erfana.leader-watch.plist`, passes `plutil -lint`;
`USER` is a placeholder, and there are no secrets):

```xml
<plist version="1.0">
<dict>
  <key>Label</key><string>com.qodeca.erfana.leader-watch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/USER/Projects/erfana/scripts/leader-watch.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LEADER_WATCH_REPO</key><string>/Users/USER/Projects/erfana</string>
    <key>LEADER_WATCH_MINUTES</key><string>30</string>
  </dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>/tmp/erfana-leader-watch.err</string>
</dict>
</plist>
```

Load it with `launchctl bootstrap gui/$(id -u) <plist>`. With a 5-minute poll the alert lands 30 to 35
minutes after a run stops unattended, inside the issue's acceptance criterion.

## What I did not test

- **Notification delivery under `launchd`.** The script ran with a dry-run switch that prints instead of
  notifying, and the plist was linted but never loaded. A Focus mode, or notification permission for
  `osascript`, could silence it; the first real install must show one notification by hand.
- **Leader silence is inferred** from timeline entries and commits, not from the session's process. A
  leader present but not writing (with the owner, 26 14:58–15:41) reads as silent, so classes (c) and
  "a in silence" are upper bounds.
- **Review-to-gap mapping** was done by hand from the continue text; one review can serve two runs.
- **`onFail` on `readiness`**, the split readiness mode, and which repair counter a readiness retry
  consumes – none was tried against the engine.
- **One campaign only** (about 42 hours). A campaign with fewer owner decisions would shift the shares.

## What it means for the decision

The owner chose "alert + safe auto-continue" (decisions.md, 2026-09-26). The data supports the first half
strongly and the second half weakly.

| Option | Addresses | Upper bound saved (these 42 h) | Effort |
|---|---|---:|---|
| 1. `launchd` silence alert (script + plist + a runbook) | (c) and the silent part of (a) | about 500 min, if the owner answers within 10 min of the alert | ½ day in this repo, no kit change |
| 2. Readiness split with `onFail` retry | 2 readiness stops | 5 min | 1–2 days, kit PR upstream plus an engine check |
| 3. Engine auto-continue by stop kind | `MONITORING` only is safe | under 1 min | upstream engine, size unknown |
| 4. Leader rule: dispatch the review on the "run finished" push, relay the verdict on its push | (e) | up to 187 min | leader-guide wording, no code |

**Recommendation: do option 1 now and option 4 alongside it; file option 3 upstream as a low-priority
xezar issue and do not build option 2.** Option 1 hits the largest cost, is cheap, lives outside the
leader session and only alerts. Option 4 costs nothing and targets the next-largest no-decision cost,
which is the leader present but slow, not the engine. Options 2 and 3 would meet the third acceptance
criterion, but for little gain: the stops they cover are already answered in minutes.

If the owner keeps engine auto-continue in scope, the rule it needs – which stop kinds may continue
blind – outlives this feature and wants an architecture decision record in `docs/adrs/`.

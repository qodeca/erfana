<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Leader-silence alert

A macOS notification, **Erfana leader silent**, when a xezar run has stopped and waited for more than
30 minutes while the project leader has recorded nothing ([#179](https://github.com/qodeca/erfana/issues/179),
spike: [179-leader-liveness.md](../spikes/179-leader-liveness.md)). It only alerts: it never
dispatches, continues, answers, approves, merges, kills or edits anything.

## How it decides

Every five minutes a `launchd` agent runs `scripts/leader-watch.mjs` against the main checkout:

- **Leader's last sign of life** – the later of its last commit to `.xezar/campaigns` on `develop` and
  the newest file in a campaign folder (a tick written but not yet committed).
- **A waiting run** – a run log in `.local/xezar/runs/` last written more than 30 minutes ago and after
  that sign of life.

Both true: one notification, and one line in `~/Library/Logs/erfana-leader-watch.log`. While the silence
lasts it repeats every 30 minutes. It reads file names, modification times and one commit time – no log
content, no account or login.

Known limit: a leader talking with the owner without committing reads as silent (one false alert in the
spike's two-day replay).

## When it fires

Open the leader session (`./scripts/xezar-leader.sh`) and check it is alive and idle. The run named in the
notification is the one that has waited longest.

## Install

Once, by hand – nothing installs it for you. From the main checkout:

```bash
REPO="$(pwd)"
NODE="$(command -v node)"
sed -e "s#__NODE__#$NODE#" -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
  scripts/com.qodeca.erfana.leader-watch.plist \
  > ~/Library/LaunchAgents/com.qodeca.erfana.leader-watch.plist
plutil -lint ~/Library/LaunchAgents/com.qodeca.erfana.leader-watch.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.qodeca.erfana.leader-watch.plist
```

Then show one notification by hand, so macOS asks for the permission once and a Focus mode that would
hide it shows up now rather than during an outage:

```bash
osascript -e 'display notification "test" with title "Erfana leader silent"'
```

Check it runs: `launchctl print "gui/$(id -u)/com.qodeca.erfana.leader-watch"` shows `last exit code = 0`.
To see what it would say without a notification:
`LEADER_WATCH_REPO="$REPO" node scripts/leader-watch.mjs --dry-run`.

`NODE` is written into the plist as an absolute path: after a Node upgrade that moves it (nvm, Homebrew),
run the `launchctl bootout` line from [Uninstall](#uninstall) first – `launchctl bootstrap` fails while the
old agent is still loaded – then run the install block above again.

## Uninstall

```bash
launchctl bootout "gui/$(id -u)/com.qodeca.erfana.leader-watch"
rm ~/Library/LaunchAgents/com.qodeca.erfana.leader-watch.plist
rm -f ~/Library/Logs/erfana-leader-watch.log
```

## Settings

In the plist's `EnvironmentVariables`:

| Variable | Default | Meaning |
|---|---|---|
| `LEADER_WATCH_REPO` | – (required) | Absolute path of the main checkout |
| `LEADER_WATCH_MINUTES` | `30` | Silence and waiting limit, whole minutes |
| `LEADER_WATCH_LOG` | – | The log file; the last alert is read back from it so alerts do not repeat every poll. Keep it equal to `StandardOutPath` |

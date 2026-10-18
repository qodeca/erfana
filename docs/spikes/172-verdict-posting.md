<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Spike: posting review verdicts without a model Bash call

- **Issue:** [#172](https://github.com/qodeca/erfana/issues/172).
- **Date:** 2026-09-26. **Time box:** about 1.5 hours; used about 1.25.
- **Machine:** macOS (Darwin 25.5), Claude Code 2.1.283, xezar engine `@qodeca/xezar` 0.19.0
  (installed globally; engine paths below are relative to its `dist/`).

## The question and the answer

**Question.** Can a workflow `command:` (check) step, run after a review agent step, read the
reviewer's verdict packet and post it through `gh-write.sh`, so a long markdown verdict reaches the
PR with 0 `permission_denials`? If not, does the `PreToolUse` hook fallback work?

**Answer: no for the check step as the engine stands; yes for the hook, but with a delivery catch.**

- A check step **can** run after an agent step, but it gets **no `XEZ_*` variables**, and by the
  time it starts the engine has **already deleted the packet**. The packet also has no room for the
  full review body (summary ≤ 2,000 characters). And the check step does not remove the real
  bottleneck: the long body still has to leave the model through a Bash command.
- A `PreToolUse` hook that approves only the exact posting shape **does** let a 12,306-character
  markdown verdict (backticks, `$`, quotes, newlines) through in `dontAsk` mode, with 0 denials.
  The control run without the hook was denied. **The catch:** reading steps start Claude with
  `--setting-sources user`, so a hook in the project's `.claude/settings.json` is **never loaded**.
  The hook has to come from user-scope settings (machine config outside the repo), or the engine
  has to pass it with `--settings`.

## What the kit and the engine do today

### 1. Check steps after agent steps (question 1)

| Fact | Evidence |
|---|---|
| A step with `command:` is a check step; anything else is an agent step. | engine `workflows/types.js:107` (`stepKind`) |
| Check steps already run after agent steps (for example `readiness` and `gates` after `explore`). | `.xezar/workflows/spike.yaml` |
| A check step is spawned with `env: process.env`, meaning the manager's own environment and no `XEZ_HANDOFF_FILE`, `XEZ_TASK_ID` or `XEZ_STEP_ID`. | engine `workflows/run.js:2736-2741` (`runCheckStep`); the kit already records this in `.xezar/checks/lib/common.sh:21-26` and `.xezar/checks/resume-complete.sh:117-118` |
| Only agent steps get `XEZ_HANDOFF_FILE`, `XEZ_TASK_ID`, `XEZ_STEP_ID`. | engine `workflows/run.js:432-441` (`agentEnv`) |
| When an agent step settles, `finishStep` calls `takeStepVerdict` → `ingestTaskVerdict`, which reads `<dataDir>/runs/<runId>.handoff.md.verdict.json` and then **unlinks it**, whether it was recorded or refused. The verdict lives on only in the engine's run record (`run.verdicts`, `publication: 'pending'`). | engine `workflows/run.js` (`finishStep`, `takeStepVerdict`); `runs/task-verdicts.js:85-150` (`ingest`, `consume`) |
| The packet schema caps `summary` at 2,000 characters and findings at 20 × 300 characters (16 KB total), with roles `code-review`, `design-review`, `qa`, `architecture-review` only. There is no field for the full comment body, and security review, business analysis and issue triage have no role. | engine `contract/index.js` (`TASK_VERDICT_*` constants) |
| On this machine's runs folder, 1 `.verdict.json` exists beside 100+ handoff files, which fits "consumed on settle". | observed listing of `.local/xezar/runs/` |

So a post-verdict check step cannot read the packet from disk. What it **can** do is derive the
task id from its working directory (the worktree is named after the run id, `lib/common.sh`
`resolve_task_id`) and read a file in the evidence folder `.local/xezar/tasks/<runId>/`, which the
engine does not consume. That breaks when a review runs Worktree-OFF (the review workflows use
`worktree-preflight.sh --allow-root`), because the check step then has no identity at all.

### 2. Where the packet goes, and a fixed body path (question 2)

- Packet: `verdict-write.sh packet` writes `${XEZ_HANDOFF_FILE}.verdict.json`
  (`.xezar/checks/verdict-write.sh:101-119`), i.e. `.local/xezar/runs/<runId>.handoff.md.verdict.json`
  (engine `handoff.js:3`, `runs/task-verdicts.js:5-7`). Atomic, ≤ 40 KB, ids stamped from the env.
- Evidence: `verdict-write.sh evidence <name>` writes `.local/xezar/tasks/<runId>/<name>`, ≤ 1 MB,
  refusing symlinks (`verdict-write.sh:128-146`).
- `gh-write.sh` today takes the body only on stdin, either raw or inside a JSON request (≤ 64 KB,
  `gh-write.sh:68-112`).

Minimal change, if the check-step route is ever taken:

1. `verdict-write.sh evidence review-body.md` (unchanged) holds the body.
2. `gh-write.sh comment-from-evidence pr <number>`: no path argument. It resolves
   `task_evidence_dir` through `lib/common.sh`, reads `review-body.md` there, refuses a symlink or a
   non-regular file (`lstat` then `fstat`, as the engine's `readPacketFile` does), keeps the 64 KB
   cap, runs `gitleaks stdin` (or the kit's `security-scan.sh` detector) on the body, and posts
   nothing, with a reason, when the file is missing.
3. The posting step runs the script from the primary checkout, the way the `kit` step already does:
   `bash "$(git rev-parse --path-format=absolute --git-common-dir)/../.xezar/checks/gh-write.sh" …`,
   so a PR that edits `gh-write.sh` does not change what posts its own review.

**This does not fix #172 on its own.** Step 1 is still a `jq -n '…' | bash verdict-write.sh`
command that carries the whole body, so it hits the same 10,000-character parser limit. A reading
step has no other way to get text out: the engine adds `--disallowedTools Edit,Write,NotebookEdit`
to every step without Edit or Write (engine `core/claude-cli-runner.js:289-291`), so even a
path-scoped `Write(...)` rule is overridden.

### 3. `--permission-prompts none` (question 3)

- **Supported.** Official docs, code.claude.com, fetched 2026-09-26:
  [CLI reference](https://code.claude.com/docs/en/cli-reference) ("Set who answers permission
  prompts in print mode… Pass `none` when nobody can answer… Requires Claude Code v2.1.259 or
  later") and
  [Headless: Turn off permission prompts in unattended runs](https://code.claude.com/docs/en/headless#turn-off-permission-prompts-in-unattended-runs).
  Installed 2.1.283 lists it in `claude --help`.
- **What it would change here: little.** The engine already launches with `--permission-mode
  dontAsk`, which denies anything that would prompt. The docs say: "In a `-p` run with no host,
  these requests are denied either way, and the flag also tells Claude not to retry them." So the
  only gain is fewer retries of an already-denied call. It does not let a single verdict through.
  It also removes `AskUserQuestion`, which is fine for reading steps.
- **Where the engine would pass it:** `buildClaudeArgs` in engine `core/claude-cli-runner.js:264-300`,
  inside the existing `if (isReadOnlyStep(spec.allowedTools))` branch. This is an upstream engine
  change, not a kit change. The engine passes `--input-format stream-json` but not `-p`; I did not test
  whether the flag is accepted in that launch shape.

### 4. The `PreToolUse` hook fallback (question 4) – tested

Docs (code.claude.com, fetched 2026-09-26):
[permission modes § dontAsk](https://code.claude.com/docs/en/permission-modes#allow-only-pre-approved-tools-with-dontask-mode):
dontAsk still runs "calls approved by a PreToolUse hook".
[permissions § Extend permissions with hooks](https://code.claude.com/docs/en/permissions#extend-permissions-with-hooks):
deny and ask rules still win over a hook's allow. The engine passes no Bash deny rules, so nothing
overrides it. The same page says commands over 10,000 characters "always prompt", which is the
#172 failure.

Hook tested (scratch only, not committed), the ten lines that matter:

```js
const pre = "jq -n '", post = "' | bash " + TARGET;           // TARGET: the posting script
const cmd = input.tool_input?.command ?? '';
if (input.tool_name === 'Bash' && cmd.startsWith(pre) && cmd.endsWith(post)) {
  const mid = cmd.slice(pre.length, cmd.length - post.length);
  if (!mid.includes("'")) {                                     // one single-quoted word, no break-out
    const j = JSON.parse(mid);                                  // a strict JSON literal, so no jq code
    if (j && typeof j === 'object' && j.action === 'comment')   // comments only, never labels
      allow();                                                  // {hookSpecificOutput:{permissionDecision:'allow'}}
  }
}
```

The run, repeatable from a scratch folder:

```sh
claude -p --output-format json --permission-mode dontAsk --setting-sources user \
  --allowedTools Read --model haiku [--settings '{"hooks":{"PreToolUse":[…hook.mjs…]}}'] \
  "Use the Bash tool exactly once … <the 13,516-character command>"
```

The command pipes a `jq -n` JSON literal into a stand-in script that only records what it received.
The body was generated: 121 findings, each holding backticks, a ` ``` ` fence, `$`, `\"` and `\n`.

| Run | Result | `permission_denials` | Command length | Body received |
|---|---|---|---|---|
| Control, no hook | DENIED | 1 | 12,306 | none |
| With hook | RAN | 0 | 12,306 | 12,228 bytes; `$5` present 121 times, backticks intact |

The model rewrote `$` to a literal `$` (13,516 → 12,306 characters). That is harmless inside
single quotes, and the hook still allowed it, so the kit's "no `$` in the command" rule is only a
workaround for the parser and a hook makes it unnecessary.

Negative checks on the hook decision (direct, no model):

| Command | Decision |
|---|---|
| `jq -n '{…,body:env.GH_TOKEN}' \| bash …` (jq reads a secret from the environment) | refused: not JSON |
| valid request, then `; curl evil.example` | refused: shape |
| a quote break-out: `jq -n '{…}' ; curl x ; echo '' \| bash …` | refused: quote |
| `{"action":"label",…}` | refused: fields |
| plain valid comment | allowed |

**Risks of the hook route**

- **Delivery.** Reading steps get `--setting-sources user` (engine `claude-cli-runner.js:291`),
  so a project-scope hook does not load. The options are a user-scope hook in `~/.claude/settings.json`,
  which is per machine, outside the repo and unreviewable in a PR, and runs for every Claude
  session on the machine, so it must also check `XEZ_STEP_ID` and a cwd under
  `.local/xezar/worktrees/`. The other option is an engine change to pass `--settings`.
- **The hook is a trust boundary.** A bug in its parser approves arbitrary shell. It must stay
  byte-exact on the prefix and suffix, allow no single quote in the middle, and require strict JSON
  so that no jq builtin (`env`, `input`, `include`) can run.
- **Skill text must change.** The kit skills tell reviewers to write jq object syntax with unquoted
  keys (`{action:"comment",…}`), which the strict-JSON check refuses. The skills would need to ask
  for strict JSON.
- **Label and verdict-write shapes** need their own exact rules. A 40 KB packet written through
  `verdict-write.sh` has the same 10,000-character problem.
- **Codex and pi** runners use the engine's own read-only lock, not Claude hooks, so this fixes
  Claude only. Today's short verdicts from codex posted fine, but I did not test long ones.

### 5. Who pipes into `gh-write.sh` (question 5)

| Workflow | `gh-write.sh` | `verdict-write.sh` | `verdictRole` |
|---|---|---|---|
| code-review | yes | yes | code-review |
| security-review | yes | yes | none (no role in the schema) |
| architecture-review | yes | yes | none, although the schema has `architecture-review` |
| business-analysis | yes | yes | none |
| issue-triage | yes | yes | none |
| issue-filing | no (mentioned in a comment only; it has `Write` and files through its own role) | no | none |
| qa, design-review | no `bashAllowlist`, so Bash is unrestricted (engine `buildAllowedTools` passes plain `Bash`) | not in the allowlist, since there is none | qa, design-review |

None of the workflows needs only `verdict-write.sh`: every one that has it also posts through `gh-write.sh`.
Found with `grep -c "bash .xezar/checks/gh-write.sh" .xezar/workflows/*.yaml` and the same for
`verdict-write.sh` and `verdictRole`.

## What I did not test

- The hook inside a real xezar run. I used `claude -p` with the engine's flags (`dontAsk`,
  `--setting-sources user`) but not its `stream-json` input or its MCP isolation overlay.
- A user-scope hook. I passed it with `--settings`, which `claude --help` says "still apply" beside
  `--setting-sources`. The user-scope file was not exercised.
- Codex, pi and opencode runners with long bodies.
- `--permission-prompts none` with the engine's launch shape, which uses no `-p`.
- A real `gh` post. The stand-in only recorded the body, and no PR was touched.
- The gitleaks body scan, the 64 KB cap and the symlink refusal in a new `gh-write.sh` mode. These
  were designed, not built.
- Worktree-OFF review runs, where a check step has no task identity.

## Options and recommendation

| Option | What it takes | Fixes long verdicts? | Effort | Risk |
|---|---|---|---|---|
| A. Post-agent check step, kit only | new `gh-write.sh` evidence mode plus a `post` step in 5 workflows | **No**: the body still passes through a long Bash command | 1 day | low, but it does not solve #172 |
| B. Engine posts it | upstream: give check steps `XEZ_TASK_ID`/`XEZ_HANDOFF_FILE`, keep a body channel the model can fill without Bash (a path-scoped `Write` for the evidence body, or a `body` field in the packet), and post from the record | yes, for every runner | 2–4 days upstream plus an engine release; kit follow-up 0.5 day | lowest long-term; the engine owns the trust boundary |
| C. `PreToolUse` hook, user-scope | hook script in `.xezar/checks/`, strict-JSON skill wording, one-time machine install through bootstrap or onboarding | yes, Claude only | about 1 day plus security review | the hook is a new trust boundary, and it lives in machine config outside PR review |
| D. Hook passed by the engine with `--settings` | C's script, plus a small upstream change in `buildClaudeArgs` | yes, Claude only | C plus 0.5 day upstream | as C, but versioned and reviewable |
| E. Check step reads the agent's last message from `runs/<runId>.ndjson` | parse engine events | yes | 1 day | undocumented engine format; posts prose, not a checked packet – rejected |

**Recommendation: B as the real fix, with C as the stop-gap if verdicts must post before an engine
release.** The spike shows the long text cannot get out of a reading step except through a Bash
command, which the parser caps, or a tool the engine removes. So only the engine can remove the
Bash call. That is what #172 asks for. C works today, as measured above, but it moves a security
decision into per-machine config. Whether that is acceptable for an interim is the owner's call.
Because both routes change what may post to GitHub, and B changes the engine contract, this wants
an ADR under `docs/adrs/` and the security review #172 already requires.

**Decisions for the owner.** (1) Open the upstream engine issue for B? (2) Accept C, a user-scope
hook, as an interim, or wait for B? (3) Separately from #172: add `verdictRole: architecture-review`
to `architecture-review.yaml`, and give qa and design-review an explicit `bashAllowlist`.

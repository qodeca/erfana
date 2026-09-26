// Offline validation of this project's Xezar catalog: the workflow YAML files, the
// project config, and every skill a workflow names.
//
// Why this exists at all. Xezar parses a workflow step with a Zod object that is NOT
// `.strict()` (the engine's workflow schema is a plain `z.object`, so the
// inferred type strips), so an unknown key is SILENTLY DROPPED. A typo'd `commmand:`, or
// an invented `when:` / `env:` / `cwd:` that does not exist in the schema, loads clean and
// then does nothing.
// Xezar's own catalog validation therefore proves a file parses; it cannot prove the file
// means what it says. This checker closes that gap by allow-listing keys explicitly.
//
// It is deliberately offline. The cockpit's HTTP catalog endpoint is the operator's tool,
// not a gate: it needs a running server on a port that is not fixed, and it would answer
// a different question anyway.
//
// The YAML accepted here is a strict subset — the shape this project actually authors.
// Anything outside it is a failure, not a silent pass: a checker that guesses would
// reintroduce exactly the problem it exists to prevent.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const workflowsDir = join(root, ".xezar/workflows");
const skillsDir = join(root, ".xezar/skills");
const checksDir = join(root, ".xezar/checks");
const configPath = join(root, ".xezar/config.json");
// Single-project mode (#600): `<project>/.xezar/workspace.json` is the file whose PRESENCE
// puts a folder in the mode, and it is the mode's home for the machine-shaped resource keys
// (Q3 (a)). It is committed state, not kit, so this checker reads it for exactly two things:
// that it is loadable at all, and that a committed resource key is in the place the engine
// actually reads. Everything else in it is the user's own settings and none of the kit's business.
const workspacePath = join(root, ".xezar/workspace.json");
const singleProjectMode = existsSync(workspacePath);

const errors = [];
const notes = [];
const err = (where, message) => errors.push(`${where}: ${message}`);

// --- The schemas, transcribed from the Xezar source ----------------------------------
// the engine's `workflowStepSchema` and its step-kind union
// (`workflowFileSchema`), re-read 2026-09-10 at 761c3535ba0a71977da23c3d170b767831016115
// (`@qodeca/xezar` 0.11.2). The previous transcription was taken at
// 6cd4aaa3605e8bcddf7bafd8f05ac96881ee35cc (0.10.1) and cited `:13-44` / `:51-60`; those
// ranges no longer hold, which is why this note records what was actually opened.
//
// The 2026-09-22 re-read (0.19.0, main 7147c938) added `verdictRole` at `types.ts:88`: the reviewer
// role an agent step reports a verdict as, refused on a check step by the refine at `:113-115`.
// The 2026-09-16 re-read added `resultScope`, the check-only significance enum declared beside
// `command` in both the contract and runtime schemas. The earlier re-read added `timeout`, declared
// at `:79` (its scalar `stepTimeoutSchema`
// at `:38-41`, and refused on a check step by the refine at `:94-96`). It is the per-step
// wall clock #22 introduced. Until this set learned it, a workflow that set a fully
// supported `timeout` was rejected below as an unknown step key that "would do nothing" —
// the exact opposite of the truth.
//
// The lesson, for whoever adds the next engine field: a stale transcription of the schema
// fails CLOSED. That is the safe direction — an invented key is still caught — but it also
// silently blocks a real engine feature, and the refusal message argues confidently for the
// wrong side. When the engine adds a step key, this set must be updated in the SAME change,
// and the ranges above must be re-derived by opening the file rather than trusted.
const STEP_KEYS = new Set([
  "id",
  "name",
  "prompt",
  "skill",
  "model",
  "runner",
  "allowedTools",
  "bashAllowlist",
  "command",
  "resultScope",
  "verdictRole",
  "onFail",
  "timeout",
]);
const ON_FAIL_KEYS = new Set(["retry", "max"]);
const FILE_KEYS = new Set(["name", "description", "steps", "skills"]);

// Maintained project roles require the shared contract; custom skills remain standalone.
const MAINTAINED_SKILLS = new Set([
  "xezar-acceptance",
  "xezar-architecture",
  "xezar-bug-investigation",
  "xezar-business-analysis",
  "xezar-code-review",
  "xezar-dependency-maintenance",
  "xezar-deploy",
  "xezar-deprecation-plan",
  "xezar-design-system",
  "xezar-docs-maintenance",
  "xezar-handoff-draft-pr",
  "xezar-implementation",
  "xezar-integration",
  "xezar-integration-tests",
  "xezar-issue-create",
  "xezar-issue-triage",
  "xezar-localisation",
  "xezar-migration",
  "xezar-observability",
  "xezar-performance",
  "xezar-planning-spec",
  "xezar-qa",
  "xezar-quality-gates",
  "xezar-refactor",
  "xezar-regression-suite",
  "xezar-release-changelog",
  "xezar-release-prep",
  "xezar-release-publish",
  "xezar-research",
  "xezar-review-response",
  "xezar-security-review",
  "xezar-spike",
  "xezar-testing",
  "xezar-ui-design",
  "xezar-ui-tests",
  "xezar-ux-design",
  "xezar-visual-asset",
]);

// The only skills that may keep `interactive: true` in frontmatter. It is a composer
// SEED, not a lock: it pre-ticks Worktree OFF and Autonomous OFF. That is right for a
// read-only run, which writes nothing and needs no isolated checkout, and wrong for
// everything else now that Xezar owns the worktree.
const READ_ONLY_SKILLS = new Set([
  "xezar-code-review",
  "xezar-issue-triage",
  "xezar-security-review",
]);

// A reading step: its `allowedTools` holds neither Edit nor Write, which is the engine's own signal
// for a step that must not change files (xezar #849). A tool list alone never made that true –
// every backend still offered a shell – so a reading step also carries a `bashAllowlist`, and every
// entry must be one of these prefixes. A prefix limits the program, never its target, so every
// command that can write is a kit script instead: git goes through `git-read.sh`, a comment or a
// label through `gh-write.sh`, and every file a reader must write through `verdict-write.sh`.
// `gh pr comment` alone takes `--edit-last`, `-R` and `-F <file>`; `git diff` takes `--output`.
// `jq -n` only prints: it is how a reader feeds text into those scripts, since a heredoc into a
// script is refused (a pipe's left side needs no entry on Claude, but not every runner says so).
const READER_BASH_PREFIXES = new Set([
  "gh pr view",
  "gh pr diff",
  "gh pr checks",
  "gh pr list",
  "gh issue view",
  "gh issue list",
  "gh label list",
  "gh repo view",
  "jq -n",
  "bash .xezar/checks/git-read.sh",
  "bash .xezar/checks/gh-write.sh",
  "bash .xezar/checks/verdict-write.sh",
  "bash .xezar/checks/phase-record.sh",
  "bash .xezar/checks/worktree-setup.sh --readonly-init",
]);

// The only tools a kit reading workflow may list. Naming what is allowed, rather than refusing Edit
// and Write, keeps a writing tool with another name (NotebookEdit, MultiEdit) out as well.
const READER_TOOLS = new Set(["Read", "Grep", "Glob", "Bash"]);

// The engine's verdict roles (0.19.0, `TASK_VERDICT_ROLES`, xezar #851). The engine records a verdict
// packet only from an agent step that DECLARES the role the packet names, so each kit workflow whose
// skill writes a packet must declare it on its verdict step, or every verdict it writes is refused.
const VERDICT_ROLES = new Set(["code-review", "design-review", "qa", "architecture-review"]);
const VERDICT_WORKFLOWS = { "code-review": "code-review", "design-review": "design-review", qa: "qa" };

// The kit's reading workflows, by FILE name (not the `name:` field, which a pull request could
// change). Named, so that a pull request adding a writing tool to one of them fails in plain sight
// instead of quietly escaping the rule above.
const READ_ONLY_WORKFLOWS = new Set([
  "architecture-review",
  "business-analysis",
  "code-review",
  "issue-triage",
  "security-review",
]);

// Steps that hold neither Edit nor Write but must RUN code – a build, a test, a dev server, a
// browser – and so cannot live inside a prefix list. They run in their own detached worktree and
// never touch the author's branch; that, not a shell limit, is their guarantee.
const RUNS_CODE_WORKFLOWS = new Set(["acceptance-verification", "design-review", "qa"]);

// The narrow way to run code (local patch, #177): a RUNS_CODE step that does carry a bashAllowlist
// may add only these, to put its own detached worktree on the head under review and run it. The
// engine's read-only lock still refuses `fetch --upload-pack|--exec`, `checkout ... -- <path>` and
// `npm --prefix` under them. Nothing else – no build, no test runner, no npx – is admitted here.
const RUNS_CODE_BASH_PREFIXES = new Set(["git fetch origin", "git checkout --detach", "npm ci", "npm run dev"]);

// the engine's `configSchema`.
const CONFIG_KEYS = new Set([
  "skillsRepos",
  "maxParallel",
  "worktreeRetention",
  "memoryLimitMb",
  "defaultRunner",
  "plannerModel",
  "namerModel",
  "liveTitleUpdates",
  "reviewGate",
  "baseBranch",
  "systemPrompt",
  "defaultModels",
  "modelsLocked",
]);

// --- A strict reader for the subset we author ------------------------------------------
// Top-level `key: value` at column 0; one list of steps, each item opening with `  - `
// at column 2 and continuing at column 4; `onFail` sub-keys at column 6.
function parseWorkflow(text, file) {
  const doc = { steps: null, skills: null };
  let step = null;
  let inOnFail = false;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;

    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();

    const kv = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(body.startsWith("- ") ? body.slice(2) : body);

    if (indent === 0) {
      inOnFail = false;
      step = null;
      if (!kv) {
        err(file, `line ${lineNo}: expected a top-level "key: value", got "${body}"`);
        continue;
      }
      const [, key, value] = kv;
      if (!FILE_KEYS.has(key)) {
        err(file, `line ${lineNo}: unknown top-level key "${key}" — Xezar strips it silently`);
        continue;
      }
      if (key === "steps" || key === "skills") {
        if (value !== "") err(file, `line ${lineNo}: "${key}" must open a block, not carry a value`);
        doc[key] = [];
      } else {
        doc[key] = unquote(value);
      }
      continue;
    }

    if (indent === 2 && body.startsWith("- ")) {
      if (!Array.isArray(doc.steps)) {
        err(file, `line ${lineNo}: a list item appeared before "steps:"`);
        continue;
      }
      inOnFail = false;
      step = { __line: lineNo };
      doc.steps.push(step);
      if (!kv) {
        err(file, `line ${lineNo}: expected "- key: value", got "${body}"`);
        continue;
      }
      assignStepKey(step, kv, file, lineNo);
      continue;
    }

    if (indent === 4 && step) {
      inOnFail = false;
      if (!kv) {
        err(file, `line ${lineNo}: expected "key: value" inside a step, got "${body}"`);
        continue;
      }
      if (kv[1] === "onFail") {
        if (kv[2] !== "") err(file, `line ${lineNo}: "onFail" must open a block, not carry a value`);
        step.onFail = {};
        inOnFail = true;
        continue;
      }
      assignStepKey(step, kv, file, lineNo);
      continue;
    }

    if (indent === 6 && step && inOnFail) {
      if (!kv) {
        err(file, `line ${lineNo}: expected "key: value" inside onFail, got "${body}"`);
        continue;
      }
      const [, key, value] = kv;
      if (!ON_FAIL_KEYS.has(key)) {
        err(file, `line ${lineNo}: unknown onFail key "${key}" — Xezar strips it silently`);
        continue;
      }
      step.onFail[key] = unquote(value);
      continue;
    }

    err(file, `line ${lineNo}: unexpected indentation ${indent} for "${body}"`);
  }
  return doc;
}

function assignStepKey(step, kv, file, lineNo) {
  const [, key, value] = kv;
  if (!STEP_KEYS.has(key)) {
    err(
      file,
      `line ${lineNo}: unknown step key "${key}" — Xezar's step schema strips it silently, so it would do nothing`,
    );
    return;
  }
  step[key] = key === "allowedTools" || key === "bashAllowlist" ? parseInlineList(value) : unquote(value);
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length > 1 && trimmed[0] === '"' && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((entry) => unquote(entry))
    .filter((entry) => entry !== "");
}

// --- The rules ---------------------------------------------------------------------------

// A reading step is only as read-only as its shell. See READER_BASH_PREFIXES.
function checkReaderStep(at, workflow, step) {
  const tools = step.allowedTools;
  const writes = Array.isArray(tools) && (tools.includes("Edit") || tools.includes("Write"));
  if (READ_ONLY_WORKFLOWS.has(workflow) && (!Array.isArray(tools) || writes || !tools.every((t) => READER_TOOLS.has(t)))) {
    err(at, `"${workflow}" is a reading workflow: its allowedTools must be listed and hold only ${[...READER_TOOLS].join(", ")}`);
    return;
  }
  if (!Array.isArray(tools) || writes) return;
  const list = step.bashAllowlist;
  if (!Array.isArray(list) || list.length === 0) {
    if (RUNS_CODE_WORKFLOWS.has(workflow)) return;
    err(
      at,
      "holds neither Edit nor Write, so it is a reading step, and it has no bashAllowlist – every backend still gives it a shell that can write",
    );
    return;
  }
  for (const entry of list) {
    if (!READER_BASH_PREFIXES.has(entry) && !(RUNS_CODE_WORKFLOWS.has(workflow) && RUNS_CODE_BASH_PREFIXES.has(entry))) {
      err(at, `bashAllowlist entry "${entry}" is not a reading prefix; git goes through git-read.sh, comments and labels through gh-write.sh, files through verdict-write.sh`);
    }
  }
}

function checkWorkflow(file, doc) {
  if (!doc.name) err(file, 'missing "name"');
  if (Boolean(doc.steps) === Boolean(doc.skills)) {
    err(file, 'a workflow lists either "steps" or "skills", not both');
    return;
  }
  if (!doc.steps) return;
  if (doc.steps.length === 0) err(file, '"steps" is empty');

  const ids = doc.steps.map((s) => s.id);
  const agentIndexes = [];

  doc.steps.forEach((step, index) => {
    const at = `${file} step "${step.id ?? `#${index + 1}`}"`;
    if (!step.id) err(at, "missing an id");
    if (ids.indexOf(step.id) !== index) err(at, "duplicate step id");

    const isCheck = Boolean(step.command);
    const isAgent = Boolean(step.prompt || step.skill);
    if (isCheck === isAgent) {
      err(at, "a step is either an agent step (prompt/skill) or a check step (command), not both");
    }
    if (isAgent) {
      agentIndexes.push(index);
      // Every agent step pins the model: the run engine reads the step's model and never
      // `defaultModels`, so an unpinned step silently runs whatever the composer showed.
      // Model is intentionally inherited from the selected available backend; do not pin a foreign vendor.
      if (step.skill) {
        const skillPath = join(skillsDir, `${step.skill}.md`);
        if (!existsSync(skillPath)) err(at, `names skill "${step.skill}", which has no file at ${skillPath}`);
      }
      checkReaderStep(at, basename(file).replace(/\.ya?ml$/, ""), step);
    }
    if (isCheck) {
      // A check step's command must be a script this repo actually ships, so a renamed or
      // deleted script is a load-time failure rather than a runtime one.
      const script = step.command.split(/\s+/)[0];
      if (script.startsWith(".xezar/checks/") && !existsSync(join(root, script))) {
        err(at, `runs "${script}", which does not exist`);
      }
    }
    if (step.verdictRole !== undefined) {
      if (!isAgent) err(at, "verdictRole applies to an agent step; a check step (command) reports no verdict");
      if (!VERDICT_ROLES.has(step.verdictRole)) err(at, `verdictRole must be one of ${[...VERDICT_ROLES].join(", ")} (got "${step.verdictRole}")`);
    }
    if (step.resultScope !== undefined) {
      if (!isCheck) err(at, "resultScope applies only to a check step (command)");
      if (step.resultScope !== "routine" && step.resultScope !== "stage") {
        err(at, `resultScope must be "routine" or "stage" (got "${step.resultScope}")`);
      }
    }
    if (step.onFail) {
      const target = ids.indexOf(step.onFail.retry);
      if (target === -1 || target >= index) {
        err(at, `onFail.retry must reference an EARLIER step (got "${step.onFail.retry}")`);
      }
    }
  });

  const workflowName = basename(file).replace(/\.ya?ml$/, "");
  const role = VERDICT_WORKFLOWS[workflowName];
  if (Object.hasOwn(VERDICT_WORKFLOWS, workflowName) && !doc.steps.some((s) => s.verdictRole === role)) {
    err(file, `its skill writes a ${role} verdict packet, and no agent step declares verdictRole: ${role}, so the engine refuses every one`);
  }

  // --- The shared phase contract ------------------------------------------------------------
  // Added 2026-09-09 (issue #116). A workflow that runs the gates is a WRITING workflow, and every
  // writing workflow here has the same spine: isolate, prepare, author, confirm not blocked, gate,
  // seal, hand off. The order is not cosmetic — each step consumes what the one before it
  // established, and a missing or reordered phase produces a run that looks complete and is not.
  // `readiness` before `gates` is the load-bearing pair: it is what makes a BLOCKED task stop
  // before anyone pays for a gate run, and dropping it is invisible in a green transcript.
  const stepIds = doc.steps.map((s) => s.id);
  const at = (id) => stepIds.indexOf(id);
  if (at("gates") !== -1) {
    for (const required of ["preflight", "setup", "readiness", "gates", "evidence", "handoff"]) {
      if (at(required) === -1) {
        err(file, `runs the gates but has no "${required}" step — the writing-workflow phase contract is preflight, setup, agent, readiness, gates, evidence, handoff`);
      }
    }
    const order = ["preflight", "setup", "readiness", "gates", "evidence", "handoff"]
      .map((id) => [id, at(id)])
      .filter(([, i]) => i !== -1);
    for (let i = 1; i < order.length; i++) {
      if (order[i][1] < order[i - 1][1]) {
        err(file, `phase "${order[i][0]}" runs before "${order[i - 1][0]}"; the writing-workflow phases must keep their order`);
      }
    }
  } else if (at("setup") !== -1) {
    // No gates, but it installs dependencies anyway. `worktree-setup.sh` runs a full
    // `npm install`, which is minutes of work and disk a read-only or coordination run never
    // uses. Read-only workflows initialize their evidence without it, deliberately.
    err(file, 'has a "setup" step but no "gates" step — a workflow that does not build or test must not run a full dependency install');
  }

  // The interactivity rule. A run is interactive only when its last step is also its last
  // agent step (`src/workflows/run.ts:2799`). A trailing check step therefore silences
  // XEZ:ASK and XEZ:DONE for the whole run — the single most expensive authoring mistake
  // available here, and invisible in the YAML.
  const lastAgent = agentIndexes[agentIndexes.length - 1];
  if (lastAgent === undefined) {
    err(file, "has no agent step, so it can never report a result");
  } else if (lastAgent !== doc.steps.length - 1) {
    err(
      file,
      `ends with a check step ("${doc.steps[doc.steps.length - 1].id}"). A workflow whose last step is not its last agent step is NOT interactive: XEZ:ASK and XEZ:DONE are silenced for the entire run.`,
    );
  }
}

// --- Run -------------------------------------------------------------------------------
if (!existsSync(workflowsDir)) {
  err(".xezar/workflows", "directory is missing");
} else {
  const files = readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  if (files.length === 0) err(".xezar/workflows", "no workflow files found");
  for (const file of files) {
    const doc = parseWorkflow(readFileSync(join(workflowsDir, file), "utf8"), file);
    checkWorkflow(file, doc);
  }
  notes.push(`${files.length} workflow file(s) checked`);
}

// A project's own Claude settings re-widen a reading step's shell: the engine removes only the
// file tools, and a `permissions.allow` Bash rule here is added to the step's allowlist (engine
// answer on xezar #849). So a Bash rule is allowed only when it names a reading prefix.
for (const name of ["settings.json", "settings.local.json"]) {
  const path = join(root, ".claude", name);
  if (!existsSync(path)) continue;
  let allow;
  try {
    allow = JSON.parse(readFileSync(path, "utf8"))?.permissions?.allow;
  } catch (error) {
    err(`.claude/${name}`, `is not valid JSON: ${error.message}`);
    continue;
  }
  if (allow === undefined) continue;
  if (!Array.isArray(allow)) {
    err(`.claude/${name}`, "permissions.allow is not a list");
    continue;
  }
  for (const rule of allow) {
    if (typeof rule !== "string" || !/^Bash\b/.test(rule)) continue;
    const prefix = /^Bash\((.+?)(?::\*|\s\*)?\)$/.exec(rule)?.[1];
    if (!prefix || !READER_BASH_PREFIXES.has(prefix)) {
      err(`.claude/${name}`, `permissions.allow has "${rule}", which widens every reading step's shell; allow only a reading prefix here`);
    }
  }
}

// A project's own Codex rules re-widen a reading step the same way: an exec-policy rule in
// `.codex/rules/*.rules` whose decision is "allow" (the default when none is given) runs its command
// outside the sandbox with no approval, and the engine cannot switch the layer off (xezar #862). So
// every `prefix_rule` here must say "prompt" or "forbidden" in plain text.
const codexRules = join(root, ".codex", "rules");
if (existsSync(codexRules)) {
  for (const name of readdirSync(codexRules).filter((f) => f.endsWith(".rules")).sort()) {
    const text = readFileSync(join(codexRules, name), "utf8").replace(/#.*$/gm, "");
    const calls = text.split(/\bprefix_rule\s*\(/).slice(1);
    if (calls.length === 0 && text.trim() !== "") err(`.codex/rules/${name}`, "has no prefix_rule this check can read; write each rule as a plain prefix_rule(...) call");
    for (const call of calls) {
      const decision = /\bdecision\s*=\s*["']([a-z]+)["']/.exec(call)?.[1];
      if (decision !== "prompt" && decision !== "forbidden") {
        err(`.codex/rules/${name}`, `has a prefix_rule with decision ${decision ? `"${decision}"` : "missing (allow)"}, which runs a reading step's command outside its sandbox; use "prompt" or "forbidden"`);
      }
    }
  }
}

// Every skill file must be well-formed. That is the whole scope, and the comment used to claim
// more than the code does: it said every skill must be "reachable", which no loop below checks.
// It is not checked because it would be wrong to check — a skill named by no workflow is normal
// here (several are launched straight from the composer), so an orphan rule would reject correct
// configuration. What is validated is the frontmatter: the name matches the filename, a
// description exists, and `interactive: true` appears only on a read-only skill.
if (existsSync(skillsDir)) {
  const skillFiles = readdirSync(skillsDir).filter((f) => f.endsWith(".md")).sort();
  let sharedContract;
  for (const file of skillFiles) {
    const text = readFileSync(join(skillsDir, file), "utf8");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!fm) {
      err(`skills/${file}`, "has no YAML frontmatter block");
      continue;
    }
    const name = /^name:\s*(.+)$/m.exec(fm[1])?.[1]?.trim();
    if (!name) err(`skills/${file}`, 'frontmatter has no "name"');
    else if (name !== file.replace(/\.md$/, "")) {
      err(`skills/${file}`, `frontmatter name "${name}" does not match the filename`);
    }
    if (name?.startsWith("xezar-")) {
      const shared = text.split("## Shared contract\n")[1];
      if (MAINTAINED_SKILLS.has(name) && shared === undefined) {
        err(`skills/${file}`, "maintained role is missing its shared contract");
      }
      // Custom entries opt into equality checking only when they include the section.
      if (shared !== undefined) {
        if (!shared.trim()) err(`skills/${file}`, "shared contract is empty");
        else if (sharedContract === undefined) sharedContract = shared;
        else if (shared !== sharedContract) err(`skills/${file}`, "shared contract differs from the other self-contained roles");
      }
    }
    if (!/^description:\s*\S/m.test(fm[1])) err(`skills/${file}`, 'frontmatter has no "description"');
    // `interactive: true` is a composer SEED: it makes the New Task form pre-tick Worktree
    // OFF and Autonomous OFF (`src/skills.ts:226` reads it; the composer's default
    // resolver turns `interactive !== true` into "inherit" and `=== true` into "off" for
    // both toggles). Under worktree mode a writing skill must not carry it.
    if (/^interactive:\s*true\s*$/m.test(fm[1]) && !READ_ONLY_SKILLS.has(name)) {
      err(
        `skills/${file}`,
        '`interactive: true` seeds the composer\'s Worktree toggle OFF. Only the read-only skills may carry it.',
      );
    }
  }
  notes.push(`${skillFiles.length} skill file(s) checked`);
}

if (!existsSync(configPath)) {
  notes.push("project config absent: engine defaults apply");
} else {
  // A malformed config exits non-zero either way — an uncaught `JSON.parse` throws and node exits
  // 1 — but it used to do so by printing a raw `SyntaxError` stack, which looks like a crash in
  // the checker rather than a diagnosis of the file it was asked to check. The exit code was
  // never the problem; the message was. The parse error text is kept, because "Unexpected token }
  // in JSON at position 62" is the one part of that stack a reader actually needs.
  let config = null;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      err(".xezar/config.json", "is valid JSON but not an object, so it cannot carry any project setting");
      config = null;
    }
  } catch (error) {
    err(".xezar/config.json", `is not valid JSON: ${error.message}`);
  }
  if (config === null) {
    // Every rule below reads a key. Running them against nothing would report a pile of
    // consequences of the one fault already named, which buries it.
    notes.push("project config NOT checked — it could not be parsed (see the failure below)");
  } else {
    for (const key of Object.keys(config)) {
      if (!CONFIG_KEYS.has(key)) err(".xezar/config.json", `unknown key "${key}" — Xezar ignores it`);
    }
    // Both keys below are refused in a COMMITTED project config, but for two different reasons,
    // and the difference is load-bearing: the message has to say the true one.
    //
    // `maxParallel` really is ignored by the engine after migration 001 seeds it into the
    // workspace file ("Legacy per-repo `maxParallel` keys are ignored", `run.ts`), so committing
    // it would document a limit that nothing enforces — worse than no key, because it reads as
    // one.
    //
    // `memoryLimitMb` is NOT ignored, and saying so was wrong from B2 onward: `run.ts` resolves it
    // through `WorkspaceSemaphore.projectMemoryLimitMb(repoRoot)`, and a repo's own value
    // overrides the workspace ceiling for that repo's runs. The refusal stands anyway, on kit
    // POLICY: `.xezar/CLAUDE.md` says the committed project config carries no global resource
    // limits, because this file travels to every checkout and a machine-sized ceiling is a
    // property of a machine, not of the project. Set it per user, where it belongs.
    //
    // Single-project mode (#600 FR-7.2, Q3 (a)) does not lift either refusal — it changes WHERE
    // the advice points. In the mode there IS a committed home for a machine-shaped key, and it
    // is `workspace.json -> resources`, which the engine reads; `.xezar/config.json` still is not,
    // so a key here would still be a false promise. And the standing advice "set it per user in
    // ~/.xezar/config.json" is advice the user cannot take in the mode, because BR-2 means that
    // file is never opened there. Both texts below are AMENDED rather than replaced: outside the
    // mode they still describe a real engine behaviour and are still the whole truth.
    const modeSuffix = singleProjectMode
      ? " This folder is in single-project mode, so the committed home for this key is .xezar/workspace.json -> resources, which the engine does read; ~/.xezar is never opened here."
      : "";
    const REFUSED_IN_PROJECT_CONFIG = {
      maxParallel:
        "The scheduler ignores it: parallelism is workspace state, in ~/.xezar/config.json -> projects[].maxParallel and resources.maxParallel. A committed key here would be a false promise." + modeSuffix,
      memoryLimitMb:
        "The engine DOES honour a per-repo value, but the kit does not commit one: a memory ceiling is a property of a machine, not of a project, and this file travels to every checkout. Set it per user, in ~/.xezar/config.json -> resources.memoryLimitMb, or in an uncommitted local config." + modeSuffix,
    };
    for (const [key, why] of Object.entries(REFUSED_IN_PROJECT_CONFIG)) {
      if (key in config) {
        err(".xezar/config.json", `must not set \`${key}\`. ${why}`);
      }
    }
    if (config.baseBranch != null && (typeof config.baseBranch !== "string" || !config.baseBranch.trim())) err("config", "baseBranch must be a nonempty string when supplied");
    notes.push("project config checked");
  }
}

// --- Single-project mode: the committed workspace file (#600 FR-7.2, SP-2.6) -------------
//
// Absent = the global layout, and then there is nothing here to check: the workspace file is
// in the per-user home, which travels to no checkout and is not the kit's business. Present =
// the folder owns its state, and this file is now committed alongside the kit — so the two
// things a kit check can usefully say about it are said here and nothing more.
if (!singleProjectMode) {
  notes.push("single-project workspace file absent: global layout, nothing committed to check");
} else {
  let workspace = null;
  try {
    workspace = JSON.parse(readFileSync(workspacePath, "utf8"));
    if (workspace === null || typeof workspace !== "object" || Array.isArray(workspace)) {
      // The engine REFUSES THE BOOT on this (`assertProjectStateUsable`, #600 Q1), because
      // degrading would silently run the project off the user's global setup. A kit check that
      // passed a file xezar will not start on would be reporting the wrong thing.
      err(".xezar/workspace.json", "is valid JSON but not an object — xezar refuses to boot in this folder until it is repaired or deleted");
      workspace = null;
    }
  } catch (error) {
    err(".xezar/workspace.json", `is not valid JSON: ${error.message} — xezar refuses to boot in this folder until it is repaired or deleted`);
  }
  if (workspace === null) {
    notes.push("single-project workspace file NOT checked — it could not be parsed (see the failure below)");
  } else {
    // The machine-shaped keys are ACCEPTED here, and that acceptance is the whole point of
    // FR-7.2: in the mode a committed `memoryLimitMb` or `maxParallel` is honoured exactly as
    // written (AC-7, no clamp), so refusing it would refuse a legitimate setting. What is still
    // refused is the same fault the `.xezar/config.json` rule catches — a key in a place nothing
    // reads. `resources` is where `loadWorkspaceConfig` looks; the top level is not.
    const MACHINE_SHAPED = ["maxParallel", "memoryLimitMb"];
    for (const key of MACHINE_SHAPED) {
      if (key in workspace) {
        err(
          ".xezar/workspace.json",
          `\`${key}\` is at the top level, where nothing reads it. Move it under "resources" — that is where the engine resolves it, and where the mode accepts it.`,
        );
      }
    }
    const resources = workspace.resources;
    if (resources !== undefined && (resources === null || typeof resources !== "object" || Array.isArray(resources))) {
      err(".xezar/workspace.json", '"resources" must be an object when supplied');
    } else {
      // "Applied as written, never clamped to this host" is the promise below, and it is only
      // true INSIDE the engine schema's own ranges. Outside them the value is not applied at
      // all: `workspace/config.ts` ends both keys with a `.catch()`, so `maxParallel: 17`
      // becomes the shipped default 2 and `memoryLimitMb: 2000000` becomes this host's
      // derivation — silently, with no warning and no line anywhere. That is a committed file
      // promising a number nothing runs, and the one machine-visible substitution AC-7 forbids,
      // so the kit refuses it here rather than letting the note claim it was honoured.
      //
      // The ranges are VALIDATION, not host reconciliation: they are the same on every machine,
      // so refusing an out-of-range value costs a clone nothing and tells the author now instead
      // of after a run behaved unlike the file. Keep them equal to the schema in
      // the engine's workspace config schema (`maxParallel`, `memoryLimitMb`).
      const RANGES = {
        maxParallel: { min: 1, max: 16, nullable: false },
        memoryLimitMb: { min: 0, max: 1_048_576, nullable: true },
      };
      for (const key of MACHINE_SHAPED) {
        if (resources === undefined || !(key in resources)) continue;
        const value = resources[key];
        const { min, max, nullable } = RANGES[key];
        const range = `${min}–${max}${nullable ? " or null" : ""}`;
        if (value === null) {
          if (!nullable) {
            err(".xezar/workspace.json", `\`resources.${key}\` must be a whole number in ${range}, not null. The engine substitutes its shipped default for anything else, silently — so a committed value outside that range is a promise nothing keeps.`);
          }
          continue;
        }
        if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
          err(".xezar/workspace.json", `\`resources.${key}\` must be a whole number in ${range} (found ${JSON.stringify(value)}). The engine substitutes its shipped default for anything else, silently — so a committed value outside that range is a promise nothing keeps.`);
        }
      }
      const committed = MACHINE_SHAPED.filter((key) => resources !== undefined && key in resources);
      notes.push(
        committed.length > 0
          ? `single-project workspace file checked: committed ${committed.join(" and ")} accepted, in range (maxParallel 1–16, memoryLimitMb 0–1048576 or null) and applied as written, never clamped to this host`
          : "single-project workspace file checked",
      );
    }
  }
}

if (!existsSync(join(checksDir, "repo-gates.sh"))) err(".xezar/checks", "repo-gates.sh is missing");

for (const note of notes) process.stdout.write(`  ${note}\n`);
if (errors.length > 0) {
  process.stdout.write(`\nCATALOG CHECK FAILED (${errors.length}):\n`);
  for (const line of errors) process.stdout.write(`  - ${line}\n`);
  process.exit(1);
}
process.stdout.write("CATALOG OK\n");

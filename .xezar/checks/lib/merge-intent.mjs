// The record of an authorized merge, written BEFORE the merge starts.
//
// WHY IT EXISTS. A merge that stops half way leaves `MERGE_HEAD` in the git directory, and the
// strict preflight refuses that state outright — correctly, because "there is a merge in
// progress" is indistinguishable, after the fact, from "something started a merge nobody
// authorized". The refusal is what stops an agent from committing a tree it does not understand.
//
// But the refusal has no exit. The only ways out of a conflicted merge are `--abort` and
// `reset`, both of which DESTROY the resolution work, and neither of which a failed preflight
// may be read as permission for. So an interrupted authorized merge had no path forward at all.
//
// This closes that by moving the decision EARLIER. Before the merge runs, the run writes down
// what it is about to do: which run, which worktree, which branch, which repository, the exact
// HEAD it is merging into and the exact commit it is merging in, plus the human authorization it
// is acting under. If that merge is then interrupted, the recovery check has something to compare
// the interrupted state AGAINST — and it admits the merge only when every one of those matches.
//
// WHAT THIS IS NOT.
//
//   - It is NOT authority. `authorization.reference` is a string the run was given; nothing here
//     verifies that a human wrote it, that it means what it says, or that its scope covers this
//     merge. These are MECHANICAL IDENTITY CHECKS — same run, same tree, same two commits — and
//     they answer "is this the operation that was written down", never "was this operation
//     allowed". A human reads the reference; this file only carries it.
//   - It is NOT a sandbox. Admitting the merge lets the ordinary preflight pass, which is all it
//     does. Nothing confines what an agent then edits, and no claim is made that it does. The
//     "bounded to resolution edits" bound is a PROMPT-LEVEL scope in the recovery skill text,
//     enforced by a human reading the diff, not by this code.
//   - It is NOT permission to abort. Nothing here aborts, resets or cleans anything, ever. A
//     preservation-safe abort is a separate, explicit decision by the leader.
//
// Usage:
//   node merge-intent.mjs record --path <file> --json '<intent>' [--replace]
//   node merge-intent.mjs check  --path <file> --json '<observed>' [--json-out]
//
// Exit codes: 0 ok · 1 refused · 2 usage or malformed input · 3 no intent recorded.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SCHEMA_VERSION = 1;
export const INTENT_KIND = "xezar.merge-intent";

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const EXIT_NO_INTENT = 3;

/**
 * The fields an intent must carry, and the observation each one is compared against.
 *
 * Every entry is a hard equality. There is no "close enough", no prefix match on a SHA and no
 * case folding: a recovery that accepted an abbreviated or near-miss identity would be admitting
 * an operation nobody wrote down, which is the whole thing being prevented.
 */
const COMPARED = [
  ["runId", "identity.run", "the run that recorded the intent"],
  ["worktree", "identity.worktree", "the worktree the merge was started in"],
  ["branch", "identity.branch", "the branch being merged into"],
  ["repoRootCommit", "identity.repo", "the repository (root commit)"],
  ["expectedHeadSha", "parents.head", "the commit HEAD was at when the merge started"],
  ["expectedIncomingSha", "parents.incoming", "the commit being merged in (MERGE_HEAD)"],
];

/** Fields that must be present and non-empty for the record to mean anything at all. */
const REQUIRED = [
  ...COMPARED.map(([field]) => field),
  "authorizationReference",
  "authorizationScope",
];

function die(code, message) {
  process.stderr.write(`merge-intent: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) die(EXIT_USAGE, `unexpected argument "${token}"`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

function requiredJson(args) {
  if (typeof args.json !== "string") die(EXIT_USAGE, "--json '<object>' is required");
  try {
    const parsed = JSON.parse(args.json);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      die(EXIT_USAGE, "--json must be a JSON object");
    }
    return parsed;
  } catch (error) {
    die(EXIT_USAGE, `--json is not valid JSON: ${error.message}`);
  }
}

/** Never write through a symlink: the path is derived from a run id and should be a plain file. */
function refuseSymlink(target, what) {
  try {
    if (lstatSync(target).isSymbolicLink()) die(EXIT_USAGE, `refusing to write through a symlinked ${what}: ${target}`);
  } catch {
    /* absent is fine */
  }
}

function writeJsonAtomic(path, data) {
  refuseSymlink(dirname(path), "evidence directory");
  refuseSymlink(path, "intent file");
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/** Read a recorded intent, or say precisely why it cannot be read. Never returns a guess. */
export function readIntent(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ok: false, code: EXIT_NO_INTENT, reason: `no merge intent is recorded at ${path}` };
  }
  let intent;
  try {
    intent = JSON.parse(raw);
  } catch (error) {
    return { ok: false, code: EXIT_REFUSED, reason: `the recorded merge intent is not valid JSON: ${error.message}` };
  }
  if (intent?.kind !== INTENT_KIND) {
    return { ok: false, code: EXIT_REFUSED, reason: `the recorded file is kind "${intent?.kind}", not "${INTENT_KIND}"` };
  }
  if (intent.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, code: EXIT_REFUSED, reason: `merge intent schemaVersion ${JSON.stringify(intent.schemaVersion)} is not ${SCHEMA_VERSION}` };
  }
  const missing = REQUIRED.filter((field) => typeof intent[field] !== "string" || intent[field].trim() === "");
  if (missing.length > 0) {
    return { ok: false, code: EXIT_REFUSED, reason: `the recorded merge intent is missing: ${missing.join(", ")}` };
  }
  return { ok: true, intent };
}

/** "a.b" -> observed.a.b, without creating anything. */
function read(data, dotted) {
  return dotted.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), data);
}

/**
 * Compare an observed state against a recorded intent.
 *
 * Returns EVERY failed predicate, not the first. A recovery refusal that named only one
 * mismatch would send a reader to fix that one and hit the next, and the set of mismatches is
 * itself the diagnosis: "wrong run" and "wrong incoming parent" mean very different things.
 */
export function compareIntent(intent, observed) {
  const failed = [];
  const matched = [];
  for (const [field, path, what] of COMPARED) {
    const want = intent[field];
    const got = read(observed, path);
    if (want === got) matched.push({ predicate: path, what, value: want });
    else failed.push({ predicate: path, what, expected: want ?? null, actual: got ?? null });
  }

  // The operation itself. A merge is admitted; every other in-flight git operation is not, and a
  // merge running ALONGSIDE another operation is not either — "a merge is in progress" is not the
  // same statement as "a merge is the only thing in progress".
  const operations = Array.isArray(observed.operations) ? observed.operations : [];
  const foreign = operations.filter((op) => op !== "MERGE_HEAD" && op !== "unmerged paths");
  if (!operations.includes("MERGE_HEAD")) {
    failed.push({
      predicate: "operation.merge-in-progress",
      what: "an interrupted merge to recover",
      expected: "MERGE_HEAD present",
      actual: operations.length > 0 ? operations.join(", ") : "no git operation in progress",
    });
  }
  if (foreign.length > 0) {
    failed.push({
      predicate: "operation.merge-only",
      what: "no other git operation in flight",
      expected: "MERGE_HEAD only",
      actual: foreign.join(", "),
    });
  }
  return { failed, matched };
}

/**
 * What git operations are actually in flight in a worktree, read from that worktree's own git
 * directory. Returns null when the state cannot be determined — which is never treated as "clean".
 *
 * This is deliberately NOT taken from the caller. The whole ordering guarantee — "the record
 * predates the merge" — is a claim about real state, so it is checked against real state.
 */
export function operationsInWorktree(worktree) {
  let gitDir;
  try {
    gitDir = execFileSync("git", ["-C", worktree, "rev-parse", "--absolute-git-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  if (!gitDir) return null;
  const found = [];
  for (const marker of ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"]) {
    if (existsSync(join(gitDir, marker))) found.push(marker);
  }
  for (const marker of ["rebase-merge", "rebase-apply"]) {
    if (existsSync(join(gitDir, marker))) found.push(marker);
  }
  try {
    const unmerged = execFileSync("git", ["-C", worktree, "diff", "--name-only", "--diff-filter=U"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (unmerged !== "") found.push("unmerged paths");
  } catch {
    return null;
  }
  return found;
}

function cmdRecord(args) {
  const path = args.path || die(EXIT_USAGE, "--path is required");
  const input = requiredJson(args);

  // THE ORDERING INVARIANT, ENFORCED WHERE THE RECORD IS WRITTEN.
  //
  // This file's whole security shape is that the record PREDATES the merge: the recovery check has
  // something to compare an interrupted state against only because the record could not have been
  // derived from it. That refusal used to live solely in the shell wrapper, so writing the same
  // authorization through this library while a merge was already conflicted produced a record that
  // matched every identity predicate — because it had been copied out of the very state it was
  // supposed to authorize. The merge nobody wrote down beforehand became admissible afterwards.
  //
  // It is checked HERE, against the bound worktree's actual git state, for two reasons:
  //   - a mechanical claim belongs in the mechanism, not in one of its callers;
  //   - the caller cannot be the witness. An operation list handed in as an argument is exactly the
  //     thing an intent written after the fact would get wrong, or simply omit.
  //
  // What is NOT used, deliberately: comparing `recordedAt` against `MERGE_HEAD`'s mtime. Both are
  // agent-writable, filesystem timestamps carry a clock resolution this would turn into flakiness,
  // and a proof that rests on an editable field is not a proof. Hand-editing an agent-writable JSON
  // file remains outside what any of this guarantees, and the documentation says so.
  const worktree = typeof input.worktree === "string" ? input.worktree : "";
  if (worktree === "") die(EXIT_USAGE, "the intent must name the worktree it is about (worktree)");
  const inFlight = operationsInWorktree(worktree);
  if (inFlight === null) {
    die(
      EXIT_REFUSED,
      `could not read the git state of ${worktree}, so it cannot be shown that no merge is already ` +
        "under way. An intent is refused rather than recorded blind.",
    );
  }
  if (inFlight.length > 0) {
    die(
      EXIT_REFUSED,
      `a git operation is already under way in ${worktree} (${inFlight.join(", ")}). An intent is ` +
        "recorded BEFORE the operation it authorizes; one written now would be derived from the very " +
        "state it claims to authorize, which proves nothing. Refusing.",
    );
  }

  const existing = readIntent(path);
  if (existing.ok && args.replace !== true) {
    die(
      EXIT_REFUSED,
      `a merge intent is already recorded at ${path} (${existing.intent.expectedHeadSha} <- ` +
        `${existing.intent.expectedIncomingSha}). Recording a second one would let a stale ` +
        "authorization admit a different merge. Pass --replace only after the first one is resolved.",
    );
  }

  const intent = {
    schemaVersion: SCHEMA_VERSION,
    kind: INTENT_KIND,
    recordedAt: new Date().toISOString(),
    ...input,
  };
  const missing = REQUIRED.filter((field) => typeof intent[field] !== "string" || intent[field].trim() === "");
  if (missing.length > 0) die(EXIT_USAGE, `the intent is missing required field(s): ${missing.join(", ")}`);

  writeJsonAtomic(path, intent);
  process.stdout.write(`${path}\n`);
}

function cmdCheck(args) {
  const path = args.path || die(EXIT_USAGE, "--path is required");
  const observed = requiredJson(args);
  const asJson = "json-out" in args;

  const loaded = readIntent(path);
  if (!loaded.ok) {
    if (asJson) process.stdout.write(`${JSON.stringify({ admitted: false, reasons: [loaded.reason] }, null, 2)}\n`);
    die(loaded.code, loaded.reason);
  }
  const { failed, matched } = compareIntent(loaded.intent, observed);
  const report = {
    admitted: failed.length === 0,
    intentPath: path,
    authorization: {
      reference: loaded.intent.authorizationReference,
      scope: loaded.intent.authorizationScope,
      // Said in the output, every time, so no reader mistakes a green check for a granted one.
      verified: false,
      note: "carried, never verified — a human reads this reference; these checks only match identity",
    },
    matched,
    failed,
  };
  if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    for (const entry of matched) process.stdout.write(`  match   ${entry.predicate}  ${entry.what}\n`);
    for (const entry of failed) {
      process.stdout.write(`  FAILED  ${entry.predicate}  ${entry.what}\n`);
      process.stdout.write(`          expected ${entry.expected}\n`);
      process.stdout.write(`          actual   ${entry.actual}\n`);
    }
    process.stdout.write(`  authorization ${loaded.intent.authorizationReference} (carried, not verified)\n`);
    process.stdout.write(`  scope         ${loaded.intent.authorizationScope}\n`);
  }
  process.exit(failed.length === 0 ? EXIT_OK : EXIT_REFUSED);
}

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);

switch (subcommand) {
  case "record":
    cmdRecord(args);
    break;
  case "check":
    cmdCheck(args);
    break;
  default:
    die(EXIT_USAGE, `unknown subcommand "${subcommand ?? ""}" — expected "record" or "check"`);
}

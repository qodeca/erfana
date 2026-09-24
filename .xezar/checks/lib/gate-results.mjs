// Versioned gate-attempt records — the machine-readable half of the evidence contract.
//
// WHY THIS EXISTS. Until this file, `worktree-preflight.sh --record-gate-evidence` wrote
// `checks: [{name: "repo-gates", result: "pass"}]` into the manifest *unconditionally*. It
// never looked at whether the gates had run, let alone what they concluded: the workflow put
// the evidence step after the gates step and the ordering alone was the proof. Anything that
// reached that step — a resumed run, a hand-driven step, a gates step whose output the UI
// truncated past the summary — sealed a pass that nothing had established. That is a false
// pass, and it is the defect this contract closes.
//
// The shape of the fix: `repo-gates.sh` records what actually happened, command by command,
// with a durable log per command; sealing then *reads* that record and refuses anything that
// is missing, incomplete, failed, stale or malformed. The record is the evidence; the seal is
// only a statement about which record was accepted.
//
// WHAT A RECORD IS AND IS NOT. It is an auditable assertion made by the agent that ran the
// gates, bound to an immutable revision and to content digests of its own logs. It is NOT a
// signed proof against a malicious agent — anything with write access to `.local/xezar/` can write
// a record. CI is the separate corroboration, and it is kept in a separate, mutable list
// (`ciObservations`) precisely so a later CI result can never rewrite a sealed local one.
//
// LAYOUT, under the PRIMARY checkout (never the worktree's own `.local/xezar/`):
//
//   .local/xezar/tasks/<runId>/gates/<headSha>/<attemptId>/
//     attempt.json   the in-progress record; its presence WITHOUT result.json means the
//                    attempt was interrupted, and that is deliberately never cleaned up
//     result.json    published atomically (temp file + rename) once the attempt completes
//     logs/NN-<slug>.log   complete output of one gate, header line first
//   .local/xezar/tasks/<runId>/gates/.sequences/<n>/claim.json
//                    the reservation that OWNS sequence <n> for this run — see below
//
// Attempts are never overwritten: one directory per attempt, `sequence` strictly increasing
// across the whole run. Selection always takes the HIGHEST sequence for the scope, so a newer
// failed or interrupted attempt hides an older pass instead of the other way round.
//
// ORDER IS RESERVED, NOT READ. Reading the highest sequence and then writing the attempt is a
// race: two runs that cross that window get the same number, the sort ties, and which attempt
// wins is decided by directory read order — so a concurrent FAILING attempt could hide behind a
// passing one. A sequence is therefore claimed by creating `.sequences/<n>/`, and `mkdir` of an
// existing directory fails: exactly one process can own a number. A tie that predates this
// rule, or that anything else produces, is not resolved by guessing — it is refused.
//
// Usage:
//   node gate-results.mjs begin      --dir <attemptDir> --json '<seed>'
//   node gate-results.mjs reserve    --gates-root <dir> --head <sha> --stamp <ms> --pid <n>
//   node gate-results.mjs record     --dir <attemptDir> --json '<command>'
//   node gate-results.mjs complete   --dir <attemptDir> --json '<tail>' [--install-gate <name>]
//   node gate-results.mjs next-seq   --gates-root <dir>
//   node gate-results.mjs select     --gates-root <dir> --head <sha> [--json]
//   node gate-results.mjs seal       --manifest <path> --gates-root <dir> --json '<expected>'
//   node gate-results.mjs observe-ci --manifest <path> --json '<observation>' [--unmatched-ok]
//   node gate-results.mjs verify     --manifest <path> --repo <mainRoot> [--run-id <id>]
//                                    [--command-list-id <id>] [--deps-fingerprint <hex>]
//                                    [--install-gate <name>]
//                                    [--require-current] [--json]
//   node gate-results.mjs history    --gates-root <dir> --head <sha> [--json]
//
// DISCLOSURE HAS TWO TENSES, and they are never merged. `seal.anomalies` is a SNAPSHOT frozen
// at seal time; `history` and `verify`'s `disclosure.now` are re-derived from the preserved
// attempt directories at read time. A later gate run adds to the second and not the first, and
// that difference is ordinary history — it does not falsify a past seal. The re-derivation
// exists because the snapshot lives in `manifest.json`, which is not digest-protected and which
// normal operation rewrites, so a reader who trusts only the snapshot is trusting an editable
// list about what is on disk.
//
// Exit codes: 0 ok · 1 refused/failed · 2 usage or malformed input · 3 unavailable (the
// record may well be valid; this environment cannot decide).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/** The only record schema this build understands. An unknown version fails closed. */
export const SCHEMA_VERSION = 1;
const ATTEMPT_KIND = "xezar.gate-attempt";
const SEAL_KIND = "xezar.gate-seal";
const SECURITY_KIND = "xezar.security-result";
const SECURITY_FILE = "security.json";
/** Every value the security stage may record. `pass` is the only one that is a pass. */
const SECURITY_STATUSES = new Set(["pass", "findings", "unknown", "not-applicable"]);

/** Where a sequence number is claimed, under the run's gates root. */
const RESERVATIONS = ".sequences";
/** A wildly improbable ceiling, so a corrupt reservation tree cannot spin forever. */
const MAX_RESERVE_PROBES = 100000;

// Exactly one gate may legitimately not run, and only for one recorded reason: the gates skip
// the install when the installed tree is already verified current for its lockfiles. Every
// other not-run or skipped gate makes the attempt uncertifiable. Keeping the allowance as data
// — rather than as an `if` somewhere in the sealer — is what makes it reviewable.
//
// WHICH gate is the install is told by the CALLER — repo-gates.sh's current `GATE_NAMES[0]`, passed
// as `--install-gate` (or `installGate` in a seal's expectations) — and never read from the record
// being judged: a record that could name its own skippable gate could excuse any gate. "npm ci"
// stays accepted, so records written before the name was passed still seal.
const PERMITTED_SKIP_REASON = "deps-verified-current";
const LEGACY_INSTALL_GATE = "npm ci";
const permittedSkipNames = (installGate) =>
  new Set([LEGACY_INSTALL_GATE, ...(typeof installGate === "string" && installGate !== "" ? [installGate] : [])]);

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const EXIT_UNAVAILABLE = 3;

// --- small helpers ---------------------------------------------------------------------

function die(code, message) {
  process.stderr.write(`gate-results: ${message}\n`);
  process.exit(code);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// A path derived from a run id should be a plain file in a plain directory the run owns. A
// symlink in the last two segments would send the write — or the read — somewhere else, so it
// is refused rather than followed. `lib/common.sh` guards the run id's shape; this guards what
// is actually on disk.
function refuseSymlink(target, what) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) die(EXIT_REFUSED, `refusing to follow a symlinked ${what}: ${target}`);
}

function writeJsonAtomic(path, data) {
  refuseSymlink(dirname(path), "record directory");
  refuseSymlink(path, "record file");
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function readJsonOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The same run-id shape `lib/common.sh:valid_task_id` enforces, in the same words: one safe
 * path segment, never sanitised into one. Kept here as well because this file resolves paths
 * from ids that arrive inside a document, and a document is not a checked command line.
 */
export function validRunId(id) {
  if (typeof id !== "string" || id === "" || id === "." || id === "..") return false;
  if (/[/\\:]/.test(id)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id);
}

/**
 * Index a record's commands by gate name, and say plainly when a name appears twice.
 *
 * There used to be two answers to "what did gate X do": the completer took the FIRST entry and
 * the sealer took the LAST, so a duplicated gate whose second run failed derived a green
 * attempt that sealing then refused. One reading, one verdict: a duplicate is a defect in the
 * record, and a record with one is never satisfiable.
 */
export function indexCommands(commands) {
  const byName = new Map();
  const duplicates = [];
  for (const command of commands ?? []) {
    if (byName.has(command.name)) {
      if (!duplicates.includes(command.name)) duplicates.push(command.name);
      continue;
    }
    byName.set(command.name, command);
  }
  return { byName, duplicates };
}

/** true when `child` is `parent` itself or lies beneath it, after full resolution. */
function isInside(parent, child) {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

// `--flag` immediately followed by another `--flag` (or by nothing) is a boolean, not a flag
// whose value happens to be the next option. Consuming blindly made `--unmatched-ok --json '…'`
// swallow `--json`, which is the kind of thing that turns a refusal into a silent acceptance.
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

function requiredJson(args) {
  if (typeof args.json !== "string") die(EXIT_USAGE, "--json is required");
  try {
    return JSON.parse(args.json);
  } catch (error) {
    die(EXIT_USAGE, `--json is not valid JSON: ${error.message}`);
  }
}

// --- reading records -------------------------------------------------------------------

/**
 * Load one attempt directory. Returns a descriptor even for a broken record, because
 * "malformed" is an outcome the selector has to be able to see and refuse — silently skipping
 * it would let a corrupt newest attempt hide behind a valid older one.
 */
export function loadAttempt(dir, order) {
  const resultPath = join(dir, "result.json");
  const attemptPath = join(dir, "attempt.json");
  const complete = readJsonOrNull(resultPath);
  const partial = complete ?? readJsonOrNull(attemptPath);
  // A broken record has no sequence of its own, and until this file that made it permanently
  // un-overtakeable: it sorted to the front for ever, so a later, whole, passing attempt could
  // never supersede it and the only escape was deleting evidence or inventing a commit. The
  // order is instead recovered from OUTSIDE the corrupt bytes — from the reservation that
  // claimed the number, or failing that from the attempt directory's own name, which this
  // runner writes as `<sequence>-<stamp>-<pid>`. The bytes are never touched, the anomaly is
  // never silently dropped, and an order that cannot be recovered stays terminal on purpose.
  const recovered = order?.(dir);
  const broken = (reason) => ({
    dir,
    state: "malformed",
    reason,
    sequence: recovered?.sequence,
    orderSource: recovered?.source ?? "unknown",
  });
  if (!partial) {
    return broken("neither result.json nor attempt.json is readable JSON");
  }
  if (partial.kind !== ATTEMPT_KIND) {
    return broken(`kind is "${partial.kind}", expected "${ATTEMPT_KIND}"`);
  }
  if (partial.schemaVersion !== SCHEMA_VERSION) {
    return {
      dir,
      state: "unsupported",
      reason: `schemaVersion ${JSON.stringify(partial.schemaVersion)} is not ${SCHEMA_VERSION}`,
      record: partial,
    };
  }
  if (!Number.isInteger(partial.sequence) || partial.sequence < 1) {
    return broken("sequence is missing or not a positive integer");
  }
  if (!Array.isArray(partial.commands)) {
    return broken("commands is not an array");
  }
  return {
    dir,
    state: complete ? "complete" : "interrupted",
    record: partial,
    path: complete ? resultPath : attemptPath,
    sequence: partial.sequence,
    orderSource: "record",
  };
}

/**
 * The word for what an attempt actually says, for a human reading a refusal.
 *
 * "complete" is a *state*, not an outcome, and printing it for a completed FAILURE read as
 * reassurance in exactly the place a reader needed a warning. A completed attempt is named by
 * its result; everything else is named by what went wrong with it.
 */
export function attemptOutcome(attempt) {
  if (!attempt) return "absent";
  if (attempt.state === "complete") return attempt.record?.result === "passed" ? "passed" : String(attempt.record?.result ?? "unknown");
  if (attempt.state === "unsupported") return "an unsupported schema";
  return attempt.state;
}

/**
 * Read the run's sequence reservations: `{attemptDir → sequence}` plus the highest number ever
 * claimed. This is the authoritative order source, because it is written when the attempt
 * directory is created and never afterwards — so it survives whatever happens to the record.
 */
export function reservations(gatesRoot) {
  const byDir = new Map();
  let highest = 0;
  let entries;
  try {
    entries = readdirSync(join(gatesRoot, RESERVATIONS), { withFileTypes: true });
  } catch {
    return { byDir, highest };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const sequence = Number(entry.name);
    if (!Number.isInteger(sequence) || sequence < 1) continue;
    if (sequence > highest) highest = sequence;
    const claim = readJsonOrNull(join(gatesRoot, RESERVATIONS, entry.name, "claim.json"));
    if (claim?.attemptDir) byDir.set(resolve(claim.attemptDir), sequence);
  }
  return { byDir, highest };
}

/** The order an attempt directory can be given without reading its (possibly corrupt) record. */
function externalOrder(gatesRoot) {
  const { byDir } = reservations(gatesRoot);
  return (dir) => {
    const reserved = byDir.get(resolve(dir));
    if (reserved !== undefined) return { sequence: reserved, source: "reservation" };
    // `<sequence>-<stamp>-<pid>`, the name this runner gives every attempt directory. Weaker
    // than a reservation — a name is not a claim — so it is labelled as what it is.
    const named = /^(\d{4,})-/.exec(dir.split(sep).pop() ?? "");
    if (named) return { sequence: Number(named[1]), source: "directory-name" };
    return undefined;
  };
}

/** Every attempt under one head SHA, newest (highest sequence) first. */
export function attemptsForHead(gatesRoot, headSha, order = externalOrder(gatesRoot)) {
  const headDir = join(gatesRoot, headSha);
  let entries;
  try {
    entries = readdirSync(headDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const dir = join(headDir, entry.name);
    // A symlinked attempt directory could point at another run's evidence. Skipping it would
    // hide it, so it is surfaced as a refusal instead.
    if (entry.isSymbolicLink()) {
      const recovered = order?.(dir);
      found.push({
        dir,
        state: "malformed",
        reason: "attempt directory is a symlink",
        sequence: recovered?.sequence,
        orderSource: recovered?.source ?? "unknown",
      });
      continue;
    }
    if (!entry.isDirectory()) continue;
    found.push(loadAttempt(dir, order));
  }
  // A record whose order could not be recovered at all sorts to the front, so it can never be
  // stepped over in favour of an older readable pass. Ties are NOT broken here: `latestForHead`
  // refuses them rather than letting directory read order decide an outcome.
  return found.sort((a, b) => (b.sequence ?? Number.MAX_SAFE_INTEGER) - (a.sequence ?? Number.MAX_SAFE_INTEGER));
}

/**
 * The one attempt that speaks for this head — or a refusal.
 *
 * Two attempts that share a sequence used to be resolved by `Array.prototype.sort` stability,
 * which means by directory read order: a concurrent FAILING attempt could sit second and a
 * passing one get sealed. There is no honest way to rank a tie, so a tie is an answer of its
 * own and the caller must refuse it.
 */
export function latestForHead(gatesRoot, headSha) {
  const all = attemptsForHead(gatesRoot, headSha);
  if (all.length === 0) return { all, latest: null, tied: [] };
  const top = all[0].sequence ?? Number.MAX_SAFE_INTEGER;
  const tied = all.filter((a) => (a.sequence ?? Number.MAX_SAFE_INTEGER) === top);
  return { all, latest: tied.length === 1 ? tied[0] : null, tied };
}

/** Every sequence this run has recorded or reserved; the next free number is one past the top. */
export function highestSequence(gatesRoot) {
  let max = reservations(gatesRoot).highest;
  let heads;
  try {
    heads = readdirSync(gatesRoot, { withFileTypes: true });
  } catch {
    return max;
  }
  const order = externalOrder(gatesRoot);
  for (const head of heads) {
    if (!head.isDirectory() || head.isSymbolicLink() || head.name.startsWith(".")) continue;
    for (const attempt of attemptsForHead(gatesRoot, head.name, order)) {
      if (Number.isInteger(attempt.sequence) && attempt.sequence > max) max = attempt.sequence;
    }
  }
  return max;
}

/** One more than the highest sequence anywhere in this run, so ids never collide or reorder. */
export function nextSequence(gatesRoot) {
  return highestSequence(gatesRoot) + 1;
}

/**
 * Claim a sequence and the attempt directory that carries it, atomically.
 *
 * `mkdir` of a directory that already exists fails, and that is the whole mechanism: the first
 * process to create `.sequences/<n>` owns `n`, every other one moves on to `n+1`. Nothing is
 * overwritten and nothing is deleted, so a crashed run leaves its number claimed — which is the
 * correct outcome, because the attempt it was about may well be on disk.
 */
export function reserveSequence(gatesRoot, headSha, attemptSuffix) {
  const first = nextSequence(gatesRoot);
  let sequence = first;
  for (let probe = 0; probe < MAX_RESERVE_PROBES; probe++, sequence++) {
    const slot = join(gatesRoot, RESERVATIONS, String(sequence));
    try {
      mkdirSync(dirname(slot), { recursive: true });
      mkdirSync(slot); // not recursive: EEXIST is the signal that someone else owns this number
    } catch (error) {
      // ONLY EEXIST means "someone else owns this number, try the next one". The catch used to
      // swallow everything, so a permission error, a read-only mount or a full disk — none of
      // which any other number would have escaped either — was retried 100000 times and then
      // reported as contention. That message named the wrong cause and cost a minute of probing
      // to reach it. A non-EEXIST failure is terminal on the first one, with its real errno.
      if (error?.code === "EEXIST") continue;
      die(
        EXIT_REFUSED,
        `could not create the gate attempt reservation ${slot}: ${error?.code ?? "unknown error"} — ` +
          `${error?.message ?? String(error)}. This is not sequence contention: no other number would ` +
          "have succeeded either. Fix the permissions or the free space on the primary checkout's .local/xezar/.",
      );
    }
    const attemptId = `${String(sequence).padStart(4, "0")}-${attemptSuffix}`;
    const attemptDir = join(gatesRoot, headSha, attemptId);
    refuseSymlink(attemptDir, "attempt directory");
    mkdirSync(join(attemptDir, "logs"), { recursive: true });
    writeJsonAtomic(join(slot, "claim.json"), {
      schemaVersion: SCHEMA_VERSION,
      kind: "xezar.gate-sequence-claim",
      sequence,
      headSha,
      attemptId,
      attemptDir,
      reservedAt: new Date().toISOString(),
      pid: process.pid,
    });
    return { sequence, attemptId, attemptDir };
  }
  die(
    EXIT_REFUSED,
    `could not reserve a gate attempt sequence under ${gatesRoot}: every number from ${first} to ` +
      `${sequence - 1} is already claimed (${MAX_RESERVE_PROBES} probes). This IS contention — the ` +
      "reservations are on disk under .sequences/ and can be read.",
  );
}

// --- judging a record ------------------------------------------------------------------

/** Did one recorded command satisfy its gate? A broken log disqualifies a zero exit status. */
export function commandSatisfied(command, installGate) {
  if (command.logOk !== true) return false;
  if (command.status === "passed") return true;
  if (command.status === "skipped") {
    return command.skipReason === PERMITTED_SKIP_REASON && permittedSkipNames(installGate).has(command.name);
  }
  return false;
}

/**
 * Every reason this attempt cannot certify anything, as a list. An empty list means the
 * record itself is sound; it says nothing yet about whether it matches the current checkout.
 */
export function attemptFailures(record, installGate) {
  const problems = [];
  if (record.complete !== true) problems.push("the attempt never completed (interrupted)");
  if (record.loggingOk !== true) problems.push("logging failed during the attempt, so the outcomes are not evidenced");
  if (record.result !== "passed") problems.push(`the recorded result is "${record.result}", not "passed"`);

  const { byName, duplicates } = indexCommands(record.commands);
  for (const name of duplicates) {
    problems.push(`gate "${name}" has more than one recorded outcome, so the record has no single answer for it`);
  }
  for (const name of record.required ?? []) {
    const command = byName.get(name);
    if (!command) {
      problems.push(`required gate "${name}" has no recorded outcome`);
      continue;
    }
    if (!commandSatisfied(command, installGate)) {
      problems.push(
        `required gate "${name}" is ${command.status}${command.logOk === true ? "" : " with a broken log"}`,
      );
    }
  }
  return problems;
}

/**
 * PROVENANCE. Why an attempt's recorded producer forbids SEALING it, or null (#676 PR 2).
 *
 * An attempt records WHO ran the gates: the workflow's own `gates` step declares itself with
 * `--producer gates`, and every other invocation is the author's. An author's attempt never
 * certifies the tree — it is the same tree proved to itself — and the workflow's gates step is
 * the run's canonical run.
 *
 * ABSENCE AND A POPULATED WRONG VALUE ARE DIFFERENT BRANCHES, never the same one. A record with
 * NO `producer` field at all was written before this contract existed: it is a legacy record and
 * it still seals, so an in-flight run and every attempt already on disk are not stranded.
 * `author` is a declaration and is refused. Collapsing the two — in either direction — is
 * exactly the fail-open AGENTS.md's "a fail-open helper needs a populated-input guarantee"
 * warns about, and the two branches are pinned separately.
 */
export function producerRefusal(record) {
  if (record?.producer === "author") {
    return (
      'the recorded producer is "author": the author\'s own gate run never certifies the tree. ' +
      "The workflow's gates step is the canonical run and declares itself with `--producer gates`; " +
      "re-run it as `.xezar/checks/repo-gates.sh --fast --producer gates`."
    );
  }
  return null;
}

/**
 * The security stage's own structured result, read from the attempt it belongs to.
 *
 * Returned as `{ ok, reason, result }` rather than thrown, because every refusal here has to be
 * printable next to the others. The ONE thing this never does is treat an absent or unreadable
 * file as "nothing to report": against a missing input, "the scan found nothing" and "no scan
 * happened" are the same silence, and only one of them is a pass.
 */
export function readSecurityResult(attemptDir, expectedHead) {
  const path = join(attemptDir, SECURITY_FILE);
  let record;
  try {
    refuseSymlink(path, "security result");
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      ok: false,
      reason:
        `the attempt carries no readable security result at ${path} (${error?.code ?? error?.message ?? error}). ` +
        "The security stage runs inside the gates and writes it; an attempt without one never resolved security, " +
        "and an unresolved security stage cannot precede a quality verdict. Re-run .xezar/checks/repo-gates.sh.",
    };
  }
  if (record?.kind !== SECURITY_KIND) return { ok: false, reason: `${path} is not a ${SECURITY_KIND} record` };
  if (record?.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: `${path} uses unsupported security schema version ${record?.schemaVersion}` };
  }
  if (!SECURITY_STATUSES.has(record.status)) {
    return { ok: false, reason: `${path} records status "${record.status}", which is not one of ${[...SECURITY_STATUSES].join(", ")}` };
  }
  if (record.refused === true) {
    return { ok: false, reason: `the security stage refused this candidate: ${record.refusedReason ?? "no reason recorded"}` };
  }
  if (expectedHead && record.head !== expectedHead) {
    return {
      ok: false,
      reason: `the security result is about ${record.head}, not the attempt's head ${expectedHead} — it belongs to a different candidate`,
    };
  }
  return { ok: true, result: record };
}

// --- subcommands -----------------------------------------------------------------------

function cmdBegin(args) {
  const dir = args.dir || die(EXIT_USAGE, "--dir is required");
  const seed = requiredJson(args);
  const record = {
    schemaVersion: SCHEMA_VERSION,
    kind: ATTEMPT_KIND,
    ...seed,
    commands: [],
    complete: false,
    loggingOk: true,
    result: "incomplete",
  };
  refuseSymlink(dir, "attempt directory");
  mkdirSync(join(dir, "logs"), { recursive: true });
  writeJsonAtomic(join(dir, "attempt.json"), record);
}

function cmdRecord(args) {
  const dir = args.dir || die(EXIT_USAGE, "--dir is required");
  const entry = requiredJson(args);
  const path = join(dir, "attempt.json");
  const record = readJsonOrNull(path);
  if (!record) die(EXIT_REFUSED, `no in-progress attempt at ${path}`);

  // The log is hashed HERE, from the bytes on disk, so the digest in the record is a statement
  // about a file that was actually readable at the moment the gate finished. A log that could
  // not be written, was truncated away or was removed by the gate itself lands as logOk:false
  // — and one false is enough to make the whole attempt uncertifiable, even if every command
  // exited zero.
  // A skipped gate ran nothing, so it has nothing to log and that is not a logging failure.
  // Every other outcome without a readable log IS one.
  let logOk = !entry.log && entry.status === "skipped";
  let logSha256 = null;
  let logBytes = null;
  if (entry.log) {
    const logPath = join(dir, "logs", entry.log);
    try {
      refuseSymlink(logPath, "gate log");
      const bytes = readFileSync(logPath);
      logBytes = bytes.length;
      logSha256 = sha256(bytes);
      logOk = bytes.subarray(0, entry.logHeader.length).toString("utf8") === entry.logHeader;
    } catch {
      logOk = false;
    }
  }
  record.commands.push({ ...entry, logOk, logSha256, logBytes });
  if (!logOk) record.loggingOk = false;
  writeJsonAtomic(path, record);
}

function cmdComplete(args) {
  const dir = args.dir || die(EXIT_USAGE, "--dir is required");
  const tail = requiredJson(args);
  const path = join(dir, "attempt.json");
  const record = readJsonOrNull(path);
  if (!record) die(EXIT_REFUSED, `no in-progress attempt at ${path}`);

  Object.assign(record, tail);
  record.complete = true;
  // The result is DERIVED, never taken from the caller. A runner that miscounted its own
  // failures cannot talk this file into "passed".
  //
  // It is derived through the SAME index the sealer uses. Reading the first entry here and the
  // last one there meant a duplicated gate whose second run failed printed "passed" to the
  // runner and was then refused by sealing — a green run whose evidence the next step throws
  // out. One reading: a duplicate is a defect in the record and cannot be satisfied.
  const { byName, duplicates } = indexCommands(record.commands);
  const unsatisfied = (record.required ?? []).filter((name) => {
    const command = byName.get(name);
    return !command || duplicates.includes(name) || !commandSatisfied(command, args["install-gate"]);
  });
  record.result = unsatisfied.length === 0 && duplicates.length === 0 && record.loggingOk === true ? "passed" : "failed";
  record.unsatisfied = unsatisfied;
  if (duplicates.length > 0) record.duplicateCommands = duplicates;

  // Published under its final name only once it is whole, by rename. A cancelled run therefore
  // leaves attempt.json and no result.json — visibly interrupted, never mistaken for a pass.
  writeJsonAtomic(join(dir, "result.json"), record);
  process.stdout.write(`${record.result}\n`);
}

function cmdNextSeq(args) {
  const gatesRoot = args["gates-root"] || die(EXIT_USAGE, "--gates-root is required");
  process.stdout.write(`${nextSequence(gatesRoot)}\n`);
}

function cmdReserve(args) {
  const gatesRoot = args["gates-root"] || die(EXIT_USAGE, "--gates-root is required");
  const head = args.head || die(EXIT_USAGE, "--head is required");
  if (!/^[0-9a-f]+$/.test(head)) die(EXIT_USAGE, `--head "${head}" is not a plain SHA`);
  const suffix = `${args.stamp || Date.now()}-${args.pid || process.pid}`;
  const claim = reserveSequence(gatesRoot, head, suffix);
  process.stdout.write(`${JSON.stringify(claim)}\n`);
}

function cmdSelect(args) {
  const gatesRoot = args["gates-root"] || die(EXIT_USAGE, "--gates-root is required");
  const head = args.head || die(EXIT_USAGE, "--head is required");
  const { all, latest, tied } = latestForHead(gatesRoot, head);
  if (all.length === 0) die(EXIT_REFUSED, `no gate attempt recorded for ${head}`);
  if (!latest) {
    process.stderr.write(`gate-results: ${tied.length} attempts for ${head} share sequence ${tied[0].sequence ?? "<unknown>"}:\n`);
    for (const attempt of tied) process.stderr.write(`  - ${attempt.dir} (${attemptOutcome(attempt)})\n`);
    die(EXIT_REFUSED, "a tie cannot be ranked, and directory order is not a ranking. Refusing to choose one.");
  }
  if ("json" in args) process.stdout.write(`${JSON.stringify(latest)}\n`);
  else process.stdout.write(`${latest.dir}\n`);
  if (latest.state !== "complete") die(EXIT_REFUSED, `the newest attempt for ${head} is ${latest.state}: ${latest.reason ?? latest.dir}`);
}

/** One attempt, reduced to the fields a disclosure list needs. */
function anomalyEntry(attempt) {
  return {
    attemptDir: attempt.dir,
    state: attempt.state,
    outcome: attemptOutcome(attempt),
    sequence: attempt.sequence ?? null,
    orderSource: attempt.orderSource ?? "unknown",
    reason: attempt.reason ?? null,
  };
}

/**
 * Did this attempt fail to certify anything — for any reason, including having completed
 * cleanly with a failing result?
 *
 * The distinction matters because `state` answers a different question. A gate run that
 * finished and FAILED is `state: "complete"`, so a filter on `state !== "complete"` dropped the
 * single most important thing not to forget: a real failing gate run at the sealed head. The
 * bytes were always on disk, but the manifest a handoff quotes showed only passes.
 */
function attemptIsNotAPass(attempt) {
  if (attempt.state !== "complete") return true;
  return attempt.record?.result !== "passed";
}

/**
 * Every attempt for this head that is not the sealed one and does not itself pass, as the
 * anomaly list the seal keeps.
 *
 * This is a SNAPSHOT, taken at seal time and frozen. Attempts recorded later are not in it and
 * their absence falsifies nothing — see `currentDisclosure`, which re-derives the same list
 * from disk at read time and reports the two side by side.
 */
function anomaliesAround(all, chosen) {
  return all.filter((a) => a.dir !== chosen.dir && attemptIsNotAPass(a)).map(anomalyEntry);
}

/**
 * Every head this run recorded an attempt at, and what those attempts say — derived from disk.
 *
 * Reachable WITHOUT already knowing a head, which is the whole point: an auditor asking about a run
 * should not have to guess which commit a failure happened at in order to be told about it.
 *
 * `complete` is honest about its own reach. If the gates root cannot be listed, the counts describe
 * only what was read and `complete` is false — a partial scan never becomes an "all history" claim.
 */
function runHistory(gatesRoot, sealedHead) {
  let heads;
  try {
    heads = readdirSync(gatesRoot, { withFileTypes: true });
  } catch (error) {
    return {
      complete: false,
      unavailableReason: `the gate evidence root could not be listed: ${error?.code ?? error}`,
      heads: bounded([]),
      totals: null,
    };
  }
  const rows = [];
  let passed = 0;
  let notPassing = 0;
  let scanned = 0;
  let partial = false;
  for (const head of heads) {
    if (!head.isDirectory() || head.isSymbolicLink() || head.name.startsWith(".")) continue;
    let attempts;
    try {
      attempts = attemptsForHead(gatesRoot, head.name);
    } catch {
      partial = true;
      continue;
    }
    scanned += attempts.length;
    const outcomes = attempts.map((a) => attemptOutcome(a));
    for (const attempt of attempts) {
      if (attempt.state === "complete" && attempt.record?.result === "passed") passed++;
      else notPassing++;
    }
    rows.push({
      headSha: head.name,
      isSealedHead: head.name === sealedHead,
      attempts: attempts.length,
      outcomes,
    });
  }
  rows.sort((a, b) => Number(b.isSealedHead) - Number(a.isSealedHead) || a.headSha.localeCompare(b.headSha));
  return {
    complete: !partial,
    ...(partial ? { unavailableReason: "one or more head directories could not be read" } : {}),
    heads: bounded(rows),
    totals: { heads: rows.length, attempts: scanned, passed, notPassing },
  };
}

/** How many entries a disclosure list prints before it says how many more there are. */
const DISCLOSURE_LIMIT = 20;

/** A bounded list plus an honest count of what was left out. Never a count a human must make. */
function bounded(entries) {
  return {
    total: entries.length,
    shown: entries.slice(0, DISCLOSURE_LIMIT),
    omitted: Math.max(0, entries.length - DISCLOSURE_LIMIT),
  };
}

/**
 * Accept the newest attempt for this head as the run's evidence, or refuse with every reason.
 *
 * The seal carries local command results, execution identity and log digests, and nothing
 * else. No CI field belongs in it: a CI observation arrives later, is mutable, and must never
 * be able to change what was sealed.
 */
function cmdSeal(args) {
  const manifestPath = args.manifest || die(EXIT_USAGE, "--manifest is required");
  const gatesRoot = args["gates-root"] || die(EXIT_USAGE, "--gates-root is required");
  const expected = requiredJson(args);

  const { all: attempts, latest, tied } = latestForHead(gatesRoot, expected.headSha);
  if (attempts.length === 0) {
    die(
      EXIT_REFUSED,
      `no gate attempt recorded for ${expected.headSha}. Run .xezar/checks/repo-gates.sh — ` +
        "the evidence step seals what the gates recorded, it does not assert a pass.",
    );
  }
  const refusals = [];
  let securityResult = null;
  if (!latest) {
    for (const attempt of tied) refusals.push(`tied at sequence ${attempt.sequence ?? "<unknown>"}: ${attempt.dir} (${attemptOutcome(attempt)})`);
    refusals.push(
      "two or more attempts for this head claim the same order, so there is no newest attempt to seal. " +
        "Re-running the gates reserves a strictly higher sequence and resolves it; the tied records stay on disk.",
    );
  } else if (latest.state === "unsupported") refusals.push(`the newest attempt uses an unsupported schema: ${latest.reason}`);
  else if (latest.state === "malformed") {
    refusals.push(`the newest attempt is malformed: ${latest.reason}`);
    refusals.push(
      latest.orderSource === "unknown"
        ? `its order cannot be recovered from a reservation or from its directory name (${latest.dir}), so no later attempt ` +
          "can supersede it. Re-running the gates will NOT clear this. The supported next action is to leave the bytes " +
          "in place and have a human decide: audit with .xezar/checks/verify-evidence.sh, then certify at a different " +
          "head, or record the anomaly and hand off without a seal."
        : `its order is known (sequence ${latest.sequence}, from the ${latest.orderSource}), so re-running the gates ` +
          "records a strictly higher attempt that supersedes it. The malformed record stays on disk and is carried in " +
          "the next seal as an anomaly.",
    );
  } else if (latest.state === "interrupted") {
    refusals.push(
      `the newest attempt (sequence ${latest.sequence}) never completed. An older passing attempt ` +
        "cannot be used in its place — re-run the gates.",
    );
  }

  const record = latest?.record;
  if (refusals.length === 0) {
    refusals.push(...attemptFailures(record, expected.installGate));
    const provenance = producerRefusal(record);
    if (provenance) refusals.push(provenance);

    // Identity: the attempt must be about exactly this revision, this branch and this list of
    // gates. Anything else is a stale result wearing the right head SHA.
    const sameIdentity = [
      ["headSha", expected.headSha, record.headSha],
      ["treeSha", expected.treeSha, record.treeSha],
      ["branch", expected.branch, record.branch],
      ["commandListId", expected.commandListId, record.commandListId],
    ];
    for (const [field, want, got] of sameIdentity) {
      if (want !== got) refusals.push(`${field} changed since the attempt (recorded ${got}, now ${want})`);
    }

    // Inputs: the checkout the gates finished on must still be the checkout in front of us,
    // and the gates must not have moved it while they ran.
    if (record.before?.treeFingerprint !== record.after?.treeFingerprint) {
      refusals.push(
        "the working tree changed while the gates ran, so the earlier gates judged a different tree " +
          `(before ${record.before?.treeFingerprint}, after ${record.after?.treeFingerprint})`,
      );
    }
    if (record.after?.treeFingerprint !== expected.treeFingerprint) {
      refusals.push(
        `the checkout changed after the gate run (recorded ${record.after?.treeFingerprint}, now ${expected.treeFingerprint})`,
      );
    }
    if (record.after?.depsFingerprint !== expected.depsFingerprint) {
      refusals.push("the installed dependencies changed after the gate run");
    }
    // Final certification is about a committed revision. Uncommitted work is not in the branch,
    // so it is not in the pull request, so it is not what anyone will review or merge.
    if (expected.dirty === true) {
      refusals.push("the task tree has uncommitted changes — commit them and re-run the gates before sealing");
    }

    // SECURITY IS RESOLVED BEFORE ANY QUALITY VERDICT, and the seal is where that stops being a
    // sentence. `securityGate` is the gate's name in the CURRENT canonical list, passed by the
    // caller — not read from the record, because a record that under-reports its own required
    // list would then decide whether it has to carry a security result.
    if (expected.securityGate) {
      if (!(record.required ?? []).includes(expected.securityGate)) {
        refusals.push(
          `the canonical list requires the security stage "${expected.securityGate}", and this attempt does not ` +
            "list it as required. It was recorded against a different list of gates — re-run .xezar/checks/repo-gates.sh.",
        );
      } else {
        const security = readSecurityResult(latest.dir, record.headSha);
        if (!security.ok) refusals.push(security.reason);
        else securityResult = security.result;
      }
    }
  }

  if (refusals.length > 0) {
    process.stderr.write("gate-results: refusing to seal this evidence:\n");
    for (const r of refusals) process.stderr.write(`  - ${r}\n`);
    process.exit(EXIT_REFUSED);
  }

  const resultPath = join(latest.dir, "result.json");
  const resultSha256 = sha256(readFileSync(resultPath));
  const logDigests = {};
  for (const command of record.commands) if (command.log) logDigests[command.log] = command.logSha256;

  const manifest = readJsonOrNull(manifestPath) ?? {};
  manifest.gateEvidence = {
    schemaVersion: SCHEMA_VERSION,
    kind: SEAL_KIND,
    sealedAt: new Date().toISOString(),
    runId: record.runId,
    attemptId: record.attemptId,
    sequence: record.sequence,
    attemptDir: latest.dir,
    resultPath,
    resultSha256,
    logDigests,
    headSha: record.headSha,
    treeSha: record.treeSha,
    branch: record.branch,
    baseRef: record.baseRef,
    baseSha: record.baseSha,
    commandListId: record.commandListId,
    required: record.required,
    fingerprint: record.after?.treeFingerprint,
    depsFingerprint: record.after?.depsFingerprint,
    repo: record.repo,
    // The security stage's own verdict, carried in the seal so a reviewer reads a recorded fact
    // rather than the author's summary of one. `unknown` is carried as `unknown` — it is never
    // rewritten to a pass, and `reviewerRequired` says when automation could not settle it.
    security: securityResult
      ? {
          status: securityResult.status,
          decision: securityResult.decision,
          decisionReason: securityResult.decisionReason,
          reviewerRequired: securityResult.reviewerRequired === true,
          inventory: securityResult.inventory,
          checks: (securityResult.checks ?? []).map((c) => ({ name: c.name, status: c.status })),
          digest: securityResult.digest,
          resultPath: join(latest.dir, SECURITY_FILE),
        }
      : null,
    // Every other attempt for this head that does not itself pass — malformed, interrupted, or
    // COMPLETED AND FAILED — carried forward by name. Superseding an attempt must not mean
    // forgetting it: the bytes stay on disk and the seal says out loud that they are there.
    // This is a snapshot of what was on disk at seal time; `verify` re-derives the same list
    // from disk and reports both, because later attempts legitimately add to the history.
    anomalies: anomaliesAround(attempts, latest),
  };
  // Finalization is also where the manifest's own identity stops being whatever `setup` saw.
  // `setup` runs before the first commit, so its headSha is stale for the whole rest of the
  // run; leaving it that way made the manifest disagree with its own sealed evidence.
  manifest.runId = record.runId;
  manifest.headSha = record.headSha;
  manifest.branch = record.branch;
  manifest.baseSha = record.baseSha ?? manifest.baseSha;
  manifest.treeSha = record.treeSha;
  // The ledger a handoff quotes. It used to be appended ONLY with the attempt being sealed, so a
  // real failing gate run at this very head appeared nowhere in it and the document read as an
  // unbroken row of passes. Every attempt for this head goes in — the sealed one and each
  // superseded one, by its own recorded outcome — and the append is keyed by attemptId so
  // re-sealing does not duplicate a row.
  if (!Array.isArray(manifest.gateAttempts)) manifest.gateAttempts = [];
  const known = new Set(manifest.gateAttempts.map((a) => a?.attemptId).filter(Boolean));
  const ledgerRows = [
    {
      attemptId: record.attemptId,
      sequence: record.sequence,
      headSha: record.headSha,
      result: record.result,
      at: record.endedAt,
      resultPath,
      sealed: true,
    },
    ...attempts
      .filter((a) => a.dir !== latest.dir)
      .map((a) => ({
        attemptId: a.record?.attemptId ?? null,
        sequence: a.sequence ?? null,
        headSha: expected.headSha,
        result: attemptOutcome(a),
        at: a.record?.endedAt ?? null,
        resultPath: a.path ?? a.dir,
        sealed: false,
      })),
  ];
  for (const row of ledgerRows) {
    if (row.attemptId && known.has(row.attemptId)) continue;
    if (row.attemptId) known.add(row.attemptId);
    manifest.gateAttempts.push(row);
  }
  manifest.updatedAt = new Date().toISOString();
  if (!manifest.createdAt) manifest.createdAt = manifest.updatedAt;
  writeJsonAtomic(manifestPath, manifest);
  process.stdout.write(`${resultSha256}\n`);
}

/**
 * Append a CI observation. Separate list, separate lifetime: CI is a moving target (pending
 * becomes success, a re-run changes a conclusion) and the sealed local record must be able to
 * outlive all of it unchanged. This subcommand cannot write `gateEvidence` even by accident —
 * it only ever pushes onto `ciObservations`.
 */
function cmdObserveCi(args) {
  const manifestPath = args.manifest || die(EXIT_USAGE, "--manifest is required");
  const observation = requiredJson(args);
  const manifest = readJsonOrNull(manifestPath);
  if (!manifest) die(EXIT_REFUSED, `no readable manifest at ${manifestPath}`);
  const seal = manifest.gateEvidence;

  // Which revision did CI actually test, and is it the one that was sealed? An observation
  // used to be stored exactly as handed over, so a green run for a DIFFERENT commit sat in the
  // list looking like this seal's corroboration, and the next agent quoting the list presented
  // another revision's CI as this one's. The answer is recorded, never assumed — and the three
  // legitimately different things CI can test are kept apart rather than flattened into one.
  const testedSha = observation.testedSha ?? observation.sha ?? null;
  const testedRef = observation.testedRef ?? observation.ref ?? null;
  let binding = "no-seal";
  if (seal?.headSha) {
    if (!testedSha) binding = "unbound";
    else if (testedSha === seal.headSha) binding = "exact-head";
    else binding = "other-revision"; // a PR merge ref, a later commit, or simply the wrong run
  }
  const matchesSeal = binding === "exact-head";
  if (!matchesSeal && !("unmatched-ok" in args)) {
    die(
      EXIT_REFUSED,
      `this CI observation is ${binding}: it reports ${testedSha ?? "<no tested sha>"}${testedRef ? ` on ${testedRef}` : ""}, ` +
        `and the seal names ${seal?.headSha ?? "<nothing>"}. A result for another revision is not this seal's ` +
        "corroboration. Record it with --unmatched-ok if you mean to keep it as a related observation.",
    );
  }

  if (!Array.isArray(manifest.ciObservations)) manifest.ciObservations = [];
  manifest.ciObservations.push({
    observedAt: new Date().toISOString(),
    attemptId: seal?.attemptId ?? null,
    ...observation,
    testedSha,
    testedRef,
    sealHeadSha: seal?.headSha ?? null,
    sealBinding: binding,
    matchesSeal,
  });
  manifest.updatedAt = new Date().toISOString();
  writeJsonAtomic(manifestPath, manifest);
}

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * Read-only verification of another run's sealed evidence.
 *
 * Two independent questions, deliberately reported apart:
 *   historicalValidity — was this a real, complete, passing gate run at the revision it names?
 *                        Answerable from the record, its digests and the Git objects alone.
 *   reusableHere       — may THIS environment lean on it instead of re-running the gates?
 *                        A different command list or a different dependency tree makes the
 *                        answer no without making the history any less true.
 *
 * It changes nothing: no checkout, no install, no write anywhere. Missing Git objects make the
 * answer "unavailable" — never a pass.
 *
 * A third question, asked only when a caller says it needs a CURRENT pass (`--require-current`):
 *   currentEligibility  May this seal certify the work being handed off RIGHT NOW?
 *                       A newer failed, interrupted or malformed attempt for the same head, a
 *                       tie, a seal that is no longer the newest word, or an input this
 *                       environment could not even measure all make the answer no — WITHOUT
 *                       making the sealed history any less true. Historical validity is about
 *                       the past and never changes; eligibility is about this moment.
 */
function cmdVerify(args) {
  const manifestPath = args.manifest || die(EXIT_USAGE, "--manifest is required");
  const repo = args.repo || die(EXIT_USAGE, "--repo is required");
  const requireCurrent = "require-current" in args;
  const report = {
    manifest: manifestPath,
    historicalValidity: "FAILED",
    reasons: [],
    reusableHere: null,
    notes: [],
    currentEligibility: requireCurrent ? "INELIGIBLE" : null,
    eligibilityReasons: [],
  };

  const emit = (code) => {
    if ("json" in args) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`evidence for run ${report.runId ?? "<unknown>"}\n`);
      process.stdout.write(`  historical validity  ${report.historicalValidity}\n`);
      for (const reason of report.reasons) process.stdout.write(`    - ${reason}\n`);
      process.stdout.write(`  reusable here        ${report.reusableHere ?? "n/a"}\n`);
      for (const note of report.notes) process.stdout.write(`    - ${note}\n`);
      if (report.disclosure) {
        process.stdout.write(`  at the sealed head   ${report.disclosure.now.total} not passing (now), ${report.disclosure.atSeal.total} at seal time\n`);
        for (const entry of report.disclosure.now.shown) {
          process.stdout.write(`    - seq ${entry.sequence ?? "<unknown>"} ${entry.outcome} ${entry.attemptDir}\n`);
        }
        if (report.disclosure.now.omitted > 0) process.stdout.write(`    - … ${report.disclosure.now.omitted} more (use --json)\n`);
      }
      if (report.runHistory) {
        const t = report.runHistory.totals;
        // Printed unconditionally, and scoped by its own wording. The head-scoped line above used
        // to be the ONLY count an auditor saw, and it read as a statement about the whole run.
        process.stdout.write(
          t
            ? `  across the whole run ${t.attempts} attempt(s) at ${t.heads} head(s): ${t.passed} passed, ${t.notPassing} not passing\n`
            : "  across the whole run UNAVAILABLE\n",
        );
        if (!report.runHistory.complete) {
          process.stdout.write(`    - PARTIAL SCAN: ${report.runHistory.unavailableReason} — this is not a full history\n`);
        }
        for (const row of report.runHistory.heads.shown) {
          process.stdout.write(
            `    - ${row.headSha}${row.isSealedHead ? " (sealed)" : ""}: ${row.outcomes.join(", ")}\n`,
          );
        }
        if (report.runHistory.heads.omitted > 0) {
          process.stdout.write(`    - … ${report.runHistory.heads.omitted} more head(s) (use --json)\n`);
        }
        process.stdout.write("    a not-passing attempt at an earlier head is history; it does not invalidate a later valid pass\n");
      }
      if (report.currentEligibility !== null) {
        process.stdout.write(`  currently eligible   ${report.currentEligibility}\n`);
        for (const reason of report.eligibilityReasons) process.stdout.write(`    - ${reason}\n`);
      }
    }
    process.exit(code);
  };

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    report.reasons.push(`the manifest is not readable JSON: ${error.message}`);
    emit(EXIT_REFUSED);
  }
  report.runId = manifest.runId ?? null;

  const seal = manifest.gateEvidence;
  if (!seal) {
    report.historicalValidity = "NONE";
    report.reasons.push("this run has no sealed gate evidence");
    emit(EXIT_UNAVAILABLE);
  }
  // Evidence written before this contract existed carries no schema and no digests. It stays
  // readable as history and is never converted into a verified result by inference.
  if (seal.schemaVersion === undefined) {
    report.historicalValidity = "LEGACY";
    report.reasons.push("pre-contract evidence: no schema, no attempt record, no log digests — historical only");
    emit(EXIT_UNAVAILABLE);
  }
  if (seal.schemaVersion !== SCHEMA_VERSION || seal.kind !== SEAL_KIND) {
    report.reasons.push(`unsupported seal (schemaVersion ${JSON.stringify(seal.schemaVersion)}, kind ${JSON.stringify(seal.kind)})`);
    emit(EXIT_REFUSED);
  }

  // Path safety before any read, and the fence is NOT derived from the document being audited.
  //
  // It used to be: `resolve(repo, ".local/xezar-tasks", seal.runId, "gates")`. `seal.runId`
  // comes out of the same manifest as `seal.resultPath`, and `resolve` collapses `..`, so a
  // runId of `../../../elsewhere` moved the fence to wherever the caller wanted and the fence
  // then trivially contained the target. The root is instead the manifest's OWN location,
  // resolved independently, and every run identity in play must agree with it: the requested
  // id, the manifest's id, the directory it sits in, and the id inside the seal.
  const runDir = resolve(dirname(manifestPath));
  const runIdFromPath = runDir.split(sep).pop() ?? "";
  const identities = [
    ["the directory the manifest sits in", runIdFromPath],
    ["the manifest's own runId", manifest.runId],
    ["the sealed runId", seal.runId],
  ];
  if (typeof args["run-id"] === "string" && args["run-id"] !== "") identities.push(["the requested run id", args["run-id"]]);
  for (const [what, id] of identities) {
    if (!validRunId(id)) report.reasons.push(`${what} (${JSON.stringify(id ?? null)}) is not a valid run id — one safe path segment, never sanitised into one`);
    else if (id !== runIdFromPath) report.reasons.push(`${what} is "${id}", but this evidence lives under "${runIdFromPath}"`);
  }
  // And the independently resolved canonical location has to be where the manifest actually is,
  // so a manifest smuggled in from elsewhere cannot borrow a valid-looking run id.
  //
  // There are TWO canonical roots while the `.local/xezar-tasks` → `.local/xezar/tasks` rename
  // window lasts, and the fence accepts EITHER — never "anywhere". Old evidence is frozen where it
  // lies (a seal stores absolute paths, so moving it would break every historical seal) and new
  // evidence is written to the new root, so a seal has to verify at whichever of the two it was
  // written under.
  const canonicalRoots = [resolve(repo, ".local/xezar/tasks"), resolve(repo, ".local/xezar-tasks")];
  if (!canonicalRoots.some((root) => runDir === resolve(root, runIdFromPath))) {
    report.reasons.push(`the manifest is not at this repository's canonical evidence path for run "${runIdFromPath}" (${runDir})`);
  }
  if (report.reasons.length > 0) emit(EXIT_REFUSED);

  const evidenceRoot = join(runDir, "gates");
  if (!isInside(evidenceRoot, seal.resultPath ?? "")) {
    report.reasons.push(
      `the sealed result path is outside this run's evidence root: ${seal.resultPath} is not under ${evidenceRoot}. ` +
        "Either the seal points somewhere it should not, or the primary checkout moved since it was written — " +
        "neither is something this check may resolve by guessing.",
    );
    emit(EXIT_REFUSED);
  }
  refuseSymlink(seal.resultPath, "sealed result file");

  let bytes;
  try {
    bytes = readFileSync(seal.resultPath);
  } catch {
    report.reasons.push(`the sealed result file is gone: ${seal.resultPath}`);
    emit(EXIT_REFUSED);
  }
  if (sha256(bytes) !== seal.resultSha256) {
    report.reasons.push("the result record does not match its sealed digest — it was changed after sealing");
    emit(EXIT_REFUSED);
  }

  const attempt = loadAttempt(dirname(seal.resultPath));
  if (attempt.state !== "complete") {
    report.reasons.push(`the sealed attempt is ${attempt.state}: ${attempt.reason ?? ""}`);
    emit(EXIT_REFUSED);
  }
  const record = attempt.record;
  report.reasons.push(...attemptFailures(record, args["install-gate"]));

  // THE SEAL MUST SAY WHAT THE RECORD SAYS.
  //
  // Only `result.json` is digest-protected. The seal lives in `manifest.json`, which is not,
  // and which normal operation rewrites (sealing, CI observations, `manifest.mjs --set-json`).
  // Every identity field in the seal is COPIED from the record at seal time, so equality is an
  // invariant — and until it was asserted, two self-consistent lies passed: point the seal's
  // headSha and treeSha at a different REAL commit in the same repository and the tree check
  // agreed with itself while the record underneath named another revision entirely.
  const bound = [
    ["runId", seal.runId, record.runId],
    ["attemptId", seal.attemptId, record.attemptId],
    ["sequence", seal.sequence, record.sequence],
    ["headSha", seal.headSha, record.headSha],
    ["treeSha", seal.treeSha, record.treeSha],
    ["branch", seal.branch, record.branch],
    ["baseRef", seal.baseRef, record.baseRef],
    ["baseSha", seal.baseSha, record.baseSha],
    ["commandListId", seal.commandListId, record.commandListId],
    ["fingerprint", seal.fingerprint, record.after?.treeFingerprint],
    ["depsFingerprint", seal.depsFingerprint, record.after?.depsFingerprint],
    ["required", JSON.stringify(seal.required ?? null), JSON.stringify(record.required ?? null)],
    ["repo", JSON.stringify(seal.repo ?? null), JSON.stringify(record.repo ?? null)],
  ];
  for (const [field, sealed, recorded] of bound) {
    if (sealed !== recorded) {
      report.reasons.push(`the seal says ${field} ${JSON.stringify(sealed ?? null)}, the digest-protected record says ${JSON.stringify(recorded ?? null)}`);
    }
  }
  // The seal names its own attempt directory too, and it must be the one it is reading.
  if (resolve(dirname(seal.resultPath)) !== resolve(seal.attemptDir ?? "")) {
    report.reasons.push(`the seal's attemptDir (${seal.attemptDir}) is not the directory holding the result it names`);
  }

  for (const [name, digest] of Object.entries(seal.logDigests ?? {})) {
    const logPath = join(dirname(seal.resultPath), "logs", name);
    try {
      refuseSymlink(logPath, "gate log");
      if (sha256(readFileSync(logPath)) !== digest) report.reasons.push(`log "${name}" no longer matches its sealed digest`);
    } catch {
      report.reasons.push(`log "${name}" is missing or unreadable`);
    }
  }

  // The Git side. The branch survives a worktree reclaim, so the commit is normally still here
  // — but a clone that never had it cannot judge the evidence, and saying so is the honest
  // answer. "Unavailable" is not "pass".
  let objectsPresent = true;
  try {
    git(repo, "cat-file", "-e", `${seal.headSha}^{commit}`);
    const tree = git(repo, "rev-parse", `${seal.headSha}^{tree}`);
    if (tree !== seal.treeSha) report.reasons.push(`commit ${seal.headSha} has tree ${tree}, the seal names ${seal.treeSha}`);
  } catch {
    objectsPresent = false;
  }

  if (report.reasons.length > 0) emit(EXIT_REFUSED);
  if (!objectsPresent) {
    report.historicalValidity = "UNAVAILABLE";
    report.reasons.push(`commit ${seal.headSha} is not in this repository, so its tree cannot be checked here`);
    emit(EXIT_UNAVAILABLE);
  }

  report.historicalValidity = "VERIFIED";
  report.attempt = { attemptId: record.attemptId, sequence: record.sequence, endedAt: record.endedAt, result: record.result };

  // Reuse compatibility is a separate judgement, and a "no" here is not a defect in the
  // evidence. A newer attempt, a changed gate list or a different dependency tree all mean
  // "re-run the gates", while the sealed history stays exactly as true as it was.
  const notes = [];
  let unknownInputs = false;
  // gates/<head>/<attemptId>/result.json — three levels up is the run's gates root.
  const gatesRoot = dirname(dirname(dirname(seal.resultPath)));
  const { latest: newest, tied } = latestForHead(gatesRoot, seal.headSha);
  // A tie or a newer attempt is reported by its OUTCOME. Printing the state word "complete"
  // for a completed failure read as reassurance in the one place a reader needed a warning.
  if (!newest) {
    notes.push(`${tied.length} attempts for this head share sequence ${tied[0]?.sequence ?? "<unknown>"}, so there is no newest attempt`);
  } else if (newest.sequence !== record.sequence) {
    notes.push(`a newer attempt for this head (sequence ${newest.sequence}) is ${attemptOutcome(newest)} — the seal is not the latest word`);
  }
  // An input this environment could not measure is UNKNOWN, not "no difference". The probe used
  // to be `awk` over a formatted table with stderr discarded, so a missing tool, a changed
  // format or a non-zero exit all produced an empty string that read as agreement — and the
  // auditor cheerfully answered "reusable here: yes" having compared nothing at all.
  const unmeasured = [];
  const differing = [];
  for (const [flag, sealed, what] of [
    ["command-list-id", seal.commandListId, "the current gate command list"],
    ["deps-fingerprint", seal.depsFingerprint, "the dependencies installed here"],
  ]) {
    const measured = args[flag];
    if (typeof measured !== "string" || measured === "") {
      unknownInputs = true;
      unmeasured.push(what);
      notes.push(`${what} could not be measured in this environment, so it cannot be compared`);
    } else if (measured !== sealed) {
      differing.push(what);
      notes.push(`${what} differs from the one this attempt ran against`);
    }
  }
  report.inputComparison = { unmeasured, differing };
  report.notes = notes;
  // Computed HERE, from the reuse notes only. The disclosure lines appended below describe
  // preserved history, not a reason to re-run anything, and must never move this verdict.
  report.reusableHere = notes.length === 0 ? "yes" : unknownInputs ? "unknown" : "no";

  // What else is on disk for this head, RIGHT NOW. The seal carries its own frozen snapshot of
  // the same question (`seal.anomalies`), and the manifest holding it is an ordinary editable
  // file — so a reader who trusts only the snapshot is trusting a document that normal operation
  // rewrites. This list is re-derived from the preserved attempt directories instead.
  //
  // The two answers are reported side by side and neither overrides the other:
  //   - `addedSinceSeal` is expected. A later gate run legitimately adds history, and it does
  //     NOT falsify the seal, which never claimed to know the future.
  //   - `missingSinceSeal` means the seal named bytes that are no longer there. It is disclosed
  //     and it is not converted into a failure of an otherwise valid pass: what was verified
  //     above was verified. It is a preservation problem for a human, not a verdict.
  const sealedSnapshot = Array.isArray(seal.anomalies) ? seal.anomalies : [];
  const derivedNow = attemptsForHead(gatesRoot, seal.headSha)
    .filter((a) => resolve(a.dir) !== resolve(seal.attemptDir ?? "") && attemptIsNotAPass(a))
    .map(anomalyEntry);
  const nowDirs = new Set(derivedNow.map((a) => resolve(a.attemptDir)));
  const sealedDirs = new Set(sealedSnapshot.map((a) => resolve(a.attemptDir ?? "")));
  report.disclosure = {
    scope: `attempts at the SEALED head ${seal.headSha} only — see runHistory for every other head`,
    semantics:
      "atSeal is the frozen snapshot the seal carries; now is re-derived from the preserved " +
      "attempt directories at read time. addedSinceSeal is ordinary later history and falsifies nothing.",
    atSeal: bounded(sealedSnapshot),
    now: bounded(derivedNow),
    addedSinceSeal: bounded(derivedNow.filter((a) => !sealedDirs.has(resolve(a.attemptDir)))),
    missingSinceSeal: bounded(sealedSnapshot.filter((a) => !nowDirs.has(resolve(a.attemptDir ?? "")))),
  };

  // RUN-LEVEL history, across every head this run recorded an attempt at.
  //
  // `disclosure` above is head-scoped by design: a failure at a superseded commit is ordinary
  // history, not an anomaly around THIS seal. But stating a head-scoped count without its scope
  // read as a run-level one — an auditor using the read-only command the contract points at was
  // told "0 not passing" while a completed FAILURE for the same run sat on disk at another head,
  // reachable only by already knowing which head to ask for.
  //
  // A failure at an earlier head does NOT invalidate a later valid pass, and nothing here treats
  // it as though it did. It is disclosed, counted by the tool rather than by hand, and bounded —
  // and when the scan cannot be completed that is said, rather than an "all history" claim being
  // fabricated from a partial read.
  report.runHistory = runHistory(gatesRoot, seal.headSha);
  if (report.disclosure.missingSinceSeal.total > 0) {
    notes.push(
      `${report.disclosure.missingSinceSeal.total} attempt(s) named in the seal's snapshot are no longer on ` +
        "disk — the evidence was moved or removed after sealing. The verified pass above is unaffected.",
    );
  }
  if (report.disclosure.now.total > 0) {
    notes.push(
      `${report.disclosure.now.total} other attempt(s) for this head do not pass (see disclosure.now) — ` +
        "their records are preserved and are not counted by hand.",
    );
  }

  // Current eligibility, asked only when the caller says it needs a pass for work happening
  // now. It never touches historicalValidity: an authentic old pass stays VERIFIED history
  // even while it is refused as this moment's certification.
  //
  // THE HALF THAT USED TO BE MISSING. Until this file, `--require-current` compared only the gate
  // command list, the dependency fingerprint and the newest attempt. It never asked the one
  // question that separates reuse from a false pass: *is the caller standing on the revision the
  // seal is about?* `--repo` does not answer it — it is an object-lookup root, and the git check
  // above only proves the seal is internally consistent (`seal.headSha`'s tree equals
  // `seal.treeSha`), which is true whichever commit the caller happens to be on.
  //
  // So a resumed run could seal at head X, make an ordinary source-only repair commit to head Y
  // with the dependencies and gate list untouched, ask this question, be told ELIGIBLE, skip the
  // gates entirely, and report head Y as certified by a gate run that only ever happened at X.
  // That is exactly the state CLAUDE.md forbids.
  //
  // The caller must therefore OBSERVE its own checkout and hand the observations in. They are
  // required, not optional: an observation that was not supplied is not a match, because "I did
  // not look" and "it is the same" are different answers and only one of them is evidence.
  //
  // This is asked ONLY under `--require-current`. A read-only historical audit run from a checkout
  // sitting on some other commit still reports `historicalValidity: VERIFIED` and exit 0 — the old
  // pass is authentic, and nothing here retracts it.
  if (requireCurrent) {
    const blocking = [];

    for (const [flag, sealed, what] of [
      ["current-head", seal.headSha, "the revision this checkout is on"],
      ["current-tree-fingerprint", seal.fingerprint, "the working tree in this checkout"],
    ]) {
      const observed = args[flag];
      if (typeof observed !== "string" || observed === "") {
        blocking.push(
          `${what} was not observed by the caller (--${flag} missing), and an unobserved revision is ` +
            "not a match. A caller that needs a pass for work happening now must look at its own checkout.",
        );
      } else if (observed !== sealed) {
        blocking.push(
          `${what} is ${observed}, but the seal certifies ${sealed}. The gates ran against a ` +
            "different revision — re-run them here.",
        );
      }
    }
    if (!newest) blocking.push(`attempts for this head are tied at sequence ${tied[0]?.sequence ?? "<unknown>"} — a tie cannot certify anything`);
    else if (newest.sequence !== record.sequence) {
      blocking.push(`the newest attempt for this head (sequence ${newest.sequence}) is ${attemptOutcome(newest)}, and it is not the sealed one`);
    }
    // Each reason is keyed to the thing that actually failed, never to the aggregate verdict.
    //
    // It used to read `else if (report.reusableHere === "no")`, and `reusableHere` turns "no" for
    // ANY note — including "a newer attempt for this head is failed". So a seal refused purely
    // because it was superseded was also told its inputs differed, when they were byte-identical.
    // An agent following that message goes and re-installs dependencies chasing a difference that
    // does not exist. The input reason now comes from the input comparison itself, names WHICH
    // input, and is absent when every measured input matched.
    if (unmeasured.length > 0) {
      blocking.push(
        `this environment could not measure ${unmeasured.join(" or ")}, and an unmeasured input is not a match`,
      );
    }
    if (differing.length > 0) {
      blocking.push(`${differing.join(" and ")} differ(s) from what the attempt ran against`);
    }
    report.eligibilityReasons = blocking;
    report.currentEligibility = blocking.length === 0 ? "ELIGIBLE" : "INELIGIBLE";
    if (blocking.length > 0) {
      report.historicalValidity = "VERIFIED";
      emit(EXIT_REFUSED);
    }
  }
  emit(EXIT_OK);
}

/**
 * Every attempt recorded for one head, newest first, read from the preserved directories.
 *
 * The readout a handoff or a review quotes instead of counting rows by hand, and instead of
 * trusting `manifest.gateAttempts`, which is an editable field in an unprotected file. It is
 * bounded: a run with a hundred attempts prints the newest ones and says how many it left out.
 * It makes no judgement — a failing attempt in this list is a fact, not a verdict.
 */
function cmdHistory(args) {
  const gatesRoot = args["gates-root"] || die(EXIT_USAGE, "--gates-root is required");
  const head = args.head || die(EXIT_USAGE, "--head is required");
  const entries = attemptsForHead(gatesRoot, head).map(anomalyEntry);
  const readout = { headSha: head, gatesRoot, attempts: bounded(entries) };
  if ("json" in args) {
    process.stdout.write(`${JSON.stringify(readout, null, 2)}\n`);
    return;
  }
  process.stdout.write(`gate attempts for ${head}: ${readout.attempts.total}\n`);
  for (const entry of readout.attempts.shown) {
    process.stdout.write(`  seq ${String(entry.sequence ?? "?").padStart(4)}  ${entry.outcome.padEnd(12)} ${entry.attemptDir}\n`);
  }
  if (readout.attempts.omitted > 0) process.stdout.write(`  … ${readout.attempts.omitted} more (use --json)\n`);
}

// --- dispatch ----------------------------------------------------------------------------

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);

switch (subcommand) {
  case "begin":
    cmdBegin(args);
    break;
  case "record":
    cmdRecord(args);
    break;
  case "complete":
    cmdComplete(args);
    break;
  case "next-seq":
    cmdNextSeq(args);
    break;
  case "reserve":
    cmdReserve(args);
    break;
  case "select":
    cmdSelect(args);
    break;
  case "seal":
    cmdSeal(args);
    break;
  case "observe-ci":
    cmdObserveCi(args);
    break;
  case "verify":
    cmdVerify(args);
    break;
  case "history":
    cmdHistory(args);
    break;
  default:
    die(EXIT_USAGE, `unknown subcommand "${subcommand ?? ""}"`);
}

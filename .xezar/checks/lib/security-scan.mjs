// The security stage of the canonical gate run — the executable half of
// `SDLC.md` § Security before the quality verdict.
//
// WHY THIS EXISTS. Until this file the security stage was a written record: the author typed
// its result into the phase record and an absent result read as unknown. A record nobody can
// re-derive is not evidence, and "I looked" is the one claim a reviewer cannot check. This
// produces a STRUCTURED result from the actual candidate bytes, inside the gate attempt, so it
// is sealed with everything else and read before anyone gives a quality verdict.
//
// WHAT IT IS AND IS NOT. It is a bounded, offline, install-free scan of the lines THIS
// candidate added over its base, classified under the project's own rules. It is NOT a
// vulnerability scanner, and it never claims to be one: a check whose tool is unavailable —
// the advisory database needs the network, and discovery must not require one — is recorded as
// `unknown`, which is not a pass and is exactly what the reviewer must read.
//
// THE FOUR OUTCOMES, and only `pass` is a pass:
//   pass            the check ran over a populated input and found nothing
//   findings        the check ran and found something; the gate fails
//   unknown         the check could not run, or ran without the input it needs. Never a pass
//   not-applicable  the check does not fit this change set, with the artefact that says so
//
// THE FAIL-OPEN TRAP THIS AVOIDS (AGENTS.md § Changing a mechanism that already works). Against
// an empty input, "we never loaded the list" and "no match" are the same branch, so the two must
// never read the same. Here they do not. A change set the stage could not READ — an unresolved
// base, an unreadable repository, an enumeration command that errored — is `unknown` at the check
// level and a REFUSAL at the stage level: the stage could not look. A change set that is genuinely
// EMPTY is `not-applicable` and resolves: there is nothing to look at. The gate can run before the
// agent has committed anything, which is what makes the second shape routine rather than a hole.
// `--empty-declared` still records why a DELIVERED/VERIFICATION run carries no commits of its own,
// but it no longer decides the outcome — an empty change set resolves whether or not it is
// declared.
//
// EMPTY IS DECIDED FROM THE FULL ENUMERATION, NEVER FROM THE CONTENT-SCAN ONE. The content scan
// runs on `--diff-filter=ACMR`, which excludes deletions — there is no surviving content to read
// for a deleted path. A candidate that only DELETES files therefore enumerates zero ACMR paths,
// and deciding "empty" from that alone misreads a real, non-empty change set as one that changed
// nothing — a false statement, and false inside a security gate, because the deleted paths never
// reach the trust-boundary check either. So two different questions use two different
// enumerations: `allFiles` (no filter, deletions included) decides whether the change set is
// empty at all and is what the trust-boundary check reads; `files` (ACMR) is what the content
// scan — classification, secrets, kill-by-pattern, dependency inputs — reads. A change set that is
// non-empty in `allFiles` but has nothing in `files` (deletion-only, or similar) says so in its own
// words rather than claiming it changes no file.
//
// Usage:
//   node security-scan.mjs --cwd <dir> --base <sha> --head <sha> [--out <file>] [--quiet]
//                          [--empty-declared "<why this run legitimately carries no commits>"]
//
// Exit codes: 0 resolved (pass / unknown / not-applicable) · 1 refused (findings, or the stage
// could not look) · 2 usage.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const KIND = "xezar.security-result";

// Bounds. A gate that can be made to run for ever is a gate people turn off.
const MAX_FILES = 4000;
const MAX_DIFF_BYTES = 24 * 1024 * 1024;

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;

// --- what counts as code ------------------------------------------------------------------
//
// Data, not control flow, so one place answers "does a code capability apply here" for the
// decision, for the tests and for a reader.
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".sh", ".bash", ".zsh", ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cc", ".cpp",
  ".sql", ".yaml", ".yml", ".toml", ".json",
]);

const DEPENDENCY_INPUTS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)npm-shrinkwrap\.json$/,
  /(^|\/)package\.json$/,
  /^patches\//,
  /(^|\/)\.npmrc$/,
];

// Surfaces where an authorization decision lives. Automation cannot prove one is correct, so a
// change here does not fail the gate — it RECORDS that a human or a security reviewer is
// required, which the seal carries and the reviewer reads.
const TRUST_BOUNDARIES = [
  { pattern: /^\.xezar\/checks\/documented-output\.allowlist\.json$/, why: "the executables authorized for documented-output verification" },
  { pattern: /^packages\/xezar\/src\/server\//, why: "the HTTP surface, its origin guard and its bind host" },
  { pattern: /^packages\/xezar\/src\/agent-config\//, why: "reads and writes the coding agents' own config files" },
  { pattern: /^packages\/xezar\/src\/mcp\//, why: "the tools a project leader calls" },
  { pattern: /^packages\/xezar\/src\/workspace\//, why: "per-user state and the project registry" },
  { pattern: /^\.github\/workflows\//, why: "what CI is allowed to do with the repository's credentials" },
  { pattern: /^\.xezar\/pipeline\/config\.json$/, why: "the deploy and rollback targets, and the commands every gate run trusts" },
  { pattern: /^\.xezar\/config\.json$/, why: "the base branch every run forks from and merges into" },
  { pattern: /^\.xezar\/(workflows|checks)\//, why: "which steps may write, and the scripts a reading step is allowed to run" },
  { pattern: /^\.xezar\/routing(\.schema)?\.json$/, why: "which model may write, review or ship each kind of work" },
  { pattern: /^\.xezar\/loops\.json$/, why: "what the leader does unattended, and how often" },
  { pattern: /^\.xezar\/(docs|skills)\//, why: "the instructions every leader and role agent follows" },
  { pattern: /^\.claude\/settings(\.local)?\.json$/, why: "a permissions.allow rule here widens what a reading step's shell may run" },
  { pattern: /^\.codex\//, why: "a Codex rule, config or hook here can run a reading step's command outside its sandbox" },
  { pattern: /(^|\/)\.env\.example$/, why: "the env contract" },
];

// Credential-shaped PATHS. A file whose name says "secret" is a finding whatever is inside it.
const CREDENTIAL_PATHS = [
  { pattern: /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/, why: "an .env file" },
  { pattern: /\.pem$/, why: "a PEM key or certificate" },
  { pattern: /\.p12$/, why: "a PKCS#12 bundle" },
  { pattern: /\.pfx$/, why: "a PKCS#12 bundle" },
  { pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, why: "an SSH private key" },
  { pattern: /(^|\/)launch-key$/, why: "the cockpit launch key" },
  { pattern: /(^|\/)credentials(\.json)?$/, why: "a credentials file" },
];
// `.env.example` is the env CONTRACT and is required to be tracked (AGENTS.md § Zero config).
const CREDENTIAL_PATH_ALLOW = [/(^|\/)\.env\.example$/, /(^|\/)\.env\.sample$/];

// Credential-shaped CONTENT, matched against ADDED lines only. Each pattern names a token
// format whose mere shape is the finding; none of them needs the value to be read, and the
// value is never copied into the result.
const SECRET_PATTERNS = [
  { name: "private-key-block", re: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-token", re: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "url-userinfo-credential", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]{6,}@/i },
];

// The #156 lesson, as a check rather than as a paragraph people remember. `pkill -f` matches
// every process this user owns, and xezar hands each agent CLI its whole skill text as one
// argument — so a pattern lifted from a skill kills every peer agent running it. Prose that
// WARNS about the pattern is not the defect, so this reads code files only and skips comments.
const KILL_BY_PATTERN = [
  { name: "pkill-by-pattern", re: /\bpkill\s+(-[A-Za-z]+\s+)*-[A-Za-z]*f\b/ },
  { name: "killall", re: /\bkillall\b/ }, // security-scan:allow — this line defines the rule
  { name: "kill-pgrep-f", re: /\bkill\b[^\n]*\$\(\s*pgrep\s+[^)]*-[A-Za-z]*f\b/ },
];
const KILL_SCANNED_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".mjs", ".cjs", ".js", ".ts", ".tsx", ".yaml", ".yml"]);

// THE ONLY SUPPRESSION, and it is per LINE. A scanner has to be able to describe the thing it
// bans — this file names `killall` in order to ban it, and the tests write credential-shaped
// fixtures on purpose. A whole-file or whole-rule exemption would hide the next real one, so
// the allowance is one marker on one line, and the COUNT of allowed lines is recorded in the
// result where a reviewer reads it. Never add this marker to make a real finding go away.
const ALLOW_MARKER = "security-scan:allow";

// --- small helpers -------------------------------------------------------------------------

function die(code, message) {
  process.stderr.write(`security-scan: ${message}\n`);
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
    else { args[key] = next; i++; }
  }
  return args;
}

/** git, always as an argument array — never a string a path could break out of. */
function git(cwd, ...argv) {
  return execFileSync("git", ["-C", cwd, ...argv], {
    encoding: "utf8",
    maxBuffer: MAX_DIFF_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function extensionOf(path) {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? path.slice(dot) : "";
}

function matchesAny(path, patterns) {
  return patterns.some((p) => (p.pattern ?? p).test(path));
}

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** One check's result. `pass` is the only pass; every other value says so out loud. */
function check(name, status, detail, findings = []) {
  return { name, status, detail, findings };
}

// --- the scan ------------------------------------------------------------------------------

/**
 * Added lines, per file, from a unified diff. Only `+` lines are read: an unchanged secret is a
 * pre-existing fact for a different task, and re-reporting it on every candidate is how a gate
 * becomes noise people learn to ignore.
 */
export function addedLinesByFile(diffText) {
  const byFile = new Map();
  let current = null;
  let lineNumber = 0;
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4);
      current = path === "/dev/null" ? null : path.replace(/^b\//, "");
      if (current && !byFile.has(current)) byFile.set(current, []);
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
      lineNumber = m ? Number(m[1]) : 0;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("+")) {
      byFile.get(current).push({ line: lineNumber, text: raw.slice(1) });
      lineNumber++;
    } else if (!raw.startsWith("-") && !raw.startsWith("\\")) {
      lineNumber++;
    }
  }
  return byFile;
}

export function classifyInventory(files) {
  const code = [];
  const other = [];
  for (const file of files) {
    if (CODE_EXTENSIONS.has(extensionOf(file)) || matchesAny(file, DEPENDENCY_INPUTS)) code.push(file);
    else other.push(file);
  }
  return { code, other };
}

export function scanSecrets(addedByFile) {
  const findings = [];
  let allowed = 0;
  for (const [file, lines] of addedByFile) {
    for (const { line, text } of lines) {
      const matching = SECRET_PATTERNS.filter((pattern) => pattern.re.test(text));
      if (matching.length === 0) continue;
      // The marker is per LINE, so a line matching two rules is ONE allowed line. Counting it per
      // matching rule made the result text ("N line(s) carry an explicit allow marker") false.
      if (text.includes(ALLOW_MARKER)) { allowed++; continue; }
      // The VALUE is never copied into evidence — only where it is and what shape it has.
      for (const pattern of matching) {
        findings.push({ file, line, rule: pattern.name, detail: `an added line matches ${pattern.name}` });
      }
    }
  }
  return { findings, allowed };
}

export function scanCredentialPaths(files) {
  const findings = [];
  for (const file of files) {
    if (matchesAny(file, CREDENTIAL_PATH_ALLOW)) continue;
    for (const rule of CREDENTIAL_PATHS) {
      if (rule.pattern.test(file)) findings.push({ file, line: null, rule: "credential-file", detail: `${file} is ${rule.why}` });
    }
  }
  return findings;
}

export function scanKillByPattern(addedByFile) {
  const findings = [];
  let allowed = 0;
  for (const [file, lines] of addedByFile) {
    if (!KILL_SCANNED_EXTENSIONS.has(extensionOf(file))) continue;
    for (const { line, text } of lines) {
      if (isCommentLine(text)) continue;
      const matching = KILL_BY_PATTERN.filter((rule) => rule.re.test(text));
      if (matching.length === 0) continue;
      // Per LINE, for the same reason as `scanSecrets` above.
      if (text.includes(ALLOW_MARKER)) { allowed++; continue; }
      for (const rule of matching) {
        findings.push({
          file,
          line,
          rule: rule.name,
          detail: "kills by command-line pattern, which matches every peer agent this user owns (#156)",
        });
      }
    }
  }
  return { findings, allowed };
}

export function trustBoundariesTouched(files) {
  const touched = [];
  for (const file of files) {
    for (const boundary of TRUST_BOUNDARIES) {
      if (boundary.pattern.test(file)) touched.push({ file, why: boundary.why });
    }
  }
  return touched;
}

/**
 * The whole stage, as a pure function of the inventory and the diff, so the tests drive THIS
 * code rather than a copy of it.
 */
export function assess({ files, allFiles, addedByFile, truncated }) {
  const { code, other } = classifyInventory(files);
  const applies = code.length > 0;
  const checks = [];

  if (allFiles.length === 0) {
    // Nothing changed at all, so there is nothing to scan and nothing to refuse. The gate can run
    // before the agent has committed anything, which makes a branch sitting on its own merge-base a
    // routine shape rather than a hole the stage fell into (9 of 269 sealed attempts over
    // 2026-09-17/18 were exactly this). The shapes that DO mean "the stage did not look" — an
    // unresolved base, an unreadable repository, an enumeration command that errored — never reach
    // here; the driver records them as a read failure and refuses. `allFiles` is the unfiltered
    // enumeration (deletions included), never the ACMR one — a deletion-only candidate is a real,
    // non-empty change set and must not resolve here (see `files.length === 0` below).
    return {
      decision: "no",
      decisionReason: "the candidate changes no file over its base, so no code or security capability applies",
      inventory: { total: 0, code: 0, other: 0, truncated: false },
      checks: [check("inventory", "not-applicable", "the candidate changes no file over its base, so there is nothing to scan")],
      trustBoundaries: [],
      reviewerRequired: false,
      status: "not-applicable",
      blocking: [],
    };
  }

  const scannable = files.length > 0;
  if (truncated) {
    checks.push(check("inventory", "unknown", `more than ${MAX_FILES} changed files; the scan was bounded and did not read all of them`));
  } else if (!scannable) {
    // Real changes exist (`allFiles` is non-empty) but none of them survive the ACMR filter — a
    // deletion-only change set is the ordinary case. Say so in its own words: never "changes no
    // file", which is only true for the truly-empty shape handled above.
    checks.push(
      check(
        "inventory",
        "not-applicable",
        `${allFiles.length} changed file(s) enumerated over the base, none carrying content this scan reads (deletion-only or similar)`,
      ),
    );
  } else {
    checks.push(check("inventory", "pass", `${files.length} changed file(s) enumerated over the base`));
  }

  const secrets = scanSecrets(addedByFile);
  checks.push(
    addedByFile.size === 0
      ? check("secrets", "unknown", "no added line was readable, so the secret scan had no input")
      : check(
          "secrets",
          secrets.findings.length ? "findings" : "pass",
          `${addedByFile.size} changed file(s) scanned for credential-shaped literals${secrets.allowed ? `; ${secrets.allowed} line(s) carry an explicit allow marker` : ""}`,
          secrets.findings,
        ),
  );

  const credentialFindings = scanCredentialPaths(files);
  checks.push(check("credential-files", credentialFindings.length ? "findings" : "pass", "changed paths checked against the credential-file list", credentialFindings));

  const kills = scanKillByPattern(addedByFile);
  const killScanned = [...addedByFile.keys()].filter((f) => KILL_SCANNED_EXTENSIONS.has(extensionOf(f)));
  checks.push(
    killScanned.length === 0
      ? check("kill-by-pattern", "not-applicable", "the candidate adds no executable line to scan")
      : check(
          "kill-by-pattern",
          kills.findings.length ? "findings" : "pass",
          `${killScanned.length} executable file(s) scanned${kills.allowed ? `; ${kills.allowed} line(s) carry an explicit allow marker` : ""}`,
          kills.findings,
        ),
  );

  const dependencyInputs = files.filter((f) => matchesAny(f, DEPENDENCY_INPUTS));
  checks.push(
    dependencyInputs.length === 0
      ? check("dependencies", "not-applicable", "no dependency input changed in this candidate (no lockfile, manifest, patch or .npmrc)")
      : check(
          "dependencies",
          "unknown",
          `${dependencyInputs.length} dependency input(s) changed (${dependencyInputs.join(", ")}). The advisory database needs the network and discovery must not require one, so no advisory check ran. Unknown is not a pass — a reviewer reads this.`,
        ),
  );

  // `allFiles`, not `files`: a deleted path can be the trust-boundary change (deleting the origin
  // guard is itself an authorization-relevant edit), and ACMR would hide it from this check the
  // same way it hid it from the emptiness decision above.
  const trustBoundaries = trustBoundariesTouched(allFiles);
  checks.push(
    trustBoundaries.length === 0
      ? check("trust-boundary", "not-applicable", "the candidate changes no named trust boundary")
      : check("trust-boundary", "unknown", `${trustBoundaries.length} named trust boundary/boundaries changed; automation cannot prove an authorization decision is correct, so a human or a security reviewer is required`),
  );

  const blocking = checks.filter((c) => c.status === "findings");
  // `trust-boundary` is deliberately OUT of the rollup (#503 review N1). `unknown` in this stage
  // means "the check could not look", and this one DID look — it found a named boundary and
  // recorded it. `phase-record.md` says `reviewerRequired` is recorded separately and does not
  // fail the gate, but feeding the same fact into the rollup made the sealed headline read
  // `unknown` for routine work (3 of the last 5 merges on main, two of them only because
  // `.env.example` is both a named boundary AND a file AGENTS.md § Zero config requires changing
  // beside any XEZ_* var). A stage that says "withhold the verdict" on routine work is the noise
  // this file's own rule table argues against. The per-check entry and the flag both stay; only
  // the rollup stops treating a recorded fact as an unanswered question.
  const rollup = checks.filter((c) => c.name !== "trust-boundary");
  let status;
  if (blocking.length > 0) status = "findings";
  else if (!applies) status = "not-applicable";
  else if (rollup.some((c) => c.status === "unknown")) status = "unknown";
  else status = "pass";

  return {
    decision: applies ? "yes" : "no",
    decisionReason: applies
      ? `${code.length} changed file(s) carry a code or dependency capability`
      : scannable
        ? `none of the ${other.length} changed file(s) carries a code or dependency capability`
        : `${allFiles.length} changed file(s) over the base, none carrying content this scan reads (deletion-only or similar), so no code or dependency capability applies`,
    // `total` is the full enumeration, so a deletion-only change set is never reported as 0 — that
    // is the misreport this fixed. `code`/`other` stay derived from the ACMR content scan.
    inventory: { total: allFiles.length, code: code.length, other: other.length, truncated },
    checks,
    trustBoundaries,
    reviewerRequired: trustBoundaries.length > 0,
    status,
    blocking: blocking.map((c) => c.name),
  };
}

// --- driver --------------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.cwd || die(EXIT_USAGE, "--cwd is required");
  const head = args.head || die(EXIT_USAGE, "--head is required");
  const base = args.base;
  // Why a DELIVERED/VERIFICATION run carries no commits, recorded from the DRIVER rather than
  // inferred: this file cannot tell "the run legitimately has no commits of its own" from "the run
  // was asked to change source and has not committed yet". The reason travels into the result for
  // the reviewer; the outcome no longer depends on it.
  const emptyDeclared = typeof args["empty-declared"] === "string" ? args["empty-declared"] : null;

  let files = [];
  let allFiles = [];
  let diffText = "";
  let truncated = false;
  let readFailure = null;

  try {
    // No base means no comparison is possible, and inventing one (HEAD~1, the whole tree) would
    // report a different change set than the one being gated. That is an unreadable input, not
    // an empty one.
    if (!base) throw new Error("no merge-base against the integration base could be resolved");
    // The FULL enumeration, no filter: this is what decides whether the change set is empty and
    // what the trust-boundary check reads. `--diff-filter=ACMR` excludes deletions, and deciding
    // emptiness from that alone misreads a deletion-only candidate as one that changed nothing.
    const allRaw = git(cwd, "diff", "--name-only", `${base}..${head}`);
    allFiles = allRaw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (allFiles.length > MAX_FILES) {
      truncated = true;
      allFiles = allFiles.slice(0, MAX_FILES);
    }
    // The ACMR-filtered enumeration: what the content scan reads. A deleted path has no surviving
    // content — this scan only ever reads added (`+`) lines, so there is nothing there for it.
    const raw = git(cwd, "diff", "--name-only", "--diff-filter=ACMR", `${base}..${head}`);
    files = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (files.length > MAX_FILES) {
      truncated = true;
      files = files.slice(0, MAX_FILES);
    }
    if (files.length > 0) {
      diffText = git(cwd, "diff", "--unified=0", "--diff-filter=ACMR", `${base}..${head}`, "--", ...files);
    }
  } catch (error) {
    readFailure = error?.message ?? String(error);
  }

  const startedAt = new Date().toISOString();
  let result;
  if (readFailure) {
    // A scan that could not read its input has no opinion, and "no findings" would be a lie in
    // the shape of a pass. This is the interrupted/parse-error case and it refuses.
    result = {
      decision: "unknown",
      decisionReason: `the change set could not be read: ${readFailure}`,
      inventory: { total: 0, code: 0, other: 0, truncated: false },
      checks: [check("inventory", "unknown", `the change set could not be read: ${readFailure}`)],
      trustBoundaries: [],
      reviewerRequired: false,
      status: "unknown",
      blocking: [],
    };
  } else {
    result = assess({ files, allFiles, addedByFile: addedLinesByFile(diffText), truncated });
  }

  // NO EMPTY-INVENTORY REFUSAL, and the distinction it rests on is the whole point. An empty
  // change set is `not-applicable` and resolves: the gate can run before the agent has committed
  // anything, so there is nothing to scan and nothing to refuse. A change set the stage could not
  // READ is the opposite question, and `readFailure` still refuses it. `empty-scan-green` is the
  // falsifier for that half — the enumeration is broken, and zero files must not become a pass.
  //
  // The declaration is RECORDED, never inferred: a run whose fix landed on another branch
  // (`DELIVERED`) or that only verified an existing revision (`VERIFICATION`) is documented to
  // carry no commits of its own. The driver passes the reason so a reviewer reads why the branch is
  // empty; the outcome no longer depends on it.
  const refused = readFailure !== null || result.status === "findings";

  const record = {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    startedAt,
    endedAt: new Date().toISOString(),
    base: base ?? null,
    head,
    ...result,
    emptyDeclared,
    refused,
    refusedReason: readFailure
      ? "the change set could not be read"
      : result.status === "findings"
        ? `blocking findings in: ${result.blocking.join(", ")}`
        : null,
  };
  record.digest = createHash("sha256").update(JSON.stringify(record)).digest("hex");

  if (typeof args.out === "string") {
    mkdirSync(dirname(args.out), { recursive: true });
    const tmp = join(dirname(args.out), `.${Date.now()}-${process.pid}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, args.out);
  }

  if (!args.quiet) {
    process.stdout.write(`security stage   ${record.status.toUpperCase()}\n`);
    process.stdout.write(`decision         code/security capability applies: ${record.decision}\n`);
    process.stdout.write(`                 ${record.decisionReason}\n`);
    process.stdout.write(`inventory        ${record.inventory.total} changed file(s), ${record.inventory.code} with a code capability\n`);
    for (const c of record.checks) {
      process.stdout.write(`  ${c.status.padEnd(15)} ${c.name} — ${c.detail}\n`);
      for (const f of c.findings ?? []) {
        process.stdout.write(`      ${f.file}${f.line ? `:${f.line}` : ""} [${f.rule}] ${f.detail}\n`);
      }
    }
    if (record.emptyDeclared) {
      process.stdout.write(`empty declared   ${record.emptyDeclared}\n`);
    }
    if (record.reviewerRequired) {
      process.stdout.write("reviewer         REQUIRED — a named trust boundary changed:\n");
      for (const b of record.trustBoundaries) process.stdout.write(`      ${b.file} — ${b.why}\n`);
    }
    if (typeof args.out === "string") process.stdout.write(`record           ${args.out}\n`);
    if (record.refused) process.stdout.write(`REFUSED          ${record.refusedReason}\n`);
    else process.stdout.write("RESOLVED         unknown is recorded as unknown; it is never a pass\n");
  }

  process.exit(refused ? EXIT_REFUSED : EXIT_OK);
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main();

// Minimal task-manifest reader/writer for the Xezar worktree checks.
//
// The manifest is the ONLY channel that survives a worktree being reclaimed, deleted or
// resumed, because it lives in the primary checkout's ignored `.local/xezar/tasks/<taskId>/`
// rather than inside the task tree. It is deliberately small: identity, where the work
// happened, what it forked from, what the checks concluded, and the pull request. It is
// not a log.
//
// Usage:
//   node manifest.mjs <path> --init runId=… workflow=… cwd=… branch=…
//   node manifest.mjs <path> --set key=value
//   node manifest.mjs <path> --set-json key={"a":1}
//   node manifest.mjs <path> --push-json key={"a":1}
//   node manifest.mjs <path> --get dotted.path
//
// Writes are atomic (temp file + rename) so a cancelled run cannot leave half a manifest.

import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const EMPTY = {
  runId: null,
  workflow: null,
  issue: null,
  decision: null,
  dependsOn: [],
  cwd: null,
  isWorktree: null,
  branch: null,
  baseRef: null,
  baseSha: null,
  headSha: null,
  treeSha: null,
  repo: null,
  pr: null,
  limits: null,
  checks: [],
  // The accepted gate attempt: local command results, execution identity and log digests, and
  // nothing else. Written only by `gate-results.mjs seal`, which reads a recorded attempt
  // rather than asserting an outcome.
  gateEvidence: null,
  // Every attempt this run published, newest last — including the failed ones. A failed or
  // interrupted attempt is evidence too, and hiding it is how an older pass gets reused.
  gateAttempts: [],
  // CI is a separate, MUTABLE record: pending becomes success, a re-run changes a conclusion.
  // It references the sealed attempt and the SHA/ref CI actually tested, and it never touches
  // `gateEvidence` — so no later CI result can rewrite what was sealed locally.
  ciObservations: [],
  createdAt: null,
  updatedAt: null,
};

const [, , path, ...args] = process.argv;
if (!path) {
  process.stderr.write("manifest.mjs: a manifest path is required\n");
  process.exit(2);
}

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ...EMPTY };
  }
}

// A manifest path is derived from a run id, so it should always be a plain file in a plain
// directory the run owns. A symlink anywhere in the last two segments means the write would
// land somewhere else — another task's evidence, or outside the evidence root entirely. Refuse
// rather than follow it; the run id validation in lib/common.sh guards the path's shape, and
// this guards what is actually on disk.
function refuseSymlink(target, what) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return; // does not exist yet — nothing to follow
  }
  if (stat.isSymbolicLink()) {
    process.stderr.write(`manifest.mjs: refusing to write through a symlinked ${what}: ${target}\n`);
    process.exit(2);
  }
}

function save(data) {
  data.updatedAt = new Date().toISOString();
  if (!data.createdAt) data.createdAt = data.updatedAt;
  refuseSymlink(dirname(path), "evidence directory");
  refuseSymlink(path, "manifest file");
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

// "a.b" -> data.a.b, without creating intermediate objects on a read.
function read(data, dotted) {
  return dotted.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), data);
}

function splitPair(arg) {
  const at = arg.indexOf("=");
  if (at < 1) {
    process.stderr.write(`manifest.mjs: expected key=value, got "${arg}"\n`);
    process.exit(2);
  }
  return [arg.slice(0, at), arg.slice(at + 1)];
}

const data = load();
let mutated = false;

for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flag === "--get") {
    const value = read(data, args[++i] ?? "");
    process.stdout.write(value == null ? "" : String(value));
    process.exit(0);
  }
  if (flag === "--init" || flag === "--set") {
    // --init takes every following bare key=value; --set takes exactly one.
    const take = flag === "--init" ? args.length : i + 2;
    while (i + 1 < take && args[i + 1] && !args[i + 1].startsWith("--")) {
      const [key, value] = splitPair(args[++i]);
      data[key] = value === "" ? null : value;
      mutated = true;
    }
    continue;
  }
  if (flag === "--set-json" || flag === "--push-json") {
    const [key, raw] = splitPair(args[++i] ?? "");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      process.stderr.write(`manifest.mjs: ${key} is not valid JSON: ${error.message}\n`);
      process.exit(2);
    }
    if (flag === "--push-json") {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(parsed);
    } else {
      data[key] = parsed;
    }
    mutated = true;
    continue;
  }
  process.stderr.write(`manifest.mjs: unknown flag "${flag}"\n`);
  process.exit(2);
}

if (mutated) save(data);

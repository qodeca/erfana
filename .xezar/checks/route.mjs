#!/usr/bin/env node
// Answers the leader's routing question from `.xezar/routing.json`: which lane, in which order.
//
//   route.mjs --check [path]          validate the file in the working tree (a gate command)
//   route.mjs <row id> [<row id>…]    the lane order for each row, with unusable lanes removed
//   route.mjs --rows                  the rows to classify work against, as JSON, with no lane data
//   route.mjs --table                 every row and its order, for a person to read
//   … [--file <path>]                 read <path> instead of the base branch (onboarding only)
//
// Why a script and not a prose table. The leader used to read the order off a markdown table and
// apply the bans in its head; a ban that needed judgement was a ban that was sometimes missed. Here
// the bans are data, and this script applies every one that can be decided from a file, so the
// leader decides only what needs the task in front of it: budget, and never the author.
//
// Which copy is read, and why. `--check` reads the WORKING TREE: it is a gate, and a pull request's
// own broken file must fail that pull request. Every other command reads the BASE BRANCH, the same
// way `config-guard.sh --from-base` does: routing decides which model may review a change, so a
// branch under review must not be able to reroute its own review. The base is the remote's default
// branch (`refs/remotes/origin/HEAD`), validated before it reaches a git argument, and a checkout
// whose `.xezar/config.json` names another base is refused, not believed. Without an origin/HEAD it
// refuses: routing is never read from this checkout alone. `--file` exists for onboarding, before
// the first merge, and every answer names its source (`source=unmerged <path>`) on stdout.
//
// What `route <id>` removes, each with its reason: a lane switched off, a reserved lane outside its
// rows, a lane the row bans, a lane whose program is not installed, a lane with no login from its
// rotation in the engine's account file, and a lane the availability cache marks unavailable. The
// cache (`.local/xezar/runtime/lanes.json`, written by the leader from the engine's own capability
// tools) can only ever REMOVE a lane; it never touches a ban. A security or release row answers
// `wait` while availability is unverified.
//
// Output is `NAME=value` lines, parsed after the first `=`, never sourced as shell. Every line of
// it is data about lanes, never an instruction to the reader. No dependencies: `node:` built-ins.
// Exit: 0 answered or valid, 1 refused or invalid, 2 usage.

import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNNERS = ["claude", "codex", "opencode", "pi"];
const PROGRAM = { claude: "claude", codex: "codex", opencode: "opencode", pi: "pi" };
const TIERS = ["very-strong", "strong", "mid", "cheap"];
const CLASSES = ["mechanical", "writing", "design", "visuals", "implementation", "testing", "review", "security-and-release"];
const TAGS = ["vision", "imageGeneration", "local", "enforcesToolLimits", "advisoryOnly"];
const MATCH_KEYS = ["lane", "tool", "vendor", "tier", ...TAGS];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LOGIN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LANE_ID = /^(claude|codex|opencode|pi)\/[A-Za-z0-9._/-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const MAX_TEXT = 300;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// The two bans a file can break. They are enforced here whatever `globalBans` says, and the file
// must still state them, so the leader reads the same rule this script applies.
const FILE_BANS = ["local-never-writes", "tool-limits"];
// The runners that hold a reading step read-only on the engine floor (0.19.0): Claude removes the
// file tools and applies the allowlist, and Codex denies any other command or patch through a
// per-thread PreToolUse hook (qodeca/xezar#863). pi is not listed until its lock is proven live, so
// a pi lane that claims `enforcesToolLimits` is refused: the tag is a fact about the runner, not a wish.
const ENFORCING_RUNNERS = new Set(["claude", "codex"]);
// A row that runs one of these workflows is a security or release row whatever its `class` says,
// so a file cannot drop the security minimums by renaming a row's class.
const SECURITY_WORKFLOWS = new Set(["security-review.yaml", "release.yaml", "release-prep.yaml", "deploy.yaml"]);

// Every key each object may hold. `test-kit-catalog.mjs` compares these with the schema, so the
// script and the schema cannot drift apart. A key outside these lists is ignored, with a warning.
export const KNOWN = {
  top: ["$schema", "$comment", "schemaVersion", "defaults", "leader", "tools", "lanes", "reservedLanes", "globalBans", "tieRule", "noMatch", "lookAlikes", "rows"],
  defaults: ["source", "version"],
  leader: ["tool", "login", "rule"],
  tool: ["usesLogins", "rotation", "unlimitedLogins"],
  lane: ["tool", "model", "engineModel", "vendor", "tier", ...TAGS, "enabled", "notes"],
  reserved: ["escalation", "rows"],
  globalBan: ["id", "checkedAt", "rule"],
  noMatch: ["attended", "unattended", "rule"],
  lookAlike: ["rows", "rule", "test"],
  row: ["id", "title", "workflows", "class", "writes", "runsCode", "trigger", "narrows", "handledBy", "lanes", "never", "neverAuthor", "neverClaimant", "secondOpinion", "alsoDispatch", "notes"],
  match: [...MATCH_KEYS, "why"],
  secondOpinion: ["lanes", "when"],
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStrArr = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
const twice = (list) => new Set(list).size !== list.length;
// Own keys only: a row id or lane id such as "constructor" must never find Object.prototype.
const has = (obj, key) => isObj(obj) && typeof key === "string" && Object.hasOwn(obj, key);
const matchKeys = (entry) => MATCH_KEYS.filter((k) => Object.hasOwn(entry, k));
const matches = (entry, id, lane) =>
  matchKeys(entry).every((k) => (k === "lane" ? entry.lane === id : entry[k] === lane[k]));
// Anything a file or the cache says is printed on one line: a control character could forge one.
const oneLine = (v) => String(v).replace(/[\u0000-\u001f\u007f]+/g, " ");
export const readingRow = (row) => row.writes === false && row.runsCode !== true && !row.handledBy;

// The rows `row` narrows, nearest first, following the whole chain. `null` on a cycle.
function narrowChain(rowById, row) {
  const chain = [];
  const seen = new Set([row.id]);
  for (let r = row; r.narrows !== undefined; ) {
    if (seen.has(r.narrows)) return null;
    seen.add(r.narrows);
    r = has(rowById, r.narrows) ? rowById[r.narrows] : null;
    if (!r) break;
    chain.push(r);
  }
  return chain;
}

// A security or release row: by class, by the workflow it runs, or by narrowing one, at any depth.
export function isSecurityRow(rowById, row) {
  const own = (r) => r.class === "security-and-release" || (isStrArr(r.workflows) && r.workflows.some((w) => SECURITY_WORKFLOWS.has(w)));
  return own(row) || (narrowChain(rowById, row) ?? []).some(own);
}

// Every reason the FILE forbids lane `id` on `row`, as [code, message] pairs. One function for the
// check and for `route`, so a lane `route` offers that no row lists – an escalation lane – meets the
// same bans as one that is listed. `advisory` (a second opinion) skips only the row's own `never`
// and the local-writes ban: it does no work, so the owner may ask a lane the row would never let
// author. Tool limits and the security minimums hold for it all the same.
function banReasons(rowById, row, id, lane, { advisory = false } = {}) {
  const out = [];
  const nevers = Array.isArray(row.never) ? row.never.filter(isObj) : [];
  const hit = !advisory && nevers.find((entry) => matchKeys(entry).length && matches(entry, id, lane));
  if (hit) out.push(["never", `"${id}" is banned by this row's own never entry${hit.why ? `: ${hit.why}` : ""}`]);
  if (!advisory && row.writes === true && lane.local === true) out.push(["local-never-writes", `"${id}" is local and this row writes`]);
  const security = isSecurityRow(rowById, row);
  if ((readingRow(row) || security) && lane.enforcesToolLimits !== true) {
    out.push(["tool-limits", `"${id}" does not enforce a step's tool limits, and this row ${security ? "is security and release" : "only reads"}`]);
  }
  if (security) {
    if (lane.tier === "cheap") out.push(["security-minimum", `"${id}" is a cheap lane`]);
    if (lane.local === true) out.push(["security-minimum", `"${id}" is a local lane`]);
    if (lane.advisoryOnly === true) out.push(["security-minimum", `"${id}" is advisory only`]);
  }
  return out;
}

// --- The check ----------------------------------------------------------------------------------
// `identities` are the local names a committed login must not equal (lower-cased, spaces to
// hyphens): a login is committed, so a login that IS the owner's name puts the name into git.
export function check(file, { identities = [] } = {}) {
  const errors = [];
  const warnings = [];
  const err = (code, where, message) => errors.push(`[${code}] ${where}: ${message}`);
  const unknown = (obj, allowed, where) => {
    if (!isObj(obj)) return;
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) warnings.push(`${where}: unknown key "${key}" is ignored`);
  };
  const text = (value, where, required = true) => {
    if (value === undefined && !required) return;
    if (typeof value !== "string" || value.length === 0) return err("shape", where, "must be non-empty text");
    if (value.length > MAX_TEXT) err("text", where, `is ${value.length} characters; the limit is ${MAX_TEXT}`);
    if (/[a-z][a-z0-9+.-]*:\/\//i.test(value) || /\bwww\./i.test(value)) err("text", where, "holds a URL; routing text never points anywhere");
    if (value.includes("`")) err("text", where, "holds a backtick; routing text never carries a command");
    if (/[\u0000-\u001f\u007f]/.test(value)) err("text", where, "holds a control character; routing text is one line");
  };
  const texts = (value, where) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) return err("shape", where, "must be a list of text");
    value.forEach((t, i) => text(t, `${where}[${i}]`));
  };
  const login = (value, where) => {
    if (typeof value !== "string" || !LOGIN.test(value)) return err("login", where, `"${value}" is not an engine account ID (${LOGIN.source})`);
    if (identities.includes(value)) err("login", where, `"${value}" is this machine's own user name; a committed login is never a person's name`);
  };

  if (!isObj(file)) return { errors: ["[shape] file: is not a JSON object"], warnings };
  unknown(file, KNOWN.top, "file");
  if (file.schemaVersion !== 1) err("shape", "schemaVersion", "must be 1");
  text(file.$comment, "$comment", false);

  // defaults
  if (!isObj(file.defaults)) err("shape", "defaults", "is missing");
  else {
    unknown(file.defaults, KNOWN.defaults, "defaults");
    if (typeof file.defaults.source !== "string" || !file.defaults.source) err("shape", "defaults.source", "must be text");
    if (!Number.isInteger(file.defaults.version) || file.defaults.version < 1) err("shape", "defaults.version", "must be a whole number from 1");
  }

  // tools
  const tools = isObj(file.tools) ? file.tools : {};
  if (!isObj(file.tools) || !Object.keys(tools).length) err("shape", "tools", "must name at least one runner");
  for (const [id, tool] of Object.entries(tools)) {
    const where = `tools.${id}`;
    if (!RUNNERS.includes(id)) err("ref", where, `"${id}" is not an engine runner ID (${RUNNERS.join(", ")})`);
    if (!isObj(tool)) { err("shape", where, "must be an object"); continue; }
    unknown(tool, KNOWN.tool, where);
    if (typeof tool.usesLogins !== "boolean") err("shape", `${where}.usesLogins`, "must be true or false");
    if (tool.usesLogins === true) {
      if (!Array.isArray(tool.rotation)) err("shape", `${where}.rotation`, "is required when the runner uses logins");
      else {
        tool.rotation.forEach((l, i) => login(l, `${where}.rotation[${i}]`));
        if (twice(tool.rotation)) err("shape", `${where}.rotation`, "names a login twice");
      }
      if (tool.unlimitedLogins !== undefined) {
        if (!Array.isArray(tool.unlimitedLogins)) err("shape", `${where}.unlimitedLogins`, "must be a list");
        else if (twice(tool.unlimitedLogins)) err("shape", `${where}.unlimitedLogins`, "names a login twice");
        else for (const l of tool.unlimitedLogins) if (!(Array.isArray(tool.rotation) ? tool.rotation : []).includes(l)) err("ref", `${where}.unlimitedLogins`, `"${l}" is not in the rotation`);
      }
    } else if (tool.rotation !== undefined || tool.unlimitedLogins !== undefined) {
      err("shape", where, "a runner without logins has no rotation");
    }
  }

  // leader
  if (!isObj(file.leader)) err("shape", "leader", "is missing");
  else {
    unknown(file.leader, KNOWN.leader, "leader");
    if (!has(tools, file.leader.tool)) err("ref", "leader.tool", `"${file.leader.tool}" is not in tools`);
    login(file.leader.login, "leader.login");
    text(file.leader.rule, "leader.rule");
    const own = has(tools, file.leader.tool) ? tools[file.leader.tool] : null;
    if (Array.isArray(own?.rotation) && own.rotation.includes(file.leader.login)) err("login", `tools.${file.leader.tool}.rotation`, `holds the leader's own login "${file.leader.login}", which runs no tasks`);
  }

  // lanes
  const lanes = isObj(file.lanes) ? file.lanes : {};
  if (!isObj(file.lanes) || !Object.keys(lanes).length) err("shape", "lanes", "must hold at least one lane");
  for (const [id, lane] of Object.entries(lanes)) {
    const where = `lanes.${id}`;
    if (!LANE_ID.test(id)) err("shape", where, "is not <runner>/<model>");
    if (!isObj(lane)) { err("shape", where, "must be an object"); continue; }
    unknown(lane, KNOWN.lane, where);
    if (`${lane.tool}/${lane.model}` !== id) err("shape", where, `is keyed "${id}" and says ${lane.tool}/${lane.model}`);
    if (!has(tools, lane.tool)) err("ref", `${where}.tool`, `"${lane.tool}" is not in tools`);
    if (lane.enforcesToolLimits === true && !ENFORCING_RUNNERS.has(lane.tool)) {
      err("tool-limits", `${where}.enforcesToolLimits`, `the ${lane.tool} runner does not hold a reading step read-only on this engine; only ${[...ENFORCING_RUNNERS].join(", ")} does`);
    }
    if (typeof lane.vendor !== "string" || !SLUG.test(lane.vendor)) err("shape", `${where}.vendor`, "must be a lower-case slug");
    if (!TIERS.includes(lane.tier)) err("shape", `${where}.tier`, `must be one of ${TIERS.join(", ")}`);
    for (const tag of TAGS) if (typeof lane[tag] !== "boolean") err("shape", `${where}.${tag}`, "is missing; a lane with an untagged property is rejected until it is tagged");
    if (lane.enabled !== undefined && typeof lane.enabled !== "boolean") err("shape", `${where}.enabled`, "must be true or false");
    if (lane.engineModel !== undefined && (typeof lane.engineModel !== "string" || !/^[A-Za-z0-9._/:[\]-]+$/.test(lane.engineModel))) err("shape", `${where}.engineModel`, "is not a model name");
    texts(lane.notes, `${where}.notes`);
  }

  // rows, first pass: identity
  const rows = Array.isArray(file.rows) ? file.rows.filter(isObj) : [];
  if (!Array.isArray(file.rows) || !rows.length) err("shape", "rows", "must hold at least one row");
  else if (rows.length !== file.rows.length) err("shape", "rows", "holds an entry that is not an object");
  const rowIds = new Set();
  for (const row of rows) {
    if (typeof row.id !== "string" || !SLUG.test(row.id)) err("shape", "rows", `a row id "${row.id}" is not a slug`);
    else if (rowIds.has(row.id)) err("shape", `rows.${row.id}`, "is defined twice");
    rowIds.add(row.id);
  }
  const rowById = Object.fromEntries(rows.filter((r) => typeof r.id === "string").map((r) => [r.id, r]));

  // reserved lanes
  const reserved = isObj(file.reservedLanes) ? file.reservedLanes : {};
  if (!isObj(file.reservedLanes)) err("shape", "reservedLanes", "is missing (an empty object means none)");
  for (const [id, r] of Object.entries(reserved)) {
    const where = `reservedLanes.${id}`;
    if (!has(lanes, id)) err("ref", where, "is not a lane");
    if (!isObj(r)) { err("shape", where, "must be an object"); continue; }
    unknown(r, KNOWN.reserved, where);
    if (typeof r.escalation !== "boolean") err("shape", `${where}.escalation`, "must be true or false");
    if (!isStrArr(r.rows) || twice(r.rows)) err("shape", `${where}.rows`, "must be a list of row ids, each once");
    else for (const rid of r.rows) if (!rowIds.has(rid)) err("ref", `${where}.rows`, `"${rid}" is not a row`);
  }

  // global bans
  const bans = Array.isArray(file.globalBans) ? file.globalBans : [];
  if (!bans.length) err("shape", "globalBans", "must hold at least one ban");
  const banIds = new Set();
  bans.forEach((ban, i) => {
    const where = `globalBans[${i}]`;
    if (!isObj(ban)) return err("shape", where, "must be an object");
    unknown(ban, KNOWN.globalBan, where);
    if (typeof ban.id !== "string" || !SLUG.test(ban.id)) err("shape", `${where}.id`, "must be a slug");
    else if (banIds.has(ban.id)) err("shape", `${where}.id`, `"${ban.id}" is defined twice`);
    banIds.add(ban.id);
    if (!["file", "dispatch", "merge"].includes(ban.checkedAt)) err("shape", `${where}.checkedAt`, "must be file, dispatch or merge");
    text(ban.rule, `${where}.rule`);
  });
  for (const id of FILE_BANS) {
    const ban = bans.find((b) => isObj(b) && b.id === id);
    if (!ban) err("ref", "globalBans", `must state "${id}"; the route check enforces it, and the leader must be able to read it`);
    else if (ban.checkedAt !== "file") err("shape", "globalBans", `"${id}" is enforced by this check, so its checkedAt is file`);
  }

  text(file.tieRule, "tieRule");
  if (!isObj(file.noMatch)) err("shape", "noMatch", "is missing");
  else {
    unknown(file.noMatch, KNOWN.noMatch, "noMatch");
    if (file.noMatch.attended !== "ask-owner") err("shape", "noMatch.attended", 'must be "ask-owner"');
    if (file.noMatch.unattended !== "park") err("shape", "noMatch.unattended", 'must be "park"');
    text(file.noMatch.rule, "noMatch.rule");
  }

  // look-alikes
  if (!Array.isArray(file.lookAlikes)) err("shape", "lookAlikes", "must be a list");
  (Array.isArray(file.lookAlikes) ? file.lookAlikes : []).forEach((l, i) => {
    const where = `lookAlikes[${i}]`;
    if (!isObj(l)) return err("shape", where, "must be an object");
    unknown(l, KNOWN.lookAlike, where);
    if (!isStrArr(l.rows) || l.rows.length < 2 || twice(l.rows)) err("shape", `${where}.rows`, "must name two rows or more, each once");
    else for (const rid of l.rows) if (!rowIds.has(rid)) err("ref", `${where}.rows`, `"${rid}" is not a row`);
    text(l.rule, `${where}.rule`);
    text(l.test, `${where}.test`, false);
  });

  // rows, second pass: everything else
  const securityRow = (row) => isSecurityRow(rowById, row);
  for (const row of rows) {
    const where = `rows.${row.id}`;
    unknown(row, KNOWN.row, where);
    text(row.title, `${where}.title`);
    text(row.trigger, `${where}.trigger`);
    texts(row.notes, `${where}.notes`);
    if (!CLASSES.includes(row.class)) err("shape", `${where}.class`, `must be one of ${CLASSES.join(", ")}`);
    if (typeof row.writes !== "boolean") err("shape", `${where}.writes`, "must be true or false");
    if (row.runsCode !== undefined && (typeof row.runsCode !== "boolean" || (row.runsCode === true && row.writes !== false))) err("shape", `${where}.runsCode`, "is true or false, and true only on a row with writes: false");
    if (!isStrArr(row.workflows) || !row.workflows.length || !row.workflows.every((w) => /^[a-z0-9]+(-[a-z0-9]+)*\.yaml$/.test(w)) || twice(row.workflows)) err("shape", `${where}.workflows`, "must list workflow file names, each once");
    if (row.narrows !== undefined) {
      if (row.narrows === row.id || !rowIds.has(row.narrows)) err("ref", `${where}.narrows`, `"${row.narrows}" is not another row`);
      else if (narrowChain(rowById, row) === null) err("ref", `${where}.narrows`, "leads back to this row; a narrowing chain must end");
    }
    if (isStrArr(row.workflows) && row.workflows.some((w) => SECURITY_WORKFLOWS.has(w)) && row.class !== "security-and-release") {
      err("security-minimum", `${where}.class`, "runs a security or release workflow, so its class is security-and-release");
    }
    if (row.alsoDispatch !== undefined) {
      if (!isStrArr(row.alsoDispatch) || twice(row.alsoDispatch)) err("shape", `${where}.alsoDispatch`, "must be a list of row ids, each once");
      else for (const rid of row.alsoDispatch) if (rid === row.id || !rowIds.has(rid)) err("ref", `${where}.alsoDispatch`, `"${rid}" is not another row`);
    }
    for (const flag of ["neverAuthor", "neverClaimant"]) if (row[flag] !== undefined && typeof row[flag] !== "boolean") err("shape", `${where}.${flag}`, "must be true or false");

    // never entries
    const never = row.never ?? [];
    if (!Array.isArray(never)) err("shape", `${where}.never`, "must be a list");
    const nevers = Array.isArray(never) ? never.filter(isObj) : [];
    if (Array.isArray(never) && nevers.length !== never.length) err("shape", `${where}.never`, "holds an entry that is not an object");
    nevers.forEach((entry, i) => {
      const w = `${where}.never[${i}]`;
      unknown(entry, KNOWN.match, w);
      const keys = matchKeys(entry);
      if (!keys.length) err("shape", w, `names no match key (${MATCH_KEYS.join(", ")}); an entry that matches nothing is not a ban`);
      if (keys.includes("lane") && !has(lanes, entry.lane)) err("ref", `${w}.lane`, `"${entry.lane}" is not a lane`);
      if (keys.includes("tool") && !RUNNERS.includes(entry.tool)) err("ref", `${w}.tool`, `"${entry.tool}" is not a runner`);
      if (keys.includes("vendor") && (typeof entry.vendor !== "string" || !SLUG.test(entry.vendor))) err("shape", `${w}.vendor`, "must be a lower-case slug");
      if (keys.includes("tier") && !TIERS.includes(entry.tier)) err("shape", `${w}.tier`, "is not a tier");
      for (const tag of TAGS) if (keys.includes(tag) && typeof entry[tag] !== "boolean") err("shape", `${w}.${tag}`, "must be true or false");
      text(entry.why, `${w}.why`, false);
    });

    // the order
    if (row.handledBy !== undefined) {
      if (row.handledBy !== "leader") err("shape", `${where}.handledBy`, 'can only be "leader"');
      if (!Array.isArray(row.lanes) || row.lanes.length) err("shape", `${where}.lanes`, "must be an empty list on a row the leader handles itself");
      if (securityRow(row)) err("security-minimum", where, "a security or release row is never handled by the leader itself");
      continue;
    }
    if (!isStrArr(row.lanes) || !row.lanes.length) { err("shape", `${where}.lanes`, "must name at least one lane"); continue; }
    if (twice(row.lanes)) err("shape", `${where}.lanes`, "names a lane twice");
    if (securityRow(row) && row.neverAuthor !== true) err("security-minimum", where, "a security or release row, or one that narrows one, keeps neverAuthor: true");

    const judge = (id, w, { advisory = false } = {}) => {
      if (!has(lanes, id) || !isObj(lanes[id])) return err("ref", w, `"${id}" is not a lane`);
      if (has(reserved, id) && !(isStrArr(reserved[id].rows) ? reserved[id].rows : []).includes(row.id)) err("reserved", w, `"${id}" is reserved and this row is not one of its rows`);
      for (const [code, message] of banReasons(rowById, row, id, lanes[id], { advisory })) err(code, w, message);
    };
    row.lanes.forEach((id, i) => judge(id, `${where}.lanes[${i}]`));

    if (row.secondOpinion !== undefined) {
      const so = row.secondOpinion;
      const w = `${where}.secondOpinion`;
      if (!isObj(so)) err("shape", w, "must be an object");
      else {
        unknown(so, KNOWN.secondOpinion, w);
        if (!["always", "risk-high"].includes(so.when)) err("shape", `${w}.when`, "must be always or risk-high");
        if (!isStrArr(so.lanes) || !so.lanes.length) err("shape", `${w}.lanes`, "must name at least one lane");
        else if (twice(so.lanes)) err("shape", `${w}.lanes`, "names a lane twice");
        else so.lanes.forEach((id, i) => judge(id, `${w}.lanes[${i}]`, { advisory: true }));
      }
    }
  }
  return { errors, warnings };
}

// --- Reading the file ---------------------------------------------------------------------------
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const repoRoot = (cwd) => {
  try { return git(cwd, ["rev-parse", "--show-toplevel"]); } catch { return cwd; }
};
const localBase = (root) => {
  try { return JSON.parse(readFileSync(join(root, ".xezar/config.json"), "utf8")).baseBranch; } catch { return undefined; }
};

// The remote's default branch, as `config-guard.sh --from-base` finds it, and nothing else: no local
// branch and no fallback to this checkout's own config, which a branch under review may edit. The
// ref is spelled in full, so a local branch named `origin/main` cannot stand in for it.
function readBase(root) {
  let remote = "";
  try { remote = git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).replace(/^origin\//, ""); } catch { remote = ""; }
  if (!remote) throw new Error("the remote default branch is unknown here (refs/remotes/origin/HEAD is not set), and routing is never read from this checkout alone. Run: git remote set-head origin --auto");
  if (!BRANCH.test(remote)) throw new Error("the remote default branch name is not a plain branch name");
  const configured = localBase(root);
  if (configured !== undefined && configured !== remote) {
    throw new Error(`this checkout says the base branch is "${configured}" and the remote says "${remote}". Routing is trusted from the remote default branch only; a checkout that names another base is refused, not believed.`);
  }
  const rev = `refs/remotes/origin/${remote}`;
  let text;
  try { text = git(root, ["show", `${rev}:.xezar/routing.json`]); } catch {
    throw new Error(`cannot read origin/${remote}:.xezar/routing.json; routing is read from the base branch, so merge it there first (or pass --file during onboarding)`);
  }
  return { text, source: `origin/${remote}:.xezar/routing.json` };
}

// --- What is usable on this machine, now --------------------------------------------------------
function installedPrograms() {
  const hook = process.env.KIT_TEST_ROUTE_TOOLS;
  if (hook !== undefined) return new Set(hook.split(",").map((s) => s.trim()).filter(Boolean));
  const found = new Set();
  for (const program of Object.values(PROGRAM)) {
    for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      try { accessSync(join(dir, program), constants.X_OK); found.add(program); break; } catch { /* next */ }
    }
  }
  return found;
}

// The engine's account file: the project's own in single-project mode (`.xezar/workspace.json`
// present), otherwise the global one under `$XEZ_HOME` or `~/.xezar`. Only ids and runners are read.
export function accountsPath(root) {
  if (existsSync(join(root, ".xezar/workspace.json"))) return join(root, ".xezar/agent-accounts.json");
  return join(process.env.XEZ_HOME || join(homedir(), ".xezar"), "agent-accounts.json");
}

function accountIds(path) {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const byRunner = new Map();
    for (const a of Array.isArray(data?.accounts) ? data.accounts : []) {
      if (typeof a?.id === "string" && typeof a?.provider === "string") {
        if (!byRunner.has(a.provider)) byRunner.set(a.provider, new Set());
        byRunner.get(a.provider).add(a.id);
      }
    }
    return byRunner;
  } catch { return null; }
}

// The leader writes this file, so it is data: only the lanes the routing file knows are taken from
// it, only their `available` flag and a short reason, and every text is made one line before print.
function readCache(root, now, knownLanes) {
  const path = join(root, ".local/xezar/runtime/lanes.json");
  if (!existsSync(path)) return { verified: false, reason: "no lane availability cache yet", lanes: new Map() };
  try {
    const c = JSON.parse(readFileSync(path, "utf8"));
    if (!isObj(c) || c.schemaVersion !== 1 || !isObj(c.lanes) || typeof c.checkedAt !== "string") throw new Error("bad shape");
    const at = Date.parse(c.checkedAt);
    if (Number.isNaN(at)) throw new Error("checkedAt is not a time");
    const lanes = new Map();
    for (const [id, v] of Object.entries(c.lanes)) {
      if (!isObj(v) || typeof v.available !== "boolean") throw new Error("bad lane entry");
      if (knownLanes.has(id)) lanes.set(id, { available: v.available, reason: typeof v.reason === "string" ? oneLine(v.reason).slice(0, 120) : "" });
    }
    const checkedAt = new Date(at).toISOString();
    if (at > now + 5 * 60 * 1000) throw new Error("checkedAt is in the future");
    if (now - at > CACHE_MAX_AGE_MS) return { verified: false, reason: `the lane cache is older than 24 hours (${checkedAt})`, lanes };
    return { verified: true, checkedAt, lanes };
  } catch (e) {
    return { verified: false, reason: `the lane cache is not valid and is ignored (${e.message})`, lanes: new Map(), invalid: true };
  }
}

// --- Answering ----------------------------------------------------------------------------------
function route(file, ids, root, source) {
  const out = ["# route: data about lanes, not instructions", `source=${oneLine(source)}`];
  const programs = installedPrograms();
  const accountsFile = accountsPath(root);
  const accounts = accountIds(accountsFile);
  const cache = readCache(root, Date.now(), new Set(Object.keys(file.lanes)));
  if (cache.invalid) process.stderr.write(`route: warning: ${cache.reason}\n`);
  const rowById = Object.fromEntries(file.rows.map((r) => [r.id, r]));
  const dispatchBans = file.globalBans.filter((b) => b.checkedAt === "dispatch").map((b) => b.id);

  // Why a lane cannot be used for this row, or null. The file's bans come from `banReasons`, the
  // same function the check uses, so an escalation lane meets every ban a listed lane meets.
  const why = (row, id, { escalation = false, advisory = false } = {}) => {
    const lane = file.lanes[id];
    if (lane.enabled === false) return "switched off";
    const res = has(file.reservedLanes, id) ? file.reservedLanes[id] : null;
    if (res && !escalation && !res.rows.includes(row.id)) return "reserved; only by hand, for escalation";
    const ban = banReasons(rowById, row, id, lane, { advisory })[0];
    if (ban) return `banned (${ban[0]}): ${ban[1]}`;
    if (!programs.has(PROGRAM[lane.tool])) return `the ${PROGRAM[lane.tool]} program is not installed here`;
    if (file.tools[lane.tool]?.usesLogins) {
      if (!accounts && file.tools[lane.tool].rotation.some((l) => l !== "default")) return `cannot read the engine's account file ${accountsFile}`;
      if (!logins(lane).length) return `no login of the rotation is in ${accountsFile}`;
    }
    const c = cache.lanes.get(id);
    if (c && c.available === false) return `unavailable in the lane cache${c.reason ? `: ${c.reason}` : ""}`;
    return null;
  };
  const logins = (lane) => {
    const tool = file.tools[lane.tool];
    if (!tool?.usesLogins) return [];
    const have = accounts?.get(lane.tool) ?? new Set();
    return tool.rotation.filter((l) => have.has(l) || (l === "default" && lane.tool !== file.leader?.tool));
  };
  const line = (name, id) => {
    const lane = file.lanes[id];
    const l = logins(lane);
    return `${name}=${id} runner=${lane.tool} model=${lane.engineModel ?? lane.model}${l.length ? ` logins=${l.join(",")}` : ""}`;
  };

  for (const id of ids) {
    if (!has(rowById, id)) throw new Error(`"${oneLine(id).slice(0, 80)}" is not a row; run --rows for the list`);
    const row = rowById[id];
    out.push(`row=${row.id} class=${row.class} writes=${row.writes}`);
    if (row.handledBy) { out.push(`handled-by=${row.handledBy}`); continue; }
    for (const w of row.workflows) out.push(`workflow=${w.replace(/\.yaml$/, "")}`);
    out.push(cache.verified ? `availability=verified checkedAt=${cache.checkedAt}` : `availability=unverified reason=${cache.reason}`);
    const security = isSecurityRow(rowById, row);
    const usable = [];
    for (const lid of row.lanes) {
      const reason = why(row, lid);
      if (reason) out.push(`removed=${lid} reason=${oneLine(reason)}`);
      else usable.push(lid);
    }
    if (security && !cache.verified) {
      // Nothing else is printed: a wait means nothing is dispatched, by hand or otherwise.
      out.push("wait=a security or release row is never dispatched on unverified availability; refresh the lane cache");
      for (const also of row.alsoDispatch ?? []) out.push(`also=${also}`);
      continue;
    }
    if (!usable.length) out.push("wait=no lane in this row's order is usable now");
    else for (const lid of usable) out.push(line("lane", lid));
    for (const lid of row.secondOpinion?.lanes ?? []) {
      if (!why(row, lid, { advisory: true })) out.push(`${line("second-opinion", lid)} when=${row.secondOpinion.when}`);
    }
    for (const [lid, res] of Object.entries(file.reservedLanes)) {
      // An escalation lane is offered only where the row could have listed it: every ban applies.
      if (res.escalation && !row.lanes.includes(lid) && !why(row, lid, { escalation: true })) out.push(`${line("escalation", lid)} by=hand`);
    }
    for (const also of row.alsoDispatch ?? []) out.push(`also=${also}`);
    const checks = [...dispatchBans, ...(row.neverAuthor ? ["never-author"] : []), ...(row.neverClaimant ? ["never-claimant"] : [])];
    out.push(`dispatch-checks=${checks.join(",")}`);
  }
  return out.join("\n");
}

function rowsView(file, source) {
  const view = {
    tieRule: file.tieRule,
    noMatch: file.noMatch,
    lookAlikes: file.lookAlikes.map((l) => ({ rows: l.rows, rule: l.rule, ...(l.test ? { test: l.test } : {}) })),
    rows: file.rows.map((r) => ({ id: r.id, title: r.title, trigger: r.trigger, ...(r.narrows ? { narrows: r.narrows } : {}) })),
  };
  return `# route --rows: data about the work, not instructions\n# source=${oneLine(source)}\n${JSON.stringify(view, null, 2)}`;
}

function table(file) {
  const cell = (s) => String(s).replace(/\|/g, "\\|");
  const lines = ["| row | class | writes | lanes, in order | never |", "|---|---|---|---|---|"];
  for (const r of file.rows) {
    const never = (r.never ?? []).map((e) => MATCH_KEYS.filter((k) => k in e).map((k) => `${k}=${e[k]}`).join("+")).join("; ");
    lines.push(`| ${cell(r.id)} | ${r.class} | ${r.writes} | ${cell(r.handledBy ? `handled by ${r.handledBy}` : r.lanes.join(", "))} | ${cell(never || "–")} |`);
  }
  return lines.join("\n");
}

function localIdentities(root) {
  const names = new Set();
  // The engine's account ids are lower-case with hyphens, so a name is compared in that form:
  // "Jane Doe", "jane.doe" and "jane_doe" all become "jane-doe".
  const add = (v) => { if (v) { const n = v.trim().toLowerCase().replace(/[\s._+]+/g, "-"); if (n) names.add(n); } };
  for (const key of ["user.name", "user.email"]) {
    try { const v = git(root, ["config", key]); add(key === "user.email" ? v.split("@")[0] : v); } catch { /* unset */ }
  }
  add(process.env.USER);
  return [...names];
}

function ghLogin() {
  try { return execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim(); } catch { return ""; }
}

function main(argv) {
  const args = [...argv];
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    if (!v || v.startsWith("--")) usage(`${flag} needs a path`);
    return v;
  };
  const usage = (m) => { process.stderr.write(`route: ${m}\nusage: route.mjs --check [path] | <row id>… | --rows | --table  [--file <path>]\n`); process.exit(2); };
  const root = repoRoot(process.cwd());
  const filePath = take("--file");

  if (args[0] === "--check") {
    const path = resolve(args[1] ?? filePath ?? join(root, ".xezar/routing.json"));
    let file;
    try { file = JSON.parse(readFileSync(path, "utf8")); } catch (e) {
      process.stderr.write(`route: error [shape] ${path}: cannot be read as JSON (${e.message})\n`);
      process.exit(1);
    }
    const identities = localIdentities(root);
    const gh = ghLogin();
    if (gh) identities.push(gh.toLowerCase().replace(/[\s._+]+/g, "-"));
    const { errors, warnings } = check(file, { identities });
    for (const w of warnings) process.stderr.write(`route: warning: ${w}\n`);
    for (const e of errors) process.stderr.write(`route: error ${e}\n`);
    if (errors.length) { process.stderr.write(`route: ${path} is refused (${errors.length} error(s))\n`); process.exit(1); }
    console.log(`route: ok – ${path} (${file.rows.length} rows, ${Object.keys(file.lanes).length} lanes)`);
    return;
  }
  if (!args.length) usage("say what to answer");

  let source;
  try {
    if (filePath) {
      source = { text: readFileSync(resolve(filePath), "utf8"), source: `unmerged ${filePath}`, note: `unmerged: read ${filePath} from the working tree, not the base branch` };
    } else {
      source = readBase(root);
    }
  } catch (e) {
    process.stderr.write(`route: refused – ${e.message}\n`);
    process.exit(1);
  }
  if (source.note) process.stderr.write(`route: warning: ${source.note}\n`);
  let file;
  try { file = JSON.parse(source.text); } catch { process.stderr.write(`route: refused – ${source.source} is not valid JSON\n`); process.exit(1); }
  const { errors } = check(file, { identities: localIdentities(root) });
  if (errors.length) {
    for (const e of errors) process.stderr.write(`route: error ${e}\n`);
    process.stderr.write(`route: refused – ${source.source} fails its check; nothing is routed from a file that fails it\n`);
    process.exit(1);
  }
  try {
    if (args[0] === "--rows") console.log(rowsView(file, source.source));
    else if (args[0] === "--table") console.log(table(file));
    else if (args[0].startsWith("--")) usage(`unknown option ${args[0]}`);
    else console.log(route(file, args, root, source.source));
  } catch (e) {
    process.stderr.write(`route: refused – ${e.message}\n`);
    process.exit(1);
  }
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main(process.argv.slice(2));

#!/usr/bin/env node
// Dependency units: the installs of a repository that has no single root manifest.
//
//   deps.mjs mode        --root <dir>   "units" or "single"; exit 2 when the units are refused
//   deps.mjs units       --root <dir>   the validated units, as JSON
//   deps.mjs install     --root <dir>   install every unit, one after another (deps-restore.sh)
//   deps.mjs tools       --root <dir>   check each unit's tool and the Node pin; print the facts
//   deps.mjs node-pin    --root <dir>   the nvm bin folder to put first on PATH, or nothing
//   deps.mjs fingerprint --root <dir>   one digest over every unit's inputs
//   deps.mjs stamp       --root <dir>   record every unit as installed for this task
//   deps.mjs fresh       --root <dir>   exit 0 when every stamp matches and every install is this task's own
//   deps.mjs resolve     --root <dir>   exit 0 when every install is this task's own; problems on stderr
//   deps.mjs versions    --root <dir>   the unit tools' versions as JSON, for the gate record
//
// WHERE THE UNITS COME FROM. `dependencies.units` in `.xezar/pipeline/config.json`, read from the
// BASE BRANCH (`origin/<remote default>`), the way `route.mjs` reads routing: what gets installed
// runs code, so a branch under review must not be able to choose it. A checkout whose
// `.xezar/config.json` names another base is refused, not believed. Absent key = the single npm
// root the kit always had, and `lib/common.sh` then takes its old path unchanged.
//
// WHAT IS INSTALLED. The install map below, as argv arrays run with `spawnSync` and never through
// a shell. npm: `npm ci`. Yarn 1 only, checked per unit: Yarn 2 or later is refused by name, since
// its flags, lockfile and install layout are different tools. dotnet: `restore <entry>`, with
// `--locked-mode` when a project carries `packages.lock.json`. Lifecycle scripts run, as `npm ci`
// always did here (DECISIONS.md -> "Dependency units").
//
// WHAT "FRESH" MEANS. A stamp per unit under `.local/xezar/cache/deps/`, holding the unit's input
// fingerprint, this task's own path and the identity of the installed tree (a nonce written into
// node_modules at stamp time, plus that folder's inode), AND a proof that the install on disk is this task's own:
// a worktree sits inside the primary checkout, and an install borrowed from an ancestor silently
// judges another checkout (#286). A unit that cannot be found is a failure, never a skip.
//
// Output is data. Exit: 0 ok, 1 not fresh / failed, 2 refused or usage.

import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const CONFIG = ".xezar/pipeline/config.json";
const STAMPS = ".local/xezar/cache/deps";
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const LOCKFILES = { npm: ["package-lock.json", "npm-shrinkwrap.json"], yarn: ["yarn.lock"] };
const UNIT_KEYS = ["dir", "provider", "lockfile", "entry"];

class Refusal extends Error {}

// --- small helpers --------------------------------------------------------------------------
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const lstat = (p) => { try { return lstatSync(p); } catch { return null; } };
const real = (p) => { try { return realpathSync(p); } catch { return null; } };
const isFile = (p) => lstat(p)?.isFile() === true;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const executable = (p) => { try { accessSync(p, constants.X_OK); return lstat(p) !== null; } catch { return false; } };

// Refuse symlink traversal: every component of `rel` under `base` must be a real file or folder
// (or not exist yet). The same rule as `safeParents` in lib/bootstrap.mjs, which is a script and
// cannot be imported without running it.
function safeParents(base, rel) {
  let cur = base;
  for (const part of rel.split("/")) {
    if (part === "." || part === "") continue;
    cur = join(cur, part);
    if (lstat(cur)?.isSymbolicLink()) throw new Refusal(`symlink refused: ${rel} (${relative(base, cur)} is a symbolic link)`);
  }
}

// The first line a tool prints for `--version`, or "unknown". Run in the unit's folder: Yarn 1
// honours a `.yarnrc` there, and dotnet a `global.json`.
function version(tool, cwd) {
  if (!tool) return "unknown";
  const r = spawnSync(tool, ["--version"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim().split("\n")[0].trim() : "unknown";
}

// dotnet is often installed off PATH (`dotnet-install.sh` puts it in ~/.dotnet). Both fallbacks
// are absolute paths outside the repository, never a repository-local binary.
function dotnetBin() {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && isAbsolute(dir) && executable(join(dir, "dotnet"))) return join(dir, "dotnet");
  }
  for (const dir of [process.env.DOTNET_ROOT, join(homedir(), ".dotnet")]) {
    if (dir && isAbsolute(dir) && executable(join(dir, "dotnet"))) return join(dir, "dotnet");
  }
  return null;
}

// --- which units --------------------------------------------------------------------------
function readBase(root) {
  let configured;
  const kit = join(root, ".xezar/config.json");
  if (lstat(kit)) {
    try {
      const value = JSON.parse(readFileSync(kit, "utf8")).baseBranch;
      configured = typeof value === "string" ? value.trim() : undefined;
    } catch { return { error: `${kit} is not valid JSON, so the base branch is unknown` }; }
  }
  let remote = "";
  try { remote = git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).replace(/^origin\//, ""); } catch { remote = ""; }
  if (!remote) return { error: "the remote default branch is unknown here (refs/remotes/origin/HEAD is not set; run: git remote set-head origin --auto)" };
  if (!BRANCH.test(remote)) return { error: "the remote default branch name is not a plain branch name" };
  if (configured && configured !== remote) {
    return { error: `this checkout says the base branch is "${configured}" and the remote says "${remote}"; a checkout that names another base is refused, not believed` };
  }
  const source = `origin/${remote}:${CONFIG}`;
  let text;
  try { text = git(root, ["show", `refs/remotes/origin/${remote}:${CONFIG}`]); } catch { return { error: `cannot read ${source}` }; }
  try { return { config: JSON.parse(text), source }; } catch { return { error: `${source} is not valid JSON` }; }
}

function cleanDir(dir, at) {
  if (typeof dir !== "string" || dir === "") throw new Refusal(`${at}.dir must be a folder relative to the repository root`);
  if (dir === ".") return dir;
  const parts = dir.split("/");
  if (isAbsolute(dir) || dir.includes("\\") || parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Refusal(`${at}.dir "${dir}" must be a plain relative folder inside the repository (no "..", no leading or doubled "/")`);
  }
  return dir;
}

const slug = (dir) => `${dir === "." ? "root" : dir.replace(/[^A-Za-z0-9._-]/g, "_")}-${sha256(dir).slice(0, 8)}`;

function validate(root, units, config, source) {
  const where = `${source} dependencies.units`;
  if (!Array.isArray(units) || units.length === 0) {
    throw new Refusal(`${where} must be a non-empty list; leave the key out for a single npm root`);
  }
  const seen = new Set();
  const out = units.map((u, i) => {
    const at = `${where}[${i}]`;
    if (!u || typeof u !== "object" || Array.isArray(u)) throw new Refusal(`${at} is not an object`);
    for (const key of Object.keys(u)) if (!UNIT_KEYS.includes(key)) throw new Refusal(`${at} has an unknown key "${key}"`);
    if (!["npm", "yarn", "dotnet"].includes(u.provider)) {
      throw new Refusal(`${at}.provider "${u.provider}" is not one this kit installs (npm, yarn, dotnet)`);
    }
    const dir = cleanDir(u.dir, at);
    if (seen.has(dir)) throw new Refusal(`${at}.dir "${dir}" is listed twice`);
    seen.add(dir);
    let lockfile;
    let entry;
    if (u.provider === "dotnet") {
      if (u.lockfile !== undefined) throw new Refusal(`${at}.lockfile is not used by dotnet (packages.lock.json is found per project)`);
      if (typeof u.entry !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.slnx?$/.test(u.entry)) {
        throw new Refusal(`${at}.entry must be a plain .sln or .slnx file name inside ${dir}`);
      }
      entry = u.entry;
    } else {
      if (u.entry !== undefined) throw new Refusal(`${at}.entry is only for a dotnet unit`);
      lockfile = u.lockfile ?? LOCKFILES[u.provider][0];
      if (!LOCKFILES[u.provider].includes(lockfile)) {
        throw new Refusal(`${at}.lockfile "${lockfile}" is not a ${u.provider} lockfile (${LOCKFILES[u.provider].join(", ")})`);
      }
    }
    for (const rel of [dir, lockfile && `${dir}/${lockfile}`, entry && `${dir}/${entry}`]) if (rel) safeParents(root, rel);
    return { dir, provider: u.provider, ...(lockfile ? { lockfile } : {}), ...(entry ? { entry } : {}), slug: slug(dir) };
  });
  // The first gate is checked where it runs (repo-gates.sh refuses any other install gate), not
  // here: requiring it on the base branch too would leave no order in which a project can adopt units.
  return out;
}

// null = no units (the single npm root). Throws Refusal when units exist and cannot be trusted.
function loadUnits(root) {
  const base = readBase(root);
  if (base.error) {
    let local = null;
    try { local = JSON.parse(readFileSync(join(root, CONFIG), "utf8")); } catch { local = null; }
    if (local?.dependencies?.units !== undefined) {
      throw new Refusal(`${base.error}. dependencies.units is read from the base branch only, so a branch cannot change what gets installed; merge the units there first`);
    }
    return null;
  }
  const units = base.config?.dependencies?.units;
  return units === undefined ? null : validate(root, units, base.config, base.source);
}

// --- Node -----------------------------------------------------------------------------------
// Only a NUMERIC root .nvmrc pins (`22`, `v22.3.0`): an nvm alias needs nvm to resolve, and nvm is
// never sourced here. The pin is the major version.
function nodePin(root) {
  const file = join(root, ".nvmrc");
  if (!isFile(file)) return { kind: "none" };
  const raw = readFileSync(file, "utf8").trim();
  const m = /^v?(\d+)(?:\.\d+){0,2}$/.exec(raw);
  return m ? { kind: "major", major: Number(m[1]) } : { kind: "alias", raw };
}

const nvmVersions = () => join(process.env.NVM_DIR || join(homedir(), ".nvm"), "versions", "node");

// The numerically newest installed v<major>.x.y (v22.10.0 beats v22.9.0), already on disk.
function nvmBin(major) {
  let names = [];
  try { names = readdirSync(nvmVersions()); } catch { return null; }
  const found = names
    .map((name) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(name))
    .filter((m) => m && Number(m[1]) === major)
    .sort((a, b) => Number(b[2]) - Number(a[2]) || Number(b[3]) - Number(a[3]));
  for (const m of found) {
    const bin = join(nvmVersions(), m[0], "bin");
    if (executable(join(bin, "node"))) return bin;
  }
  return null;
}

const nodeMajor = () => Number(process.versions.node.split(".")[0]);

// --- Yarn 1 only ------------------------------------------------------------------------------
function yarnVersion(root, u) {
  const dir = join(root, u.dir);
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { pkg = {}; }
  const pm = typeof pkg.packageManager === "string" ? /^yarn@(\d+)/.exec(pkg.packageManager) : null;
  if (pm && Number(pm[1]) >= 2) {
    throw new Refusal(`${u.dir}: package.json asks for ${pkg.packageManager}, which is Yarn 2 or later; this kit installs Yarn 1 only`);
  }
  for (let d = dir; ; d = dirname(d)) {
    if (lstat(join(d, ".yarnrc.yml"))) {
      throw new Refusal(`${u.dir}: ${relative(root, join(d, ".yarnrc.yml")) || ".yarnrc.yml"} is Yarn 2 or later configuration; this kit installs Yarn 1 only`);
    }
    if (d === root || d === dirname(d)) break;
  }
  const v = version("yarn", dir);
  const m = /^(\d+)\./.exec(v);
  if (!m) throw new Refusal(`${u.dir}: the Yarn version answered "${v}", so which Yarn this is cannot be told; install Yarn 1 (1.22.x) under this Node`);
  if (Number(m[1]) >= 2) throw new Refusal(`${u.dir}: Yarn ${v} is Yarn 2 or later; this kit installs Yarn 1 only`);
  return v;
}

// --- the install map ------------------------------------------------------------------------
function findFiles(dir, match, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!["bin", "obj", "node_modules", ".git"].includes(e.name)) findFiles(p, match, out);
    } else if (e.isFile() && match(e.name)) out.push(p);
  }
  return out;
}

const INSTALL = {
  npm: () => ({ tool: "npm", args: ["ci"], env: {} }),
  yarn: () => ({ tool: "yarn", args: ["install", "--frozen-lockfile", "--non-interactive"], env: { HUSKY: "0" } }),
  dotnet: (root, u) => {
    const locked = findFiles(join(root, u.dir), (n) => n === "packages.lock.json").length > 0;
    return { tool: dotnetBin(), args: ["restore", u.entry, ...(locked ? ["--locked-mode"] : [])], env: {} };
  },
};

// A unit that cannot be found is a FAILURE, never a skip: "nothing to install here" and "the
// folder this unit names is gone" must not read the same.
const unresolvable = (problems, u, why) => { problems.push(`  ${u.dir}: ${why}, so this unit cannot be installed or resolved`); };

function presence(root, u, problems) {
  const dir = join(root, u.dir);
  if (!lstat(dir)?.isDirectory()) return unresolvable(problems, u, "the folder does not exist");
  if (u.provider === "dotnet") {
    if (!isFile(join(dir, u.entry))) return unresolvable(problems, u, `there is no ${u.entry}`);
    if (findFiles(dir, (n) => n.endsWith(".csproj")).length === 0) return unresolvable(problems, u, "there is no .csproj under it");
    return;
  }
  if (!isFile(join(dir, "package.json"))) return unresolvable(problems, u, "there is no package.json");
  if (!isFile(join(dir, u.lockfile))) return unresolvable(problems, u, `there is no ${u.lockfile}`);
}

// The projects a dotnet unit's solution builds, as absolute paths: `.sln` lines
// `Project("{type}") = "Name", "rel\path\X.csproj", "{guid}"`, and `.slnx` `<Project Path="…"/>`.
// A listed project may sit outside the unit folder; the fingerprint and the ownership proof cover
// it all the same, since the gate builds it.
function solutionProjects(root, u) {
  const dir = join(root, u.dir);
  let text = "";
  try { text = readFileSync(join(dir, u.entry), "utf8"); } catch { return []; }
  const rels = u.entry.endsWith(".slnx")
    ? [...text.matchAll(/<Project\b[^>]*\bPath\s*=\s*"([^"]+)"/g)].map((m) => m[1])
    : [...text.matchAll(/^\s*Project\("[^"]*"\)\s*=\s*"[^"]*"\s*,\s*"([^"]+)"/gm)].map((m) => m[1]);
  return [...new Set(rels.filter((r) => r.toLowerCase().endsWith(".csproj")).map((r) => resolve(dir, r.replace(/\\/g, "/"))))].sort();
}

// Every .csproj under the unit, plus every project its solution lists.
const dotnetProjects = (root, u) =>
  [...new Set([...findFiles(join(root, u.dir), (n) => n.endsWith(".csproj")), ...solutionProjects(root, u)])].sort();

// --- fingerprints and stamps ------------------------------------------------------------------
// The files an install resolves from, repo-relative. Config files that apply from above the unit
// (Yarn and npm read .yarnrc/.npmrc up the tree; MSBuild and NuGet walk up for theirs) are taken
// from every folder between the unit and the repository root.
function unitInputs(root, u) {
  const dir = join(root, u.dir);
  const files = new Set();
  const upward = u.provider === "dotnet"
    ? (n) => /^Directory\.Build\./.test(n) || n === "Directory.Packages.props" || n === "global.json" || n.toLowerCase() === "nuget.config"
    : (n) => n === ".npmrc" || n === ".yarnrc";
  for (let d = dir; ; d = dirname(d)) {
    let names = [];
    try { names = readdirSync(d); } catch { names = []; }
    for (const n of names) if (upward(n) && isFile(join(d, n))) files.add(join(d, n));
    if (d === root || d === dirname(d)) break;
  }
  if (u.provider === "dotnet") {
    for (const f of findFiles(dir, (n) => n.endsWith(".csproj") || n === "packages.lock.json" || upward(n))) files.add(f);
    // The solution itself (its project list and configuration mapping), and each project it
    // lists from outside the unit, with that project's lockfile.
    if (isFile(join(dir, u.entry))) files.add(join(dir, u.entry));
    const inside = (p) => p === root || p.startsWith(root + sep);
    for (const f of solutionProjects(root, u)) {
      if (!inside(f)) continue;
      for (const g of [f, join(dirname(f), "packages.lock.json")]) if (isFile(g)) files.add(g);
    }
  } else {
    for (const n of [u.lockfile, "package.json"]) if (isFile(join(dir, n))) files.add(join(dir, n));
    for (const f of findFiles(join(dir, "patches"), () => true)) files.add(f);
  }
  return [...files].map((f) => relative(root, f)).sort();
}

function unitFingerprint(root, u) {
  const lines = unitInputs(root, u).map((f) => `${sha256(readFileSync(join(root, f)))}  ${f}`);
  const dir = join(root, u.dir);
  if (u.provider === "dotnet") lines.push(`dotnet=${version(dotnetBin(), dir)}`);
  else lines.push(`${u.provider}=${version(u.provider, dir)}`, `node=${process.version}`);
  return sha256(`${lines.join("\n")}\n`);
}

// What a stamp says: the fingerprint, the task path it was written for, and (for a Node unit) the
// identity of the installed tree. The path stops a stamp copied from another checkout with the
// same lockfiles; the tree identity stops a node_modules replaced wholesale after stamping - the
// stamp lives outside node_modules, so replacing the tree would otherwise keep it valid (#46).
const TREE_ID = ".xezar-deps-tree";
const treeId = (root, u) => {
  if (u.provider === "dotnet") return "";
  const nm = join(root, u.dir, "node_modules");
  const st = lstat(nm);
  if (!st) return "none";
  if (!st.isDirectory()) return "invalid";
  const file = join(nm, TREE_ID);
  const nonce = isFile(file) ? readFileSync(file, "utf8").trim() : "missing";
  return `${nonce}@${st.dev}:${st.ino}`;
};
const writeTreeId = (root, u) => {
  if (u.provider === "dotnet") return;
  const nm = join(root, u.dir, "node_modules");
  if (!lstat(nm)?.isDirectory()) return;
  const file = join(nm, TREE_ID);
  rmSync(file, { force: true });
  writeFileSync(file, `${randomBytes(16).toString("hex")}\n`, { flag: "wx" });
};
const stampContent = (root, u, fp) => `${fp}\ntask=${join(root, u.dir)}\n${u.provider === "dotnet" ? "" : `tree=${treeId(root, u)}\n`}`;
const stampRel = (u) => `${STAMPS}/${u.slug}`;

// --- is this install the task's own ---------------------------------------------------------
function resolveNode(root, u, problems) {
  const dir = join(root, u.dir);
  const nm = join(dir, "node_modules");
  const inside = (p) => p === root || p.startsWith(root + sep);
  // Where a link points; for a dangling link, its first hop.
  const target = (p) => real(p) ?? resolve(dirname(p), readlinkSync(p));
  const rel = (p) => relative(root, p);
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch (e) {
    problems.push(`  ${u.dir}: cannot read package.json (${e.message}), so what it declares is unknown`);
    return;
  }
  const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => !optional.has(n));
  const st = lstat(nm);
  if (st?.isSymbolicLink()) { problems.push(`  ${u.dir}: node_modules is a symlink (-> ${target(nm)}), not this task's own install`); return; }
  if (st && !st.isDirectory()) { problems.push(`  ${u.dir}: node_modules is not a directory`); return; }
  if (!st) {
    if (u.provider === "yarn" || declared.length > 0) problems.push(`  ${u.dir}: no node_modules`);
    return;
  }
  if (u.provider === "yarn" && !isFile(join(nm, ".yarn-integrity"))) {
    problems.push(`  ${u.dir}: node_modules has no .yarn-integrity, so Yarn did not finish installing it`);
    return;
  }
  for (const name of declared) {
    if (!lstat(join(nm, ...name.split("/")))) {
      problems.push(`  ${u.dir}: ${name} is not installed here, so node would resolve it from an ancestor's node_modules`);
    }
  }
  // npm workspaces: each workspace package must be linked to this task's own copy.
  const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
  for (const p of patterns) {
    const dirs = [];
    if (p.endsWith("/*") && !/[*?[{]/.test(p.slice(0, -2))) {
      let entries = [];
      try { entries = readdirSync(join(dir, p.slice(0, -2)), { withFileTypes: true }); } catch { entries = []; }
      for (const e of entries) if (e.isDirectory()) dirs.push(join(dir, p.slice(0, -2), e.name));
    } else if (/[*?[{]/.test(p)) {
      problems.push(`  ${u.dir}: workspace pattern "${p}" is not one this check can expand, so it cannot prove where it resolves`);
    } else dirs.push(join(dir, p));
    for (const ws of dirs) {
      let name;
      try { name = JSON.parse(readFileSync(join(ws, "package.json"), "utf8")).name; } catch { continue; }
      if (typeof name !== "string" || name === "") continue;
      const link = join(nm, ...name.split("/"));
      if (real(link) !== real(ws)) problems.push(`  ${u.dir}: workspace ${name} at ${rel(link)} is not linked to this task's ${rel(ws)}`);
    }
  }
  // No link in node_modules - a package, a scope, a nested node_modules or a .bin entry - may
  // resolve outside this task. A link that stays inside is followed, because what it holds can
  // link out; `visited` (canonical paths) makes a link cycle terminate.
  const visited = new Set();
  const scanPackage = (pkgDir) => {
    const nested = join(pkgDir, "node_modules");
    const s = lstat(nested);
    if (s?.isSymbolicLink()) {
      const t = target(nested);
      if (!inside(t)) problems.push(`  ${rel(nested)} -> ${t}, outside this task`);
      else if (lstat(t)?.isDirectory()) scan(t);
    } else if (s?.isDirectory()) scan(nested);
  };
  const scan = (d) => {
    const rp = real(d);
    if (rp === null) { problems.push(`  ${rel(d)}: cannot be resolved`); return; }
    if (visited.has(rp)) return;
    visited.add(rp);
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch (e) { problems.push(`  ${rel(d)}: cannot be read (${e.code})`); return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) {
        const t = target(p);
        if (!inside(t)) { problems.push(`  ${rel(p)} -> ${t}, outside this task`); continue; }
        if (lstat(t)?.isDirectory()) {
          if (e.name === ".bin" || e.name.startsWith("@")) scan(t);
          else scanPackage(t);
        }
        continue;
      }
      if (!e.isDirectory()) continue;
      if (e.name === ".bin" || e.name.startsWith("@")) { scan(p); continue; }
      if (e.name.startsWith(".")) continue;
      scanPackage(p);
    }
  };
  scan(nm);
}

// Every project under the unit, and every project its solution lists, has a real
// obj/project.assets.json restored for THIS task's own project file (the gates build with
// --no-restore, so a borrowed one would judge another checkout).
function resolveDotnet(root, u, problems) {
  for (const file of dotnetProjects(root, u)) {
    const proj = relative(root, file);
    if (!file.startsWith(root + sep)) { problems.push(`  ${u.dir}/${u.entry} lists ${file}, outside this task`); continue; }
    try { safeParents(root, proj); } catch (e) { problems.push(`  ${proj}: ${e.message}`); continue; }
    if (!isFile(file)) { problems.push(`  ${proj}: listed in ${u.dir}/${u.entry} but not found`); continue; }
    const obj = join(dirname(file), "obj");
    const assets = join(obj, "project.assets.json");
    const so = lstat(obj);
    const sa = lstat(assets);
    if (so?.isSymbolicLink()) { problems.push(`  ${proj}: obj is a symlink, not this task's restore`); continue; }
    if (!sa) { problems.push(`  ${proj}: not restored (no obj/project.assets.json)`); continue; }
    if (sa.isSymbolicLink() || !sa.isFile() || real(obj) !== obj) { problems.push(`  ${proj}: obj/project.assets.json is not a file of this task`); continue; }
    let restoredFor = null;
    try { restoredFor = JSON.parse(readFileSync(assets, "utf8"))?.project?.restore?.projectPath ?? null; } catch { restoredFor = null; }
    // dotnet writes an absolute path; a relative one would resolve against this process's cwd.
    if (typeof restoredFor !== "string" || !isAbsolute(restoredFor) || real(restoredFor) !== real(file)) {
      problems.push(`  ${proj}: obj/project.assets.json was restored for ${restoredFor ?? "an unknown project"}, not ${file}`);
    }
  }
}

function resolveAll(root, units) {
  const problems = [];
  for (const u of units) {
    const before = problems.length;
    presence(root, u, problems);
    if (problems.length > before) continue;
    if (u.provider === "dotnet") resolveDotnet(root, u, problems);
    else resolveNode(root, u, problems);
  }
  return problems;
}

// --- commands -------------------------------------------------------------------------------
function cmdInstall(root, units) {
  const problems = [];
  for (const u of units) presence(root, u, problems);
  if (problems.length) {
    console.error("deps-restore: refused - a unit in dependencies.units cannot be found:");
    for (const p of problems) console.error(p);
    return 1;
  }
  for (const u of units) {
    if (u.provider === "yarn") yarnVersion(root, u);
    const plan = INSTALL[u.provider](root, u);
    if (!plan.tool) throw new Refusal(`${u.dir}: dotnet is not on PATH, nor at $DOTNET_ROOT or ~/.dotnet`);
    const shown = `${u.provider === "dotnet" ? "dotnet" : plan.tool} ${plan.args.join(" ")}`;
    console.log(`  deps          installing ${u.dir} (${shown})`);
    const r = spawnSync(plan.tool, plan.args, { cwd: join(root, u.dir), stdio: "inherit", env: { ...process.env, ...plan.env } });
    if (r.error || r.status !== 0) {
      console.error(`deps-restore: ${shown} failed in ${u.dir}${r.error ? ` (${r.error.message})` : ` (exit ${r.status})`}`);
      return 1;
    }
  }
  return 0;
}

function cmdTools(root, units) {
  const pad = (label) => `  ${label.padEnd(14)}`;
  const pin = nodePin(root);
  const needsNode = units.some((u) => u.provider !== "dotnet");
  console.log(`${pad("node")}${process.version}`);
  if (pin.kind === "alias") console.log(`${pad("node pin")}.nvmrc holds "${pin.raw}", which is not a version number, so no Node is pinned here`);
  if (pin.kind === "major" && nodeMajor() !== pin.major) {
    console.error(`node ${process.version} is on PATH, but this repository pins Node ${pin.major} (.nvmrc), and no Node ${pin.major} was found under ${nvmVersions()}. Install Node ${pin.major} (nvm is one way: nvm install ${pin.major}) or start the session under it.`);
    return 1;
  }
  if (needsNode && pin.kind !== "major" && nodeMajor() < 20) {
    console.error(`node ${process.version} is below the required 20`);
    return 1;
  }
  const providers = [...new Set(units.map((u) => u.provider))];
  for (const provider of providers) {
    if (provider === "npm") {
      const v = version("npm", root);
      if (v === "unknown") { console.error("npm is not on PATH"); return 1; }
      console.log(`${pad("npm")}${v}`);
    } else if (provider === "yarn") {
      const seen = new Set();
      for (const u of units.filter((x) => x.provider === "yarn")) seen.add(yarnVersion(root, u));
      console.log(`${pad("yarn")}${[...seen].join(", ")} (Yarn 1)`);
    } else {
      const bin = dotnetBin();
      if (!bin) { console.error("dotnet is not on PATH, nor at $DOTNET_ROOT or ~/.dotnet (a dotnet unit needs the .NET SDK)"); return 1; }
      console.log(`${pad("dotnet")}${version(bin, root)}`);
    }
  }
  return 0;
}

function main() {
  const [, , command, ...rest] = process.argv;
  const at = rest.indexOf("--root");
  const given = at === -1 ? "" : rest[at + 1] ?? "";
  if (!command || !given) {
    console.error("usage: deps.mjs <mode|units|install|tools|node-pin|fingerprint|stamp|fresh|resolve|versions> --root <dir>");
    return 2;
  }
  const root = real(given);
  if (!root) { console.error(`deps: ${given} does not exist`); return 2; }
  const units = loadUnits(root);

  if (command === "mode") { console.log(units ? "units" : "single"); return 0; }
  if (command === "node-pin") {
    const pin = nodePin(root);
    if (units && pin.kind === "major" && nodeMajor() !== pin.major) {
      const bin = nvmBin(pin.major);
      if (bin) console.log(bin);
    }
    return 0;
  }
  if (!units) { console.error("deps: no dependency units are configured (dependencies.units on the base branch)"); return 2; }
  switch (command) {
    case "units":
      console.log(JSON.stringify(units));
      return 0;
    case "install":
      return cmdInstall(root, units);
    case "tools":
      return cmdTools(root, units);
    case "fingerprint":
      console.log(sha256(units.map((u) => `${u.slug} ${unitFingerprint(root, u)}\n`).join("")));
      return 0;
    case "stamp":
      for (const u of units) {
        safeParents(root, stampRel(u));
        const file = join(root, stampRel(u));
        mkdirSync(dirname(file), { recursive: true });
        rmSync(file, { force: true });
        writeTreeId(root, u);
        writeFileSync(file, stampContent(root, u, unitFingerprint(root, u)), { flag: "wx" });
      }
      return 0;
    case "fresh":
      for (const u of units) {
        safeParents(root, stampRel(u));
        const file = join(root, stampRel(u));
        if (!isFile(file) || readFileSync(file, "utf8") !== stampContent(root, u, unitFingerprint(root, u))) return 1;
      }
      return resolveAll(root, units).length === 0 ? 0 : 1;
    case "resolve": {
      const problems = resolveAll(root, units);
      if (problems.length === 0) return 0;
      console.error("DEPENDENCIES ARE NOT INSTALLED IN THIS TASK (#286)");
      for (const p of problems) console.error(p);
      console.error("Anything run here now would fail or judge another checkout.");
      console.error(`Run .xezar/checks/deps-restore.sh (or the gates without --fast) in ${root} first.`);
      return 1;
    }
    case "versions": {
      const out = {};
      const yarnUnit = units.find((u) => u.provider === "yarn");
      if (yarnUnit) out["yarn"] = version("yarn", join(root, yarnUnit.dir));
      if (units.some((u) => u.provider === "dotnet")) out.dotnet = version(dotnetBin(), root);
      for (const k of Object.keys(out)) if (out[k] === "unknown") out[k] = null;
      console.log(JSON.stringify(out));
      return 0;
    }
    default:
      console.error(`deps: unknown command "${command}"`);
      return 2;
  }
}

try {
  process.exitCode = main();
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`deps: refused - ${error.message}`);
  process.exitCode = 2;
}

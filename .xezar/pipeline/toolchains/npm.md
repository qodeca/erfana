# Toolchain provider: npm

The Node.js/npm ecosystem. Select it with `"toolchain": { "providers": ["npm"] }`.

## Prerequisites

`npm` 9 or newer, which ships with Node.js 18 and later. `npm ci --ignore-scripts` and
`npm outdated --json` both need it.

## Output grammar

As in `TEMPLATE.md`: `NAME=value` lines, split on the first `=`, never sourced as shell.

## Operations

### toolchain-check

```bash
if ! command -v npm >/dev/null 2>&1; then
  printf 'TOOLCHAIN=npm\nTOOLCHAIN_STATUS=evidence-unavailable\nTOOLCHAIN_VERSION=unknown\n'
  printf 'TOOLCHAIN_NOTES=npm is not on PATH; install Node.js 18 or newer\n'
  exit 0
fi
NPM_VERSION=$(npm --version 2>/dev/null || echo unknown)
printf 'TOOLCHAIN=npm\nTOOLCHAIN_STATUS=pass\n'
printf 'TOOLCHAIN_COMMAND=%s\n' "$(command -v npm)"
printf 'TOOLCHAIN_VERSION=%s\nTOOLCHAIN_NOTES=\n' "$NPM_VERSION"
```

### restore-dependencies

`npm ci` is the operation, not `npm install`. `ci` installs exactly what the lockfile
pins and fails when the lockfile and `package.json` disagree; `install` resolves afresh
and rewrites the lockfile, which defeats the point of having one.

`--ignore-scripts` is not optional. Restoring dependencies otherwise runs `preinstall`,
`install` and `postinstall` scripts from every transitive package, in a checkout that may
be a pull request from outside the project.

```bash
npm ci --ignore-scripts
```

Exit codes:

| Code | Status | Why |
|---|---|---|
| `0` | `pass` | Dependencies restored from the lockfile. |
| `1` | `findings` | npm could not restore — commonly the lockfile and `package.json` disagree, which is a real result about the repository. |
| anything else | `unknown` | Not enumerated, so its meaning is not known. |

```text
TOOLCHAIN=npm
RESTORE_STATUS=…
RESTORE_LOCKFILE=package-lock.json
RESTORE_SCRIPTS_SUPPRESSED=yes
RESTORE_NOTES=…
```

Check `git status --porcelain package-lock.json` afterwards: `npm ci` must not modify the
lockfile, so a modified lockfile is `findings` with the note "npm ci rewrote the lockfile".

### build

A build exists only when `package.json` declares a `build` script. When it does not, this
is `not-applicable` — plenty of packages have nothing to build, and reporting `pass` for
them would claim a check that never ran.

```bash
if node -e 'process.exit(require("./package.json").scripts?.build ? 0 : 1)' 2>/dev/null; then
  npm run build
else
  : # not-applicable
fi
```

| Code | Status |
|---|---|
| `0` | `pass` |
| `1` | `findings` (the build failed) |
| anything else | `unknown` |

### outdated

`npm outdated` exits **1 when anything is out of date**. Read naively that is a failure;
it is the normal result. This is exactly the case the template's exit-code rule exists
for.

```bash
npm outdated --json
```

| Code | Status | Why |
|---|---|---|
| `0` | `pass` | Nothing is behind. |
| `1` | `findings` | Something is behind. **Not a failure.** |
| anything else | `unknown` | |

Parse the JSON object — keys are package names, values carry `current`, `wanted`,
`latest` — into `OUTDATED_<n>=<name>|<current>|<wanted>|<latest>` lines. A package with no
`current` is declared but not installed; report it with `current` as `unknown` rather than
inventing one.

### update-dependency

```bash
case "$NAME" in *[!A-Za-z0-9._@/-]*) echo "invalid dependency name" >&2; exit 2 ;; esac
case "$VERSION" in *[!A-Za-z0-9._+-]*) echo "invalid version" >&2; exit 2 ;; esac
npm install --ignore-scripts --save-exact "$NAME@$VERSION"
```

`--save-exact` writes the exact version rather than a range, so the manifest says what
was decided instead of a rule that will resolve to something else next week.
`--ignore-scripts` for the same reason as in restore.

Compare `package-lock.json` before and after to fill `UPDATE_OTHERS_MOVED`: npm resolves
the whole tree, so one requested bump routinely moves transitive dependencies too. That
is not a failure, and the reviewer needs to see it.

| Code | Status |
|---|---|
| `0` | `pass` |
| `1` | `findings` (npm refused — a peer conflict, or the version does not exist) |
| anything else | `unknown` |

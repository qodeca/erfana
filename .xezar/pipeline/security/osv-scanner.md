# Security provider: osv-scanner

An ecosystem-agnostic vulnerability scanner that reads lockfiles and SBOMs and checks them
against the OSV database. Select it with `"security": { "provider": "osv-scanner" }`.

It is offered because it covers many ecosystems from one descriptor rather than needing a
provider per language. It is **not** a default: with no `security.provider` in the config,
nothing here runs and every operation is `not-applicable`.

## Prerequisites

The `osv-scanner` binary on `PATH`, or at an absolute path. Do not resolve it from a
repository-local directory — on a review path the repository under scan would be supplying
the tool that judges it.

## Operations

### security-check

```bash
if ! command -v osv-scanner >/dev/null 2>&1; then
  printf 'SECURITY_PROVIDER=osv-scanner\nSECURITY_STATUS=evidence-unavailable\n'
  printf 'SECURITY_VERSION=unknown\n'
  printf 'SECURITY_NOTES=osv-scanner is not on PATH; see https://google.github.io/osv-scanner/\n'
  exit 0
fi
printf 'SECURITY_PROVIDER=osv-scanner\nSECURITY_STATUS=pass\n'
printf 'SECURITY_COMMAND=%s\n' "$(command -v osv-scanner)"
printf 'SECURITY_VERSION=%s\nSECURITY_NOTES=\n' "$(osv-scanner --version 2>/dev/null | head -n 1)"
```

### security-scan

Scan kind: `sca`. Capture the exit code; never decide from the output text.

```bash
osv-scanner scan --format json . > "$SCAN_JSON" 2>/dev/null
SCAN_EXIT=$?
```

Exit codes, as the tool documents them:

| Code | Status | Why |
|---|---|---|
| `0` | `pass` | Packages were found, and none has a known vulnerability. |
| `1`–`126` | `findings` | Vulnerabilities or findings are present. A result, not an error. |
| `127` | `unknown` | General error. The scan did not complete, so nothing was verified. |
| `128` | **`unknown`** | **No packages were detected.** This is the dangerous one: nothing was scanned, which reads as a clean result and is not one. A repository whose lockfile moved, or whose manifest the scanner does not recognise, lands here — and calling it `pass` would mean every such repository silently stops being scanned. |
| `129`–`255` | `unknown` | Reserved for non-result errors. |

Parse `$SCAN_JSON` for counts by severity and for the `SCAN_ID_<n>` lines. Do not echo the
file: it carries advisory text and package names from an external database, and it will be
rendered into a pull-request comment.

### dependency-inventory

```bash
osv-scanner scan --format cyclonedx-1-5 . > "$INVENTORY_PATH" 2>/dev/null
INVENTORY_EXIT=$?
```

```text
INVENTORY_FORMAT=cyclonedx-1.5
INVENTORY_PATH=<the path written>
```

Apply the same exit-code table. In particular, exit `128` with a written file means an
inventory of nothing — report `unknown` and say the scanner detected no packages, rather
than publishing an empty SBOM that reads as "this project has no dependencies".

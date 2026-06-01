# Troubleshooting and rollback procedures

## CI failure signatures

This is the canonical cookbook for `release.yml` failures. Each row below is a real failure mode encountered in the v0.9.5 bring-up (≥15 dry-run cycles, runs 24897481170 → 24908659275).

**Each row carries a typed `regex` field** — a single-line `grep -E -i`-compatible pattern that uniquely identifies the failure. The `release-failure-analyzer` agent extracts these by parsing lines starting with `- **Regex:**` and matches them (case-insensitive) against the failed-step log. Operators reading the cookbook by hand can also `grep -E -i` for the regex against a downloaded log.

**Format invariants** (DO NOT break — the analyzer parser depends on them):
- Each row begins with `### Row N: <short title>`.
- Each row has exactly these fields, each on its own line, in this order: `**Regex:**`, `**Human-readable symptom:**`, `**Root cause:**`, `**Fix:**`, `**Platform:**`, `**First seen:**`.
- The `**Regex:**` value is a single-line `grep -E -i` regex wrapped in backticks. Special chars (`(`, `)`, `.`, `[`, `]`, `|`) must be escaped per POSIX ERE semantics. Anchors are optional.
- Adding a new row: copy the template at the end of this section.

### Row 1: Private-repo provenance billing gate

- **Regex:** `actions/attest-build-provenance.+(403|billing|enterprise)`
- **Human-readable symptom:** `actions/attest-build-provenance` step fails with HTTP 403 / billing-gate error.
- **Root cause:** Private repo on Free tier; SLSA Build L2 provenance via `actions/attest-build-provenance` is GitHub Enterprise Cloud-only.
- **Fix:** Removed all `attest-build-provenance` steps from `build_*.yml` and `release.yml` finalize. Authenticity now relies on minisign + per-platform OS signing.
- **Platform:** All
- **First seen:** run 24897481170

### Row 2: electron-builder rejects OIDC for Azure signing

- **Regex:** `Unable to find valid azure env configuration for signing`
- **Human-readable symptom:** Build fails at `WindowsSignAzureManager.initialize` even though `AZURE_FEDERATED_TOKEN_FILE` is set.
- **Root cause:** electron-builder 26.8.1's `WindowsSignAzureManager.initialize()` hard-rejects `AZURE_FEDERATED_TOKEN_FILE` (OIDC). Its pre-flight validator only accepts `AZURE_CLIENT_SECRET`, `AZURE_CLIENT_CERTIFICATE_PATH`, or `AZURE_USERNAME`+`AZURE_PASSWORD`.
- **Fix:** Switch from OIDC federation to X.509 cert auth: generate a 2-yr self-signed RSA-2048 cert, upload the public via `az ad app credential reset --append`, store the PFX as `AZURE_CLIENT_CERTIFICATE_BASE64` GitHub Secret + password as `AZURE_CLIENT_CERTIFICATE_PASSWORD`. Workflow decodes PFX to disk, sets `AZURE_CLIENT_CERTIFICATE_PATH`.
- **Platform:** Windows
- **First seen:** run 24902364788

### Row 3: Literal ${env.X} in signtool metadata

- **Regex:** `System\.UriFormatException.+Invalid URI`
- **Human-readable symptom:** Build fails at `Azure.CodeSigning.Dlib.Core.DigestSigner..ctor` with `System.UriFormatException: Invalid URI: The format of the URI could not be determined`.
- **Root cause:** electron-builder's macro expander (`util/macroExpander.ts`) is **not** applied to `azureSignOptions` — only to pattern fields like `artifactName`. The literal string `${env.AZURE_SIGNING_ENDPOINT}` reaches `Invoke-TrustedSigning` and gets written into metadata.json, where the .NET `System.Uri` constructor blows up trying to parse it.
- **Fix:** Inject all 4 azureSignOptions fields via CLI overrides: `--config.win.azureSignOptions.endpoint=$AZURE_SIGNING_ENDPOINT --config.win.azureSignOptions.publisherName=$AZURE_PUBLISHER_NAME --config.win.azureSignOptions.codeSigningAccountName=$AZURE_SIGNING_ACCOUNT_NAME --config.win.azureSignOptions.certificateProfileName=$AZURE_CERT_PROFILE_NAME`. Leave placeholder strings in `electron-builder.yml` to satisfy schema validation.
- **Platform:** Windows
- **First seen:** run 24905939428

### Row 4: Schema validator demands non-empty azureSignOptions

- **Regex:** `(configuration\.win\.azureSignOptions|win\.azureSignOptions).+(misses the property|required)`
- **Human-readable symptom:** `configuration.win.azureSignOptions misses the property 'publisherName'` — fires even on the macOS leg that doesn't actually call signtool.
- **Root cause:** electron-builder's JSON schema validator runs on **every** platform leg, not just `--win`. An empty `azureSignOptions: {}` fails the required-fields check before the build leg even starts.
- **Fix:** Replace empty object with valid placeholder strings in YAML so the schema passes; CLI `--config` overrides supply real values at runtime. Use `endpoint: https://placeholder.invalid/` (RFC 6761 reserved TLD) so misconfigured local builds fail fast at DNS instead of probing a third-party-registrable domain.
- **Platform:** All (schema validation cross-cuts)
- **First seen:** run 24907205976

### Row 5: resign.js destroys Developer ID helper signatures

- **Regex:** `(binary not signed with .+Developer ID|no secure timestamp|hardened runtime not enabled).+Helper`
- **Human-readable symptom:** macOS notarization rejects with helper-binary errors ("binary not signed with Developer ID", "no secure timestamp", "hardened runtime not enabled") on `Erfana Helper (GPU)` or similar bundled binaries.
- **Root cause:** `scripts/resign.js`'s `codesign -dv` probe-based safety check was unreliable in electron-builder's `afterSign` hook timing. The ad-hoc fallback ran during a Developer ID build and overwrote helper signatures with mismatched ad-hoc identity.
- **Fix:** Make `resign.js` an unconditional no-op when ANY of these env vars signals real-identity signing: `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_KEY_PATH`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `CSC_LINK`, `CSC_KEYCHAIN`, `CSC_KEY_PASSWORD`, `CSC_IDENTITY_AUTO_DISCOVERY=true`, `CSC_NAME` (and not equal to `-`).
- **Platform:** macOS
- **First seen:** run 24902364788

### Row 6: notarytool exits 0 on rejection

- **Regex:** `(Could not find base64 encoded ticket|stapler.+(failed|cannot)).+attempt`
- **Human-readable symptom:** `xcrun stapler staple` fails with "Could not find base64 encoded ticket" after `notarytool submit --wait` appeared to succeed.
- **Root cause:** `notarytool submit --wait` ALWAYS exits 0 after the wait completes — `Accepted`, `Invalid`, and `Rejected` all return zero. Without parsing the JSON `.status`, a rejection looks like a success, and the staple step then has no ticket to attach.
- **Fix:** After `notarytool submit ... --wait --output-format json 2>/dev/null`, prefilter the output with `sed -n '/^{/,/^}/p'` (in case of stderr-mix), then parse the JSON for `id` + `status`. If `status != "Accepted"`, fetch the verbose rejection log via `xcrun notarytool log "$id" --apple-id ... --password ... --team-id ...` and fail the step.
- **Platform:** macOS
- **First seen:** run 24899150984

### Row 7: spctl rejects DMG with "no usable signature"

- **Regex:** `\.dmg.+(rejected|source=no usable signature)`
- **Human-readable symptom:** `spctl` rejects a notarized + stapled DMG with `source=no usable signature`, even though `xcrun stapler validate` succeeds on the same file.
- **Root cause:** `spctl -t install` is for `.pkg` installer packages only — on a `.dmg` it returns "no usable signature" even when the DMG has a valid stapled notarization ticket. `-t open --context context:primary-signature` (Apple DTS-recommended for DMGs) also fails because electron-builder doesn't codesign the DMG container itself, only the `.app` bundles inside.
- **Fix:** Drop spctl entirely for DMGs. Rely on `codesign --verify --deep --strict --verbose=2` on every `Erfana.app` (proves bundle + helper signatures intact) plus `xcrun stapler validate` on every DMG (proves the notarization ticket is attached). Apple's DTS guidance ([thread/128683](https://developer.apple.com/forums/thread/128683)): "spctl is a poor way to check for that. Use codesign with --check-notarization."
- **Platform:** macOS
- **First seen:** run 24905939428

### Row 8: stapler doesn't work on ZIP

- **Regex:** `Stapler is incapable of working with ZIP`
- **Human-readable symptom:** `xcrun stapler validate <zip>` exits 66 with "Stapler is incapable of working with ZIP archive files".
- **Root cause:** ZIP container has no extended-attribute storage for the notarization ticket — the ticket lives inside the `.app` bundle that gets zipped. `xcrun stapler validate <zip>` always fails by design.
- **Fix:** Drop `xcrun stapler validate` for `*.zip`. The contained `.app` is already codesign-verified by the verify step, and electron-builder staples the ticket onto the `.app` BEFORE creating the ZIP, so end users get the ticket preserved when they unzip.
- **Platform:** macOS
- **First seen:** run 24907349273

### Row 9: CR/LF in GitHub Secret breaks downstream URL parsing

- **Regex:** `AZURE_SIGNING_ENDPOINT.+set\([0-9]+\).+(UriFormatException|Invalid URI|System\.Uri)`
- **Human-readable symptom:** Sign-related env vars all show `set(N)` in the structural diagnostic, yet the signing step still fails with URI parse errors at `Azure.CodeSigning.Dlib`.
- **Root cause:** `gh secret set <file>` retains trailing `\r\n` from the source file. The URL flows through CI as `https://…/\r\n` and breaks downstream URI parsing in metadata.json. (Note: this was a red herring on the v0.9.5 bring-up — the real cause was Row 3 — but the defensive trim is cheap insurance.)
- **Fix:** (a) Re-set sign secrets via `printf '%s' '<value>' | gh secret set <NAME>` (no trailing newline). (b) Add a defensive normalize step in `build_win.yml` before the build call: `clean=$(printf '%s' "$AZURE_SIGNING_ENDPOINT" | tr -d '\r\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')`. (c) Assert `https://` prefix and non-empty before electron-builder runs.
- **Platform:** Windows
- **First seen:** run 24905939428

### Row 10: Concurrency queue traps iteration

- **Regex:** `(workflow_dispatch|run).+(pending|queued).+(release|stuck|waiting)`
- **Human-readable symptom:** Newly dispatched dry-run sits in `pending` for ~25 min while a stuck previous run finishes.
- **Root cause:** `release.yml` declares `concurrency.cancel-in-progress: false` (intentional — never cancel a near-complete signed build). Queued runs go FIFO. When iterating on a workflow fix, the next dispatch waits behind the prior run.
- **Fix:** When iterating: `gh run cancel <ID>` on the stuck head run **explicitly** to drain the queue. Do NOT change to `cancel-in-progress: true` — it would auto-cancel mid-signing on a real release.
- **Platform:** All
- **First seen:** run 24905191415

### Adding a new row (template)

Copy this template, fill in each field, and insert at the end of the row list. Do not skip fields — the analyzer parser depends on every row having all six.

```markdown
### Row N: <short title — what fails>

- **Regex:** `<grep -E -i regex; escape special chars per POSIX ERE>`
- **Human-readable symptom:** <one or two sentences of what the operator sees>
- **Root cause:** <why it happens; cite source code or vendor docs if applicable>
- **Fix:** <exact recipe — env vars / config snippets / commands>
- **Platform:** <Linux | macOS | Windows | All>
- **First seen:** run <run-id> (or `<commit-hash>` if pre-CI debug)
```

### Diagnostic habits worth codifying

The fastest lessons from the v0.9.5 bring-up. Skill operators should adopt these reflexes:

- **For Windows signing failures, grep the literal `pwsh.exe -Command Invoke-TrustedSigning` invocation in the failed-step log.** That is the ground truth of what `Invoke-TrustedSigning` actually saw. Rows 3 and 9 above hid for ≥3 cycles because the workflow's diagnostic step printed env-var byte-lengths but never the command being executed. If you see literal `${env.X}` placeholders in the command, electron-builder's macro expander didn't run on that field — use a CLI `--config` override instead.
- **For macOS notarization "rejected" mysteries, always pull `xcrun notarytool log <id>` before any other action.** It's the only authoritative source for *why* Apple rejected. Row 5 was misdiagnosed for ~2 cycles before the rejection log was actually read.
- **electron-builder's macro expander (`util/macroExpander.ts`) only runs on pattern fields** (`artifactName`, dmg internals). Anything else (`azureSignOptions`, `mac.entitlements`, etc.) takes the YAML value verbatim. When you need env-driven config there, use CLI `--config.path.to.field=$VAR`.
- **macOS Sequoia+ rejects mismatched ad-hoc signatures across `@rpath`-loaded helpers.** Any post-electron-builder signing pass on macOS must be guarded by an env-var probe, not a `codesign -dv` check (the probe was unreliable in `afterSign` hook timing).
- **GitHub Actions `macos-latest` is 10× billing.** A single mac dry-run is ~$0.80 against the included minutes; two parallel macOS runs (e.g., a queued canary + a freshly dispatched fix run) burn $1.60 with overlap. Cancel one before dispatching the next.
- **The dry-run mode (`workflow_dispatch -f dry-run=true`) skips `gh release upload` but still signs + notarizes.** Use it to validate workflow changes without burning a tag. Real releases consume real Apple notary minutes; dry-runs do too, but you don't need to bump the patch on failure.

### How to use this cookbook

1. CI just failed — open the failed-step log via `gh run view <ID> --log-failed`.
2. For each row above, run `grep -E -i '<row-regex>'` against the log. Match → row found.
3. Read the matching row's **Root cause** and **Fix**.
4. Apply the fix (most are one-file YAML edits) and re-dispatch.
5. If no row matches, follow the diagnostic habits above. After the fix lands, **add a new row** using the template at the end of the row list so the next operator skips the discovery step.

---

## Other troubleshooting

### Build size too large (>300 MB)

Check electron-builder.yml excludes:
```yaml
files:
  - "!release/**"
  - "!coverage/**"
  - "!tests/**"
```

## Tests failing

```bash
# Run specific test suite for debugging
npm run test:renderer
npm run test:main
npm run test:preload
```

## TypeScript errors

```bash
# Check specific config
npm run typecheck:node
npm run typecheck:web
```

## Local signature verification

### Symptom: `git log --show-signature` reports "No signature" for an SSH-signed commit or tag

**Cause**: `gpg.format=ssh` is set, but `gpg.ssh.allowedSignersFile` is not configured. Git can sign with the SSH key, but cannot locally verify because it has no allowed-signers entry to map the public key to an identity. **Server-side verification (GitHub) succeeds regardless** — only `git log --show-signature` and `git verify-commit` are affected. Skill Phase 1.5 emits a WARN when this state is detected.

**Verify the commit really was signed** (independent of allowed-signers):

```bash
gh api repos/qodeca/erfana/commits/$(git rev-parse HEAD) --jq '.commit.verification'
# {"verified": true, "reason": "valid", ...}
```

**Fix** — write an allowed-signers file mapping your email to your SSH public key:

```bash
printf '%s namespaces="git" %s\n' \
  "$(git config --get user.email)" \
  "$(cat $(git config --get user.signingkey))" \
  > ~/.config/git/allowed_signers
git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
```

After this, `git log --show-signature` displays "Good signature" for both commits and tags signed with the configured SSH key.

## Rollback procedures

### If `release.yml` fails

The skill no longer builds locally — every binary is produced by `release.yml` on GitHub-hosted runners. There is no local `release/{version}/` directory to clean.

1. Read the `release-failure-analyzer` incident memo at `docs/release-incidents/v{version}-attempt-{N}.md`.
2. Match the failure signature against the cookbook above (Rows 1–10) using the typed regex field. Apply the matched fix verbatim.
3. If no row matches, follow the diagnostic habits and **add a new row** using the template — preserves the next operator's discovery cost.
4. Bump the patch version (`v{N}` is burned regardless of `release.yml` outcome) and re-invoke the skill from Phase 0.

### If a critical bug ships in a published release

1. Bump the patch version in `package.json` and append the hotfix entry to `docs/CHANGELOG.md`.
2. Re-invoke the skill — the new release becomes "latest" and update mechanisms route to it.
3. **Do not delete published releases.** Users may have download URLs cached; deletion breaks those. Leave the buggy release on GitHub as a historical record.
4. If the bug is a security vulnerability, also publish a GitHub Security Advisory referencing the affected version.

### If a draft (unpublished) release needs to be discarded

```bash
gh release delete "v${VERSION}" --yes --cleanup-tag=false
git push --delete origin "v${VERSION}"
git tag -d "v${VERSION}"
# Bump patch and re-invoke the skill from Phase 0.
```

The tag is **burned regardless** — even after deleting a draft, the next attempt MUST use a fresh patch version. Re-using a tag that ever shipped a signed artifact is forbidden.

### Recovery checklist

- [ ] Incident memo written under `docs/release-incidents/`
- [ ] Cookbook updated if the failure signature was new
- [ ] Patch version bumped (next release uses `v{N+1}`, never re-uses `v{N}`)
- [ ] Stakeholders notified if the buggy release was distributed

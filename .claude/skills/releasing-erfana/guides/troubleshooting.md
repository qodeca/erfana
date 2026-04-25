# Troubleshooting and rollback procedures

## CI failure signatures

This is the canonical cookbook for `release.yml` failures. Each row is a real failure mode encountered in the v0.9.5 bring-up (≥15 dry-run cycles, runs 24897481170 → 24908659275). When CI fails, **grep the failed step's log for the symptom column** — match → root cause → fix.

The `release-failure-analyzer` agent uses this same table for its automated incident-report matching (regex over the symptom column).

| # | Symptom (grep target) | Root cause | Fix that worked | Affected platform | First seen |
|---|---|---|---|---|---|
| 1 | `actions/attest-build-provenance` step 403 / billing gate | Private repo on Free tier; SLSA Build L2 provenance via `actions/attest-build-provenance` is GitHub Enterprise Cloud-only | Removed all `attest-build-provenance` steps from `build_*.yml` and `release.yml` finalize. Authenticity now relies on minisign + per-platform OS signing | All | run 24897481170 |
| 2 | `Unable to find valid azure env configuration for signing` at `WindowsSignAzureManager.initialize` | electron-builder 26.8.1's `WindowsSignAzureManager.initialize()` hard-rejects `AZURE_FEDERATED_TOKEN_FILE` (OIDC). Its pre-flight validator only accepts `AZURE_CLIENT_SECRET`, `AZURE_CLIENT_CERTIFICATE_PATH`, or `AZURE_USERNAME`+`AZURE_PASSWORD` | Switched from OIDC federation to X.509 cert auth: generated 2-yr self-signed RSA-2048 cert, uploaded public via `az ad app credential reset --append`, stored PFX as `AZURE_CLIENT_CERTIFICATE_BASE64` GitHub Secret + password as `AZURE_CLIENT_CERTIFICATE_PASSWORD`. Workflow decodes PFX to disk, sets `AZURE_CLIENT_CERTIFICATE_PATH` | Windows | run 24902364788 |
| 3 | `System.UriFormatException: Invalid URI: The format of the URI could not be determined` at `Azure.CodeSigning.Dlib.Core.DigestSigner..ctor` | electron-builder's macro expander (`util/macroExpander.ts`) is **not** applied to `azureSignOptions` — only to pattern fields like `artifactName`. Literal `${env.AZURE_SIGNING_ENDPOINT}` was reaching `Invoke-TrustedSigning` and being written into metadata.json, where the .NET `System.Uri` constructor blew up | Inject all 4 fields via CLI overrides: `--config.win.azureSignOptions.endpoint=$AZURE_SIGNING_ENDPOINT --config.win.azureSignOptions.publisherName=$AZURE_PUBLISHER_NAME --config.win.azureSignOptions.codeSigningAccountName=$AZURE_SIGNING_ACCOUNT_NAME --config.win.azureSignOptions.certificateProfileName=$AZURE_CERT_PROFILE_NAME`. Left placeholder strings in `electron-builder.yml` to satisfy schema | Windows | run 24905939428 |
| 4 | `configuration.win.azureSignOptions misses the property 'publisherName'` (Linux build also fails) | electron-builder's JSON schema validator runs on **every** platform leg, not just `--win`. An empty `azureSignOptions: {}` fails the required-fields check before the build leg even starts | Replace empty object with valid placeholder strings in YAML so the schema passes; CLI `--config` overrides supply the real values at runtime: `publisherName: placeholder-overridden-at-runtime`, `endpoint: https://placeholder.example/`, `codeSigningAccountName: placeholder`, `certificateProfileName: placeholder` | All (validation cross-cuts) | run 24907205976 |
| 5 | macOS notarization rejected with errors like "binary not signed with Developer ID", "no secure timestamp", "hardened runtime not enabled" on `Erfana Helper (GPU)` etc. | `scripts/resign.js`'s `codesign -dv` probe-based safety check was unreliable in `afterSign` hook timing. The ad-hoc fallback ran during a Developer ID build and overwrote helper signatures with mismatched ad-hoc identity | Make `resign.js` an unconditional no-op when ANY of these env vars is set (signals real-identity signing): `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `CSC_LINK`, `CSC_KEYCHAIN`, `CSC_KEY_PASSWORD`, `CSC_IDENTITY_AUTO_DISCOVERY=true`, `CSC_NAME` (and not equal to `-`) | macOS | run 24902364788 |
| 6 | `notarytool submit --wait` exits 0 but the artifact is rejected (no symptom in shell-script land — only `xcrun stapler staple` later fails with "Could not find base64 encoded ticket") | notarytool ALWAYS exits 0 after the wait completes — `Accepted`, `Invalid`, and `Rejected` all return zero. Without parsing the JSON output, a rejection looks like a success | After `notarytool submit ... --wait --output-format json`, parse the JSON: `id=$(echo "$out" \| python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")` and `status=$(...)`. If `$status != "Accepted"`, fetch the verbose rejection log via `xcrun notarytool log "$id" --apple-id ... --password ... --team-id ...` and fail the step | macOS | run 24899150984 |
| 7 | `<dmg>: rejected, source=no usable signature` from spctl (DMG passes `xcrun stapler validate`) | `spctl -t install` is for `.pkg` installer packages only — using it on a `.dmg` rejects with "no usable signature" even when the DMG has a valid stapled notarization ticket. `-t open --context context:primary-signature` (Apple DTS-recommended for DMGs) also fails because electron-builder doesn't codesign the DMG container itself, only the `.app` bundles inside | Drop spctl entirely for DMGs. Rely on `codesign --verify --deep --strict --verbose=2` on every `Erfana.app` (proves the bundle + helper signatures are intact) plus `xcrun stapler validate` on every DMG (proves the notarization ticket is attached). Apple's own DTS guidance: "spctl is a poor way to check for that. Use codesign with --check-notarization." | macOS | run 24905939428 |
| 8 | `Stapler is incapable of working with ZIP archive files` (exit code 66) | ZIP container has no extended-attribute storage for the notarization ticket — the ticket lives inside the `.app` bundle that gets zipped. `xcrun stapler validate <zip>` always fails | Drop `xcrun stapler validate` for `*.zip`. The contained `.app` is already codesign-verified above, and electron-builder staples the ticket onto the `.app` BEFORE creating the ZIP, so end users get the ticket preserved when they unzip | macOS | run 24907349273 |
| 9 | Sign-related env vars all show `set(N)` in diagnostic, yet the signing step still fails with URI parse errors at `Azure.CodeSigning.Dlib` | `gh secret set <file>` retains trailing `\r\n` from the source file. The URL flows through CI as `https://…/\r\n` and breaks downstream URI parsing in metadata.json. (Note: this turned out to be a red herring on the v0.9.5 bring-up — the real cause was #3 — but the trim is cheap insurance) | (a) Re-set sign secrets via `printf '%s' '<value>' \| gh secret set <NAME>` (no trailing newline). (b) Add a defensive normalize step in `build_win.yml` before the build call: `clean=$(printf '%s' "$AZURE_SIGNING_ENDPOINT" \| tr -d '\r\n' \| awk '{$1=$1;print}'); echo "AZURE_SIGNING_ENDPOINT=$clean" >> "$GITHUB_ENV"`. (c) Assert `https://` prefix and non-empty before electron-builder runs | Windows | run 24905939428 |
| 10 | Newly dispatched dry-run sits in `pending` for ~25 min while a stuck previous run finishes | `release.yml` declares `concurrency.cancel-in-progress: false` (intentional — never cancel a near-complete signed build). Queued runs go FIFO. When iterating on a workflow fix, the next dispatch waits behind the prior run | When iterating: `gh run cancel <ID>` on the stuck head run **explicitly** to drain the queue. Do NOT `cancel-in-progress: true` — it would auto-cancel mid-signing on a real release | All | run 24905191415 |

### Diagnostic habits worth codifying

The fastest lessons from the v0.9.5 bring-up. Skill operators should adopt these reflexes:

- **For Windows signing failures, grep the literal `pwsh.exe -Command Invoke-TrustedSigning` invocation in the failed-step log.** That is the ground truth of what `Invoke-TrustedSigning` actually saw. Rows 3 and 9 above hid for ≥3 cycles because the workflow's diagnostic step printed env-var byte-lengths but never the command being executed. If you see literal `${env.X}` placeholders in the command, electron-builder's macro expander didn't run on that field — use a CLI `--config` override instead.
- **For macOS notarization "rejected" mysteries, always pull `xcrun notarytool log <id>` before any other action.** It's the only authoritative source for *why* Apple rejected. Row 5 was misdiagnosed for ~2 cycles before the rejection log was actually read.
- **electron-builder's macro expander (`util/macroExpander.ts`) only runs on pattern fields** (`artifactName`, dmg internals). Anything else (`azureSignOptions`, `mac.entitlements`, etc.) takes the YAML value verbatim. When you need env-driven config there, use CLI `--config.path.to.field=$VAR`.
- **macOS Sequoia+ rejects mismatched ad-hoc signatures across `@rpath`-loaded helpers.** Any post-electron-builder signing pass on macOS must be guarded by an env-var probe, not a `codesign -dv` check (the probe was unreliable in `afterSign` hook timing).
- **GitHub Actions `macos-latest` is 10× billing.** A single mac dry-run is ~$0.80 against the included minutes; two parallel macOS runs (e.g., a queued canary + a freshly dispatched fix run) burn $1.60 with overlap. Cancel one before dispatching the next.
- **The dry-run mode (`workflow_dispatch -f dry-run=true`) skips `gh release upload` but still signs + notarizes.** Use it to validate workflow changes without burning a tag. Real releases consume real Apple notary minutes; dry-runs do too, but you don't need to bump the patch on failure.

### How to use this table

1. CI just failed — open the failed-step log via `gh run view <ID> --log-failed`.
2. Skim the last ~50 lines for any string in the **Symptom** column. Match the most distinctive error fragment.
3. Read the matching row's **Root cause** and **Fix that worked**.
4. Apply the fix (most are one-file YAML edits) and re-dispatch.
5. If the symptom is *not* in the table, follow the diagnostic habits above. After the fix lands, **add a new row** documenting the new signature so the next operator skips the discovery step.

---

## General troubleshooting



## Build size too large (>300 MB)

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

## Rollback procedures

### If build fails mid-process

1. Check error messages in terminal
2. Fix the issue (usually in source code)
3. Clean the failed build: `rm -rf release/{version}/`
4. Restart from Phase 1 (quality gates)

### If critical bug found post-release

1. **Do NOT delete the release folder** (keep for reference)
2. Create hotfix branch: `git checkout -b hotfix/{version}`
3. Fix the bug
4. Bump patch version in package.json
5. Run full release process for new version
6. If git tag was pushed:
   ```bash
   # Delete remote tag (use with caution)
   git push --delete origin v{version}
   # Delete local tag
   git tag -d v{version}
   ```

### If GitHub release was created

1. Go to GitHub Releases page
2. Edit the release and mark as "Pre-release" or delete draft
3. Add note explaining the issue
4. Create new release with fixed version

### Recovery checklist

- [ ] Identify what went wrong
- [ ] Document the issue for future reference
- [ ] Clean up any partial artifacts
- [ ] Communicate with users if release was distributed
- [ ] Create new release with fix

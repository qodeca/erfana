# Whisper binaries — build & release runbook

Erfana self-hosts its own builds of [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) because upstream does not publish a macOS CLI asset at any recent version (v1.7.0–v1.8.4 inclusive). This doc is the operational runbook for the `.github/workflows/whisper-binaries.yml` CI workflow.

See `docs/windows/phase4-binary-spec.md` for the currently pinned upstream SHA and per-platform SHA-256s.

## Release stream

Two **separate** release streams in the same GitHub repo:

- **`v{semver}`** — Erfana application releases. These set `electron-updater`'s "latest".
- **`whisper-build-{upstream_label}-erfana{rev}`** — whisper binary releases. **Always marked pre-release** so `electron-updater` ignores them.

The Erfana client (`src/main/services/whisper-assets.ts`) pins a specific `whisper-build-*` tag + per-platform SHA-256. App releases and whisper-builds evolve independently.

## Retention policy

**Never delete** a `whisper-build-*` release if any shipped Erfana app version pins it. GitHub's release UI makes deletion one-click; branch-protection on `whisper-build-*` tag refs prevents the destructive case. Each release body lists which Erfana versions pin it — update on every app-release bump that touches `whisper-assets.ts`.

Support window: keep releases reachable for **3 months** past the last shipped Erfana app version that pinned them.

## One-time setup

Required before the first `workflow_dispatch` run.

### 1. Apple code-signing + notarization

Requires an active [Apple Developer Program](https://developer.apple.com/programs/) subscription ($99/yr).

1. Enroll / confirm active.
2. In "Certificates, Identifiers & Profiles" → create a **Developer ID Application** certificate. Download the .cer, add to Keychain Access, then export the combined cert + private key as a `.p12` file (with a strong password).
3. Generate an App-Specific password at https://appleid.apple.com → Sign-In & Security → App-Specific Passwords → label it "Erfana notarytool CI".
4. Add GitHub repo secrets (Settings → Environments → `production-signing` → Add secret):
   - `APPLE_CERT_P12` — base64 of the .p12 file: `base64 -w0 DeveloperID.p12` (macOS: `base64 -i DeveloperID.p12 | tr -d '\n'`)
   - `APPLE_CERT_PASSWORD` — the .p12 export password
   - `APPLE_ID` — your Apple ID email
   - `APPLE_APP_PASSWORD` — the app-specific password from step 3
   - `APPLE_TEAM_ID` — 10-char alphanumeric Team ID from the developer account page

### 2. Windows code-signing

**Phase 4 ships unsigned** — no OV/EV cert yet. Phase 5 procures one. Until then, the Windows whisper.exe relies on SHA-256 pinning + `Zone.Identifier` MOTW-strip on the Erfana client side. The CI workflow does NOT have a signtool step (add when Phase 5 cert is ready).

When Phase 5 cert arrives, add these secrets to `production-signing`:
- `WINDOWS_CERT_PFX` — base64 of the PFX file
- `WINDOWS_CERT_PASSWORD` — PFX password

Then **add** a signtool step to `build-windows`. There is no signtool step and no
commented-out placeholder in `whisper-binaries.yml` today — it has to be written from
scratch. The canary workflow already probes that `signtool.exe` resolves on the
`windows-latest` image (`windows-signtool-canary`), so the tooling side of the Phase 5
flip is drop-in.

### 3. Minisign manifest-signing keys

The `manifest.json` published alongside each binary release is signed with a minisign (Ed25519) key. The Erfana client embeds two public keys (primary + rotation) and accepts either signature — this enables key rotation without bricking existing installs.

**Generate on your Mac** (recommended):

```bash
brew install minisign

# Primary key — lives in CI
mkdir -p ~/erfana-minisign
cd ~/erfana-minisign
minisign -G -p primary.pub -s primary.key
# Choose a strong passphrase when prompted. Record it in a password manager.

# Rotation key — offline, hardware token or air-gapped USB
# Generate onto a USB drive, immediately move the .key file to offline storage.
minisign -G -p rotation.pub -s rotation.key
```

Then:
- Upload `primary.key` contents as `MANIFEST_SIGNING_KEY` in `production-signing` environment.
- Upload the passphrase as `MANIFEST_SIGNING_KEY_PASSWORD`.
- Commit **both** public keys (`primary.pub` + `rotation.pub`) to the Erfana repo at `src/main/services/whisper-pubkeys.ts` (embedded as constants; consumed by `verifyManifest.ts`).
- Move `rotation.key` to offline storage (USB + paper backup in a secure location). Never put it in CI.

### 4. GitHub Environment: `production-signing`

Environment exists (created 2026-06-17). The `whisper-binaries.yml` workflow references it via `environment: production-signing` on the `build-macos`, `build-windows` and `publish-release` jobs, so the signing / notarization / manifest secrets are scoped to those jobs only (not repo-wide).

**Required-reviewer gate**: **live**. The environment carries a `required_reviewers` protection rule with `marcinobel` as the sole reviewer (`prevent_self_review: false`). Every whisper build therefore waits for an explicit approval in the Actions UI before any signing secret is attached.

Verify anytime:

```bash
gh api repos/qodeca/erfana/environments/production-signing --jq '.protection_rules'
```

`can_admins_bypass` is `true`, so a repo admin can still skip the wait — the gate is an anti-mistake control, not a defence against a compromised admin account. The underlying trust boundary is unchanged: only repo admins can edit `.github/workflows/`, the same trust model as every other repo secret (e.g. `CLAUDE_CODE_OAUTH_TOKEN`).

### 5. Tag protection on whisper-build-* tags

**Enabled** via Rulesets — ruleset `protect-whisper-build-tags`, ID `17762301`, created 2026-06-16 (a sibling ruleset, `17762300`, covers the `v*.*.*` app-release tags):
- `target: tag`, `include: refs/tags/whisper-build-*`
- `rules: [deletion, non_fast_forward]` — prevents deletion or force-push of any `whisper-build-*` tag.
- `enforcement: active`, `bypass_actors: []` (no bypass; even admins must delete via a ruleset edit).

Verify anytime via `gh api repos/qodeca/erfana/rulesets/17762301`.

## Triggering a build

`Actions` tab → **Whisper Binaries** workflow (file `.github/workflows/whisper-binaries.yml`) → `Run workflow`. Inputs:

- `upstream_sha` — full 40-char SHA from https://github.com/ggml-org/whisper.cpp. Always pin by SHA, not tag (tags are mutable).
- `upstream_label` — `v1.8.4` or similar. Appears in release title.
- `erfana_revision` — integer, monotonic. Increment on rebuild (e.g. cert rotated; compiler pinned differently).
- `skip_notarization` — debug only; the publish job refuses to create the release if this is true.

Three of the workflow's four jobs — `build-macos`, `build-windows` and `publish-release` — declare `environment: production-signing`; only `validate-inputs` runs ungated. The approval prompt therefore appears within seconds of dispatch, as soon as input validation passes, and the run sits idle at the two build jobs until a reviewer approves. It does **not** build for ~25 minutes and then stop at publish. Approval is what attaches the signing / notarization / manifest secrets.

Typical end-to-end time once approved: ~25–30 minutes (macOS build ~15 min + Windows build ~8 min + notary queue ~5–10 min).

## Diff-review checklist (every upstream bump)

**Before** triggering a workflow for a new upstream SHA, review the diff:

```bash
git clone --bare https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp.git
git log --oneline OLD_SHA..NEW_SHA
```

Flag for manual review:

- [ ] Any new network syscalls (`fetch`, `curl`, `wget`, socket opens)
- [ ] Any new `fs` / filesystem access outside of model loading / log writing
- [ ] Any new dependency added in `CMakeLists.txt`, `ggml/CMakeLists.txt`, or vendored code
- [ ] Any changes to signing / update mechanics (unlikely in whisper.cpp, but still)
- [ ] **Was the CLI binary renamed upstream?** Both build jobs probe for the executable in preference order — `whisper-whisper` → `whisper-cli` → `main` (`build-macos` step "Verify universal binary contains both slices"; `build-windows` step "Stage artifact dir") — precisely because upstream has already renamed it once. `main` is a deprecation shim that prints a warning and exits. A name outside that list fails the build outright; a reshuffle of which name is the real CLI can stage the shim instead, which only the JFK smoke test catches. Update the probe list in **both** jobs on any rename.
- [ ] **Did the sidecar DLL set change?** The Windows staging step copies `build\bin\Release\*.dll` blindly, while `src/main/services/whisper-assets.ts` pins exactly four by name, size and SHA-256 (`whisper.dll`, `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll`). A DLL added, dropped or renamed upstream silently changes the shipped zip without changing the pin: a dropped or renamed one hard-fails install on end-user machines, an added one ships unverified. Re-derive the pins, and consider a `SCHEMA_VERSION` bump (see "Bumping the app-side pin", step 6).
- [ ] Release notes from upstream — note any CVEs or security fixes

If any item surfaces something suspicious, escalate or pin to an earlier SHA.

This checklist and ["Security pre-check before the PR merge"](#security-pre-check-before-the-pr-merge) read the same upstream commit range at two different moments: run this one **before** dispatching the workflow, and the pre-check as the reviewer's gate **before** merging the app-side pin bump. They overlap deliberately — if you change one, change the other.

## Cert-revocation runbook

### Apple Developer ID cert revoked

1. Revoke in [Apple developer portal](https://developer.apple.com/account/resources/certificates/list).
2. Generate new Developer ID Application cert, export as .p12.
3. Update `APPLE_CERT_P12` + `APPLE_CERT_PASSWORD` in `production-signing` environment.
4. Trigger `whisper-binaries` workflow with `erfana_revision` bumped by 1 (e.g. `erfana2`).
5. Update `src/main/services/whisper-assets.ts` in a hot-fix Erfana release pointing at the new `whisper-build-*` tag.
6. **Time budget**: ~6 hours end-to-end (cert provisioning is slow).

### Minisign primary key compromised

1. Generate new primary keypair on Marcin's Mac.
2. Update `MANIFEST_SIGNING_KEY` + `MANIFEST_SIGNING_KEY_PASSWORD` in `production-signing`.
3. Commit new `primary.pub` to `src/main/services/whisper-pubkeys.ts` (rotation pubkey remains unchanged). Existing installs still trust the rotation key, so there's no trust gap.
4. Trigger `whisper-binaries` workflow with `erfana_revision` bumped. Manifest will be signed by the new primary.
5. Ship hot-fix Erfana release with the updated pubkey file.
6. **Time budget**: ~3 hours.

### Minisign rotation key compromised (extremely rare — it's offline)

1. Generate a new rotation keypair offline.
2. Ship Erfana hot-fix with new rotation pubkey embedded. The primary continues to sign.
3. No `whisper-binaries` rebuild required.
4. **Time budget**: ~2 hours.

### Both minisign keys compromised simultaneously

1. Generate a completely fresh keypair.
2. Emergency Erfana release with new pubkey.
3. Users on the old Erfana version **cannot verify** any newly-signed manifest until they update. Accept this gap.
4. **Time budget**: 3–6 hours for release; days-to-weeks for full user-update penetration.

### GitHub Actions outage

No rebuild possible during the outage. Existing `whisper-build-*` releases remain reachable via their published asset URLs. Document the acceptable-outage window in the release-freeze policy; typically not actionable (wait it out).

## Scheduled canary (wired — runs monthly)

`.github/workflows/whisper-binaries-canary.yml` runs automatically on the 1st of every month at 09:00 UTC. Two jobs:

- **`macos-notarization-canary`** — calls `xcrun notarytool history` with the same Apple ID / app-specific password / team ID the main workflow uses for `notarytool submit`. Non-zero exit = credentials can no longer authenticate. Catches the silent-rotation failure where an Apple app-specific password expires after ~6 months of inactivity.
- **`windows-signtool-canary`** — currently a **resolvability** probe only (`Get-Command signtool.exe`). Phase 4 ships unsigned on Windows, so there's no cert chain to verify yet. Phase 5 grows this into a real `signtool verify` once the Windows cert is procured.
- **`notify-on-failure`** — on any probe failure, creates (or comments on) a GitHub issue with the failure date + run URL + link to the cert-revocation runbook. Label: `canary`.

Manual trigger: `gh workflow run whisper-binaries-canary.yml`.

## Non-reproducibility caveat

CMake embeds a git commit SHA + build timestamp into the compiled artifact. Re-running the workflow with the same `upstream_sha` + `erfana_revision` **does not** produce bit-identical binaries. The SHA-256 pin in `src/main/services/whisper-assets.ts` is "the hash of the build we published" — not "the hash of any deterministic rebuild".

Quarterly integrity task: download and re-verify a random shipped binary against its pinned SHA-256 (e.g. `curl -sL https://github.com/qodeca/erfana/releases/download/whisper-build-v1.8.4-erfana1/whisper-win-x64-v1.8.4-erfana1.zip | shasum -a 256`).

## Cost

`qodeca/erfana` is a **public** repository, and every job in this workflow runs on a GitHub-hosted **standard** runner (`macos-14`, `windows-latest`, `ubuntu-latest`). Those are billed at zero minutes for public repos, so a whisper rebuild costs **no GitHub Actions spend** — at any cadence, not just the typical 4–6 rebuilds per year.

The real budget is wall-clock, not money:

- `macos-14` build + sign + notarize — ~15 min, plus ~5–10 min of notary queue
- `windows-latest` build — ~8 min
- `ubuntu-latest` publish — ~2 min

The only recurring cash cost attached to this workflow is the **Apple Developer Program ($99/yr)**, already paid for the app signing.

Two changes would reinstate per-minute billing, so revisit this section if either happens: making the repo private (macOS minutes carry a 10× multiplier — that is what put the earlier estimate at ~$24 per rebuild and ~$150/yr), or moving any job to a larger or otherwise billed runner.

## Bumping the app-side pin

After CI publishes a new `whisper-build-<label>-erfana<N>` release, the app-side pin (`src/main/services/whisper-assets.ts`) must be updated in lock-step before the next Erfana app release ships. Skipping any step below leaves the trust chain in an inconsistent state and will throw `WHISPER_SOURCE_PIN_DRIFT` on end-user machines.

### Checklist (~15 minutes)

1. **Open the new release's `manifest.json`** in the GitHub Releases UI or via:
   ```bash
   gh release download whisper-build-<label>-erfana<N> --repo qodeca/erfana --pattern 'manifest.json'
   cat manifest.json | jq .
   ```
2. **Extract the per-platform SHAs and sizes** from the manifest. You need:
   - `artifacts.macosUniversal.{filename, sha256, size}`
   - `artifacts.win64.{filename, sha256, size}`
   - Per-file SHAs for main binary + sidecars (computed at build time — download the artifact and `shasum -a 256 <extracted_file>` for each).
3. **Update `src/main/services/whisper-assets.ts`**:
   - `RELEASE_TAG` → new tag string (e.g. `'whisper-build-v1.9.0-erfana1'`)
   - `RELEASE_URL_BASE` → `https://github.com/qodeca/erfana/releases/download/<RELEASE_TAG>`
   - `MIN_REVISION_INDEX` → bump to match `manifest.revisionIndex` (**monotonic — never decrease**)
   - `ARTIFACTS['darwin-universal']` + `ARTIFACTS['win32-x64']` → new filenames, SHAs, sizes, per-file pins
4. **Update `docs/windows/phase4-binary-spec.md`**:
   - Append a new entry to the history table with all SHAs.
   - Keep previous entries for retention / forensic reference.
5. **Update `docs/CHANGELOG.md`** with a new in-flight / next-version section noting the pin bump + the upstream whisper.cpp version.
6. **Bump `SCHEMA_VERSION` only if the on-disk layout changed** — e.g. a new sidecar DLL appeared, an existing one was renamed. Bumping `SCHEMA_VERSION` triggers legacy-cruft migration on end-user machines.
7. **Run the pre-commit verification**:
   ```bash
   npm run lint
   npm run typecheck
   npm run test:main -- src/main/services/WhisperModelManager.test.ts src/main/services/WhisperModelManager.downgrade.test.ts src/main/services/LocalWhisperService.test.ts src/main/utils/
   ```
8. **Local smoke test** (on at least one of macOS / Windows, or both):
   - Delete `{userData}/whisper/` to force a fresh install.
   - Launch Erfana → Settings → Transcription → Backend = Local → Download model → transcribe a test audio file.
   - Expected log: `INFO: Whisper binary installed` with the new `manifestRevision` value.
9. **Commit** with a conventional message: `feat(whisper): pin whisper-build-<label>-erfana<N> (upstream <whisper.cpp version>)`.
10. **PR review** — reviewer should confirm: (a) SHAs match manifest, (b) `MIN_REVISION_INDEX` monotonic, (c) `CHANGELOG.md` mentions the security-relevant upstream changes (see the [diff-review checklist](#diff-review-checklist-every-upstream-bump) above).

### Security pre-check before the PR merge

Read the upstream whisper.cpp commit range between the previous pin and the new one:

```bash
git -C <path-to-cloned-whisper.cpp> log --oneline <old_upstream_sha>..<new_upstream_sha>
```

Flag any commit that:
- adds a new network syscall (`socket`, `connect`, `getaddrinfo` appearances in diff).
- adds new filesystem syscalls that write outside the expected working dir.
- adds new `CMakeLists.txt` dependency entries.
- touches signature / crypto primitives in surprising places.

If any red flag — treat as a security review, don't auto-merge. This is the reviewer-side twin of the [diff-review checklist](#diff-review-checklist-every-upstream-bump) above: same commit range, different moment. Keep the two in sync.

## Minisign manifest-signing keys

### Why minisign (not cosign / Sigstore)

See [ADR 0002](../adrs/0002-minisign-over-cosign-sigstore.md) for the full decision and alternatives. Short version: minisign gives us offline verification (no Rekor dependency), tiny verifier surface (`verifyManifest.ts` is 209 lines), and no CA chain.

### Dual-pubkey architecture (primary + rotation)

See [ADR 0003](../adrs/0003-dual-pubkey-trust-primary-rotation.md). Primary key lives in the `production-signing` GitHub Environment secret `MANIFEST_SIGNING_KEY`; rotation key lives **offline on a hardware token** and is only used during an incident. Both pubkeys are embedded in `src/main/services/whisper-pubkeys.ts`.

### Known minisign gotchas

Hard-won knowledge from Phase 4 implementation — documented here so future maintainers don't re-derive them:

1. **Key-ID byte order is reversed for display only.** The on-wire key ID in the signature file header is 8 bytes in little-endian order; the `minisign` CLI and `.pub` files show the hex reversed (big-endian). `verifyManifest.ts:91` reverses those bytes in a single statement, purely so the `signingKeyId` we report and log matches what a maintainer sees in the `.pub` file and the release description. The actual key-ID **comparison** runs on the raw, un-reversed bytes via `timingSafeEqual` (`verifyManifest.ts:109`). Future maintainers comparing hex dumps of `.pub` files vs `.minisig` payload: the bytes are reversed.
2. **Two signature algorithm variants**: `Ed` (legacy, raw Ed25519 over the manifest bytes — magic bytes `0x45 0x64`) and `ED` (prehashed via BLAKE2b-512, then Ed25519 over the 64-byte digest — magic bytes `0x45 0x44`, the minisign ≥ 0.7 default). Both pairs are needed to detect both variants. `detectAlg` (`verifyManifest.ts:144-158`) matches the first two bytes against the `MINISIGN_ALG_ED_LEGACY` / `MINISIGN_ALG_ED_PREHASHED` constants (`verifyManifest.ts:29-30`) and throws `unsupported-algorithm` on anything else. Future test signers must produce one of these two variants — check `minisign --version` first.
3. **Pure-JS verifier via `@noble/ed25519`.** We chose this over `sodium-native` to keep the verifier a pure-function with no native bindings. Tradeoff: ~100µs per verify vs ~10µs native — negligible for once-per-install use.
4. **Test fixture pattern**: `src/main/utils/verifyManifest.test.ts` uses a real published manifest + signature from `whisper-build-v1.8.4-erfana1` as fixture bytes. When the pin advances, either (a) the fixture stays pointing at the old release (still cryptographically valid) or (b) refresh the fixture to the new release. Do NOT generate synthetic manifests with test keypairs — that would miss the `Ed`/`ED` variant-detection path.

## Rejected approaches (don't re-propose without reading this section)

1. **PowerShell `Compress-Archive` for Windows zips**. Produces stream-format zips that Node's `extract-zip` (via `yauzl`) rejects on long or non-ASCII paths. Use `7z a -tzip -mx=9 ...` as currently. A cleanup PR removing 7z as "redundant since Windows has native zip" would break every Erfana Windows install silently — the round-trip extract-zip check in the workflow catches it at CI time, but only if the check isn't removed too. **Leave 7z + extract-zip round-trip test in place.**
2. **Live-log grep for leaked secrets from inside the runner job.** Infeasible — the runner doesn't have read access to its own rendered log (logs stream out to GitHub storage). The current impl scans `$GITHUB_STEP_SUMMARY` + `manifest.json` for credential patterns as a belt-and-suspenders check; the primary defense is GitHub's built-in `::add-mask::` redaction.
3. **"Latest" Xcode on `macos-14` runner.** The runner image ships a specific Xcode version; `latest` is a moving target that can break notarization or cmake detection. `macos-14` currently ships 16.2 as latest (16.3 is NOT available as of 2026-04-22). Bump carefully when the runner image updates — check the `runner-images` repo release notes first.
4. **Pin to ggml-org releases (Option B).** Never worked for macOS — no CLI binary published. See [ADR 0001](../adrs/0001-self-host-whisper-binaries.md) for the full rejection.
5. **Bundle whisper inside the Erfana installer.** Rejected in ADR 0001 — balloons installer size by ~8 MB for users who never turn on local transcription. The current lazy-download UX is better.

## Related

- Pinned SHAs + per-platform filenames: [`docs/windows/phase4-binary-spec.md`](../windows/phase4-binary-spec.md)
- Erfana client-side code: `src/main/services/WhisperModelManager.ts` + `whisper-assets.ts`
- Issue tracker: #165 (issue not present in the public repo)
- Upstream: [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)

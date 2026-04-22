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

Then re-enable the signtool step in `build-windows` (commented placeholder exists).

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

Environment exists (created 2026-04-22 via `gh api`). The `whisper-binaries.yml` workflow references it via `environment: production-signing` so all secrets are scoped to that job only (not repo-wide).

**Required-reviewer gate**: currently **unavailable** despite qodeca org being on the Team plan. Both the API (`PUT /environments/production-signing` with `reviewers`) and the web UI (Settings → Environments → production-signing) do NOT surface the option. Likely causes (untested):

- Org-level policy: check `Settings → Actions → General → Deployment protection rules` at org level; enable if present.
- Plan-propagation lag post-upgrade.
- Docs-vs-reality mismatch on the Team tier.

**Deferred**: revisit if a follow-up shows the option. Trust fallback: only repo admins can edit `.github/workflows/`, so the secret-exfiltration surface is bounded by existing GitHub access control. This matches the trust model of every other repo secret (e.g. `CLAUDE_CODE_OAUTH_TOKEN`).

### 5. Tag protection on whisper-build-* tags

**Enabled** via Rulesets (ruleset ID `15399782`, created 2026-04-22 via `gh api`):
- `target: tag`, `include: refs/tags/whisper-build-*`
- `rules: [deletion, non_fast_forward]` — prevents deletion or force-push of any `whisper-build-*` tag.
- `enforcement: active`, `bypass_actors: []` (no bypass; even admins must delete via a ruleset edit).

Verify anytime via `gh api repos/qodeca/erfana/rulesets/15399782`.

## Triggering a build

`Actions` tab → `whisper-binaries` workflow → `Run workflow`. Inputs:

- `upstream_sha` — full 40-char SHA from https://github.com/ggml-org/whisper.cpp. Always pin by SHA, not tag (tags are mutable).
- `upstream_label` — `v1.8.4` or similar. Appears in release title.
- `erfana_revision` — integer, monotonic. Increment on rebuild (e.g. cert rotated; compiler pinned differently).
- `skip_notarization` — debug only; the publish job refuses to create the release if this is true.

The `publish-release` job is gated by the `production-signing` environment — a repo admin must approve before it runs (this is when secrets are attached).

Typical end-to-end time: ~25–30 minutes (macOS build ~15 min + Windows build ~8 min + notary queue ~5–10 min).

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
- [ ] CVE database check: `pip install safety; safety check` against whisper.cpp's deps
- [ ] Release notes from upstream — note any CVEs or security fixes

If any item surfaces something suspicious, escalate or pin to an earlier SHA.

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

## Scheduled canary (Phase 5 follow-up)

A separate `.github/workflows/whisper-binaries-canary.yml` runs monthly and validates credentials haven't silently rotated out:

```
xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID"
signtool verify /pa /v <last published whisper.exe>
```

Emits a failure notification if credentials are invalid. Catches app-specific-password rotation silent failures.

_Canary workflow not yet authored — Phase-5 scope._

## Non-reproducibility caveat

CMake embeds a git commit SHA + build timestamp into the compiled artifact. Re-running the workflow with the same `upstream_sha` + `erfana_revision` **does not** produce bit-identical binaries. The SHA-256 pin in `src/main/services/whisper-assets.ts` is "the hash of the build we published" — not "the hash of any deterministic rebuild".

Quarterly integrity task: download and re-verify a random shipped binary against its pinned SHA-256 (e.g. `curl -sL https://github.com/qodeca/erfana/releases/download/whisper-build-v1.8.4-erfana1/whisper-win-x64-v1.8.4-erfana1.zip | shasum -a 256`).

## Cost

Per rebuild on GitHub-hosted runners (private repo billing):

- `macos-14` × ~15 min × $0.16/min × 10× multiplier = **~$24**
- `windows-latest` × ~8 min × $0.008/min × 2× multiplier = **~$0.13**
- `ubuntu-latest` publish × ~2 min = **~$0.02**

Total **~$24 per rebuild**. At a typical cadence of 4–6 rebuilds per year, **annual budget ceiling ≈ $150**.

## Related

- Pinned SHAs + per-platform filenames: [`docs/windows/phase4-binary-spec.md`](../windows/phase4-binary-spec.md)
- Erfana client-side code: `src/main/services/WhisperModelManager.ts` + `whisper-assets.ts`
- Issue tracker: [#165](https://github.com/qodeca/erfana/issues/165)
- Upstream: [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)

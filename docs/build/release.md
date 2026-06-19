# Release pipeline

This document is the operator reference for the Erfana multi-platform release pipeline introduced in [#174](https://github.com/qodeca/erfana/issues/174).

> **Service name note:** Microsoft has renamed "Azure Trusted Signing" to "Azure Artifact Signing". This doc uses the new name; the Azure CLI verb is still `az trustedsigning` and the electron-builder config key remains `win.azureSignOptions`. It covers topology, secrets, rotation calendar, end-user verification, failure recovery, and incident response.

Design summary: one `v*.*.*` tag push from `main` produces one GitHub draft release containing signed, notarized artifacts for Windows + macOS (the Linux distribution target was dropped), plus a minisign-signed `SHA256SUMS`. The local [`releasing-erfana`](../../.claude/skills/releasing-erfana/SKILL.md) skill handles pre-tag sanity, tag push, CI polling, cryptographic verification, and human approval. CI owns build, sign, notarize, verify, and draft upload.

> **SLSA Build L2 attestations are not used.** GitHub gates `actions/attest-build-provenance` to Enterprise Cloud for private repos. qodeca is on the **Team plan**, which still does not enable attestations for private repos (Enterprise required), so this layer is disabled. The minisign signature on the aggregate `SHA256SUMS` + per-platform OS signing (Developer ID notarization on macOS, Azure Artifact Signing Authenticode on Windows) are the authenticity anchors. The trust model is equivalent for end-user verification; attacker must compromise either the release-signing minisign key OR a platform signing credential to forge, independent of any GitHub-specific trust anchor. Trigger to re-enable: org upgrades to Enterprise Cloud, or the repo is made public.

## Topology

```
  operator                 GitHub                      GitHub Actions
  (local skill)            (tag + draft)               (release.yml)
      │
      │  push v*.*.*
      ├──────────────────►─┐
      │                    │
      │                    │   on: push: tags: v*.*.*
      │                    ├──────────────────────────► prepare
      │                    │                            │
      │                    │                            ├── assert release-notes file
      │                    │                            ├── assert checks.yml green for SHA
      │                    │                            └── gh release create --draft
      │                    │                            │
      │                    │                    ┌───────┴───────┐
      │                    │                    │               │
      │                    │                build_mac       build_win
      │                    │                    │               │
      │                    │               │  electron-builder       │
      │                    │               │    --publish never      │
      │                    │               │  verify sigs locally    │
      │                    │               │  gh release upload      │
      │                    │               └────────────┬────────────┘
      │                    │                            │
      │                    │                        finalize
      │                    │                            │
      │                    │              wait for asset list to stabilize
      │                    │              strip leaked latest*.yml
      │                    │              sha256sum *  →  SHA256SUMS
      │                    │              minisign sign  →  SHA256SUMS.minisig
      │                    │              export sha256sums as workflow output
      │                    │
      │  gh run watch      │
      │◄───────────────────┤
      │                    │
      │  gh release view + download
      │◄───────────────────┤
      │
      │  local verify:
      │    minisign -V SHA256SUMS.minisig
      │    sha256sum each asset == SHA256SUMS entry
      │    equality against workflow-output digest
      │
      │  operator approval
      │    gh release edit v{tag} --draft=false --latest
```

## Sequence

```mermaid
sequenceDiagram
  participant O as Operator
  participant S as releasing-erfana skill
  participant GH as GitHub
  participant CI as release.yml
  O->>S: "release v0.9.5"
  S->>S: Phase 0 — branch gate, semver, CHANGELOG, checks.yml green
  S->>O: AskUserQuestion: summary bullets
  O-->>S: bullets
  S->>GH: push commit (bump+CHANGELOG+notes)
  GH-->>S: checks.yml runs; S polls for green
  S->>GH: push signed tag v0.9.5
  GH->>CI: trigger release.yml
  CI->>GH: gh release create --draft
  par matrix
    CI->>GH: build_mac uploads .dmg (arm64 only, notarized + stapled)
    CI->>GH: build_win uploads .exe (Authenticode signed)
  end
  CI->>GH: finalize signs SHA256SUMS with minisign
  S-->>GH: gh run watch --exit-status
  GH-->>S: success
  S->>GH: download draft assets
  S->>S: minisign -V, sha256 compare, workflow-output digest equality
  S->>O: AskUserQuestion: publish + mark latest?
  O-->>S: approve
  S->>GH: gh release edit v0.9.5 --draft=false --latest
  S->>S: Phase 5 — post-publish verification
  S-->>O: URL + summary
```

## Secrets

All secrets live in the GitHub repo `qodeca/erfana` (Settings → Secrets and variables → Actions). Variables (non-secret) live in the same UI under Variables. The signing jobs also require a GitHub Environment named `production-signing` with required reviewers — this is what gates human approval before any credential is touched.

| Secret or variable | Scope | Purpose | Rotation policy |
|---|---|---|---|
| `APPLE_ID` | secret | Apple ID email that owns the app-specific password | Only on account rotation |
| `APPLE_APP_SPECIFIC_PASSWORD` | secret | notarytool auth (user-auth mode, not altool) | Rotate at [appleid.apple.com](https://appleid.apple.com) when needed |
| `APPLE_TEAM_ID` | secret | Team identifier | Never (account-level) |
| `MAC_CERT_P12_BASE64` | secret | Developer ID Application cert, base64 | Before cert expiry (max 459 days since 2026-02-15) |
| `MAC_CERT_PASSWORD` | secret | `.p12` password | With the cert |
| `AZURE_TENANT_ID` | secret | Qodeca tenant | Never |
| `AZURE_CLIENT_ID` | secret | App-registration client ID (`erfana-github-ci`) | Only on SP rotation |
| `AZURE_CLIENT_CERTIFICATE_BASE64` | secret | Base64-encoded PFX bundling the app-reg signing cert private key | Before cert expiry (2-year validity) |
| `AZURE_CLIENT_CERTIFICATE_PASSWORD` | secret | PFX password (32-char random) | With the cert |
| `AZURE_SIGNING_ENDPOINT` | secret | e.g. `https://plc.codesigning.azure.net` | Never |
| `AZURE_SIGNING_ACCOUNT_NAME` | secret | Azure Artifact Signing account | Never |
| `AZURE_CERT_PROFILE_NAME` | secret | Certificate profile | On profile rotation |
| `AZURE_PUBLISHER_NAME` | variable | Publisher subject CN (must exactly match cert) | On cert rotation |
| `MINISIGN_SECRET_KEY_BASE64` | secret | Dedicated release-signing minisign **primary** key | Only on compromise (rotation key held offline) |
| `MINISIGN_KEY_PASSWORD` | secret | Minisign primary key password | With the key |

**Notarization note:** this project uses the **user-auth mode of notarytool** (Apple ID + app-specific password + Team ID). The `.p8` App Store Connect API key path is also supported by electron-builder 26 but not used here because the app-specific password was already provisioned before the release pipeline was built. Only the **altool CLI** was deprecated by Apple; notarytool itself accepts both auth modes.

**Azure auth note:** this project uses **certificate-based auth** against the app registration, not OIDC federation. electron-builder 26.8.1's `WindowsSignAzureManager.initialize()` hard-rejects `AZURE_FEDERATED_TOKEN_FILE` — its pre-flight validator only accepts `AZURE_CLIENT_SECRET`, `AZURE_CLIENT_CERTIFICATE_PATH`, or `AZURE_USERNAME`+`AZURE_PASSWORD`. Certificate auth is the security-equivalent of OIDC here: no shared secret in transit (only the public cert lives on the app registration); the private key is a rotatable GitHub Secret. Revisit OIDC when upstream adds `AZURE_FEDERATED_TOKEN_FILE` support.

**`AZ_CLIENT_SECRET` is explicitly excluded.** This is the legacy Azure CLI 1.x env var name; `checks.yml` has a guard that fails the build if any workflow references it or `altool`. The modern `AZURE_CLIENT_SECRET` (used by `@azure/identity`) is permitted as a fallback auth path but unused here.

### Rotation calendar

| Anchor | Source of truth | Calendar reminder | Next due |
|---|---|---|---|
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com | Event-driven (account compromise, key leak) — no fixed expiry | — |
| `MAC_CERT_P12_BASE64` | Apple Developer | 60 days before cert expiry | **2027-04-15** (current cert expires 2027-06-14 — verify with `security find-certificate -c "Developer ID Application" -p \| openssl x509 -noout -enddate` and refresh this date when the cert is rotated) |
| `AZURE_CLIENT_CERTIFICATE_BASE64` (auth cert — app registration credential) | `az ad app credential list --id $AZURE_CLIENT_ID --cert` | 60 days before cert expiry (currently 2028-06-15, rotated 2026-06-16) — i.e. **2028-04-16** | 2028-04-16 |
| `AZURE_CERT_PROFILE_NAME` (signing cert — service-side, separate from auth cert above) | Azure Artifact Signing profile | 60 days before certificate-profile expiry — current cert profile rotation hooks into Azure portal alerts | **2027-08-22** (assumes 2-year cert profile from initial 2025-10-22 provisioning; verify in Azure portal Trusted Signing → Certificate profiles → expiry date and refresh) |
| `MINISIGN_SECRET_KEY_BASE64` (primary) | Internal ops vault | Scheduled annually + event-driven (compromise); rotation key published alongside primary so end users can verify both | **2027-04-25** |

Owner: release engineer on rotation (currently documented under repo owner email). Concrete dates above must be re-verified against the actual cert expiries on each rotation event — they are documented best-effort anchors, not authoritative.

## Runner strategy

| Platform | Runner | Time budget | Notes |
|---|---|---|---|
| macOS | `macos-latest` (arm64 default) | ~60 min | Builds arm64 only (`--arm64`) — Apple Silicon is the sole macOS target. Intel (x64) and the `.zip` target were dropped. |
| Windows | `windows-latest` (x64) | ~45 min | Azure Artifact Signing via app-reg certificate auth (OIDC unsupported by electron-builder 26). The NSIS installer `.exe` is signed. |

No self-hosted runners for release. Self-hosted Windows with a `.pfx` on disk is explicitly out of scope — side-doors outlive the rationale for creating them.

The Linux distribution target (AppImage/deb/rpm) was dropped — Erfana ships on macOS + Windows only. Linux remains a supported dev environment and CI test runner.

## Hardened-runtime entitlements (known gap)

The main app plist (`build/entitlements.mac.plist`) contains the strictly-required keys: `cs.allow-jit`, `cs.allow-unsigned-executable-memory` (V8 requirement), `device.camera`, `device.audio-input`. The CI guard at `checks.yml:136-144` fails the build if `cs.disable-library-validation` or `cs.allow-dyld-environment-variables` ever leak into either plist.

The inherit plist (`build/entitlements.mac.inherit.plist`) grants `cs.allow-jit` and `cs.allow-unsigned-executable-memory` to **all helper processes** (Renderer + GPU + Plugin), not just Renderer. This is an upstream-imposed over-grant: electron-builder 26.8.1's `mac.entitlementsInherit` field is a **single plist applied uniformly** to every helper bundle — there is no built-in per-helper-type configuration. The Renderer helper structurally requires both keys for V8 JIT to function; granting them to GPU and Plugin helpers is the unavoidable side-effect.

**Trigger to revisit**: electron-builder ships per-helper-type entitlement support (`mac.binaries[].entitlements` or equivalent), or we adopt a custom `signFn` callback that signs each helper bundle with a tighter plist. Until then, the over-grant is documented and the CI guard prevents it from getting worse.

## Non-goals

- Auto-updater metadata (`latest.yml` / `latest-mac.yml`). `electron-builder.yml` sets `publish: null`. `finalize` deletes any leaked `latest*.yml`.
- Backfilling `v0.9.4`. First release on the new workflow is `v0.9.5`.
- `release-please` / changesets / `semantic-release`.
- Dedicated `release/*` branches.
- Linux distribution (AppImage/deb/rpm/snap). Dropped — macOS + Windows only.
- Sigstore/cosign per-binary signing.
- Reproducible builds. Electron's V8 snapshot + native module timestamps make it impractical in 2026.

## End-user verification

An end user downloading from the release page should run the following to confirm they got bytes we produced.

### 1. Integrity + aggregate signature (all platforms)

```bash
curl -LO https://github.com/qodeca/erfana/releases/download/v0.9.5/SHA256SUMS
curl -LO https://github.com/qodeca/erfana/releases/download/v0.9.5/SHA256SUMS.minisig

# Fetch our release-signing public key (see docs/security.md §Release signing).
curl -LO https://github.com/qodeca/erfana/raw/main/docs/release-pubkey.txt

minisign -V -P "$(cat release-pubkey.txt)" -m SHA256SUMS -x SHA256SUMS.minisig
sha256sum -c SHA256SUMS
```

> The minisign release pubkey is a **dedicated release-signing key**, separate from the `whisper-binaries` key. Using a second key isolates blast radius — a compromise of one does not invalidate the other.

### 2. Code signature (macOS DMG / ZIP)

```bash
# 2a. Verify the .app bundle's Developer ID signature (after mounting + copying).
codesign --verify --deep --strict --verbose=2 /Applications/Erfana.app

# 2b. Verify the DMG's stapled notarization ticket (offline check — works
# even with no network).
xcrun stapler validate /path/to/Erfana-*.dmg
```

> `spctl -a -vvv -t install <dmg>` is intentionally NOT recommended here.
> `-t install` is for `.pkg` installer packages, not DMG containers; on
> a correctly notarized + stapled DMG it returns `rejected, source=no
> usable signature` because electron-builder doesn't codesign the DMG
> container itself (only the `.app` inside it). Apple's DTS guidance
> ([thread/128683](https://developer.apple.com/forums/thread/128683)):
> "spctl is a poor way to check for that. Use codesign with
> `--check-notarization`." The `codesign --verify --deep --strict` +
> `xcrun stapler validate` pair above matches what Gatekeeper does
> offline on first open.

### 3. Authenticode signature (Windows .exe)

```powershell
# Both signatures must verify independently.
& "$env:ProgramFiles (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" `
  verify /pa /all /tw C:\Path\To\erfana-0.9.5-setup.exe
```

First-time Windows installs will see a SmartScreen warning on a newly provisioned Azure Artifact Signing identity. Reputation accrues organically regardless of EV/OV status — several successful installs will silence the warning. This is expected, not a defect.

## Failure recovery

| State | Remediation |
|---|---|
| Tag pushed; `prepare` failed (e.g., release-notes file missing) | `git push --delete origin v${version}` → fix locally → re-tag with same version. No draft to clean. |
| Tag pushed; `prepare` succeeded; any matrix leg failed | `cleanup` deletes draft and exits red. `git push --delete origin v${version}` → bump to next patch. Any signed artifact, even in a draft, burns the version. |
| Tag pushed; build all-green; `finalize` failed | Draft exists with unsigned `SHA256SUMS`. `cleanup` fires. Bump to next patch. |
| Build all-green; operator rejects at skill Phase 4 (verify-then-approve) | `gh release delete v${version} --yes --cleanup-tag=false`. Bump to next patch. |
| Draft published (`--draft=false --latest`); content bug reported | Cut hotfix `v${version+patch}` with the fix. Old release stays visible but is no longer Latest. Never edit assets in place. |
| Azure Artifact Signing outage | Hold the release. No unsigned fallback. |
| Apple notarization outage (multi-hour Apple server issue) | `gh run watch` 90-min timeout surfaces it. Operator chooses wait or abort. |
| Phase 4.2 download (operator-side): transient TCP timeout from GitHub/Fastly CDN mid-stream (`read tcp ...185.199.x.x:443: read: operation timed out`) | Use `curl -C -` per-file resume against `.assets[].apiUrl` (`-H "Accept: application/octet-stream"`, `-H "Authorization: Bearer $(gh auth token)"`, parallel) instead of `gh release download --clobber` from scratch — `gh` re-downloads completed files; curl resumes from the existing byte position. Tag is **not** burned: gates 4.3–4.5 haven't run, no signed bytes were touched. See [`docs/release-incidents/v0.9.6-cdn-recovery.md`](../release-incidents/v0.9.6-cdn-recovery.md). |

## Incident response

Each trust anchor has a revocation + communication procedure.

### A. Maintainer account compromise → malicious signed release

1. Rotate the GitHub Environment `production-signing` reviewer list immediately; remove the compromised maintainer.
2. Revoke the Apple Developer ID Application cert (Apple Developer Portal → Certificates).
3. Rotate the Azure Artifact Signing cert profile (new profile, old one disabled).
4. Rotate the minisign release keypair; generate a successor key with a staggered validity window so users can verify both until the old pubkey is withdrawn.
5. Mark the compromised releases as such via GitHub release body edit + an advisory on the repo Security tab.
6. Open a public CVE if the malicious release reached end users.
7. Publish a post-mortem naming compromised tag ranges.

### B. Azure identity compromise

1. Remove the compromised certificate credential on the Azure app registration (Azure Portal → App registrations → `erfana-github-ci` → Certificates & secrets → Certificates → delete the entry).
2. Generate a fresh X.509 keypair locally (`openssl req -x509 -nodes -newkey rsa:2048 …`), upload the public `.crt` via `az ad app credential reset --append`.
3. Replace the GitHub Secrets `AZURE_CLIENT_CERTIFICATE_BASE64` and `AZURE_CLIENT_CERTIFICATE_PASSWORD` with the new PFX.
4. Rotate the Azure Artifact Signing certificate profile (signing cert on the service, separate from the app-reg auth cert).
5. Audit recent signing operations via Azure activity log.

#### B.1 Routine cleanup of unused federated credentials

Independent of compromise: if the app registration `erfana-github-ci` has any federated credentials left over from the abandoned OIDC path (electron-builder 26 doesn't support OIDC; we use cert auth instead), they're dead code that's a live attack surface. Remove them:

```bash
APP_ID=45f70db0-2163-4ac6-80b6-1580d7c45b00  # erfana-github-ci

# List federated credentials
az ad app federated-credential list --id "$APP_ID" -o table

# Delete each unused credential by ID. Cert auth uses a separate credential
# type (key-based), so this does NOT affect the active signing path.
az ad app federated-credential delete --id "$APP_ID" --federated-credential-id <cred-id-1>
az ad app federated-credential delete --id "$APP_ID" --federated-credential-id <cred-id-2>

# Verify (the cert credential remains, the federated ones are gone).
az ad app federated-credential list --id "$APP_ID" -o table
az ad app credential list --id "$APP_ID" --cert -o table
```

#### B.2 Workstation lost — disaster recovery for Azure cert

The Azure auth cert private key (PFX + password) lives in 1Password / Bitwarden, **not** on disk. If the operator workstation is lost:

1. On a clean machine, install Azure CLI + openssl: `winget install Microsoft.AzureCLI` (Windows) or `brew install azure-cli openssl` (macOS).
2. `az login` (interactive browser flow). Confirm tenant `32ad6264-7454-4a6b-82d8-3aedd2e0867c` (Qodeca).
3. Generate a fresh keypair locally:
   ```bash
   PFX_PW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
   openssl req -x509 -nodes -newkey rsa:2048 \
     -keyout private.key -out public.crt -days 730 \
     -subj "/CN=erfana-github-ci"
   openssl pkcs12 -export -out azure-signing.pfx \
     -inkey private.key -in public.crt \
     -passout "pass:$PFX_PW"
   ```
4. Upload public cert (preserves any other credentials on the app reg via `--append`):
   ```bash
   az ad app credential reset --id "$APP_ID" --cert "@public.crt" --append --years 2
   ```
5. Replace GitHub Secrets:
   ```bash
   openssl base64 -A -in azure-signing.pfx | gh secret set AZURE_CLIENT_CERTIFICATE_BASE64 --repo qodeca/erfana
   printf '%s' "$PFX_PW" | gh secret set AZURE_CLIENT_CERTIFICATE_PASSWORD --repo qodeca/erfana
   ```
6. Store the new PFX + password in 1Password (NOT on disk — see § Secret hygiene below).
7. Dispatch a dry-run release to confirm signing still works.
8. Once confirmed, remove the OLD certificate credential entry from the app registration via Portal or `az ad app credential delete` (otherwise both old + new accept tokens for the next 2 years until expiry).

The cert is short-lived (2 years) so this DR path is straightforward — the procedure above takes ~15 minutes on a clean machine.

#### B.3 Secret hygiene — Azure cert PFX + password

- **Storage:** the PFX and its password live ONLY in 1Password (or equivalent password manager). They are NEVER on disk for longer than the seconds it takes to base64-encode and `gh secret set`.
- **Anti-pattern (do NOT use):** `~/Documents/erfana-signing-backup/` or any path under `~/Documents`, `~/Downloads`, OneDrive-synced folders, iCloud Drive, or any cloud-synced location. OneDrive auto-syncs and the PFX would land in Microsoft's cloud + version history; even after deletion the OneDrive Recycle Bin retains it for 30+ days.
- **Migration of any existing on-disk PFX backup:** copy to 1Password as a secure-note attachment named "Erfana Azure signing cert (expires <YYYY-MM-DD>)", verify the entry, then securely delete the on-disk copy (`sdelete` on Windows, `shred` on POSIX). Inspect OneDrive Recycle Bin and version history; purge any cloud copies.
- **Encryption algorithm — must be AES (PBES2), not legacy:** when (re-)exporting the PFX, force modern PKCS#12 encryption. The CI runner's OpenSSL 3.x and `@azure/identity` (Node) **reject** legacy PKCS#12 algorithms (`pbeWithSHA1And40BitRC2-CBC`, `3DES`) — a legacy PFX fails the decode step with `Decoded file is not a valid PKCS#12 envelope or password is wrong` even when the secret pair is correct. macOS LibreSSL reads legacy PFXs transparently, so a local `MAC verified OK` does **not** prove CI compatibility. Export and verify with OpenSSL 3.x:
  ```bash
  openssl pkcs12 -export -inkey azure-private.key -in azure-public.crt \
    -out azure-signing.pfx -passout env:PFXPW \
    -keypbe AES-256-CBC -certpbe AES-256-CBC -macalg sha256
  # Verify it loads WITHOUT -legacy (this is exactly what CI does):
  openssl pkcs12 -info -in azure-signing.pfx -noout -password env:PFXPW
  ```
  Re-exporting only changes the container encryption — the cert identity and validity are unchanged, so app-registration trust and expiry are unaffected. First burned: v0.16.2 ([`docs/release-incidents/v0.16.2-attempt-1.md`](../release-incidents/v0.16.2-attempt-1.md)).
- **Rotation reminder:** add a calendar entry 60 days before the cert's expiry date — see the rotation calendar table above.

### C. Minisign key compromise

1. Immediately publish the successor pubkey alongside a revocation notice in `docs/security.md` and pinned in the repo README.
2. Re-sign the `SHA256SUMS` of the last known-good release with the new key; upload as an additional asset with a versioned name (e.g., `SHA256SUMS.minisig.v2`).
3. Verify the old key has not been used to sign any unknown artifacts.

### D. Signed malware published (supply-chain attack)

This is A + C simultaneously. Trigger both. Additionally: open an urgent advisory on the repo; if end users are affected, coordinate a CVE within 72 hours.

## Relationship to other workstreams

- **[#166](https://github.com/qodeca/erfana/issues/166)** (Windows Phase 5 — distribution hygiene): this work supersedes the Windows signing + `example.com` updater-URL elements. Once this lands, narrow #166 to NSIS UX tweaks (`oneClick`, `perMachine`) or close it.
- **[#165](https://github.com/qodeca/erfana/issues/165)** (Phase 4 whisper): shipped in v0.9.4. Its minisign dual-pubkey trust chain is a pattern reference, not a shared keypair.
- **`whisper-binaries.yml`**: template for keychain setup, minisign signing, and signed-artifact upload. We mine it; we do not reuse its signing key.

## Branch protection (Phase I — done 2026-04-25)

Phase I configuration was applied after dry-run [`24925269258`](https://github.com/qodeca/erfana/actions/runs/24925269258) validated all 5 jobs end-to-end on the new pipeline.

**`main` branch protection** ([`gh api repos/qodeca/erfana/branches/main/protection`](https://api.github.com/repos/qodeca/erfana/branches/main/protection)):

- Required status checks (strict mode — branch must be up to date before merge): `Lint`, `Typecheck`, `Unit tests`, `Build`, `npm audit signatures`, `Release readiness guards`.
- **No PR review requirement** (`required_pull_request_reviews: null`) — direct push to `main` is the intended solo-developer workflow. The release skill verifies this at Phase 0.4.5 and aborts if the rule is reinstated.
- `enforce_admins: true` — administrators included.
- `allow_force_pushes: false`, `allow_deletions: false`.
- Conversation resolution required.

> **Solo-dev calibration history (all on 2026-04-25):** Phase I initially shipped with `required_approving_review_count: 1`. That was reduced to `0` during v0.9.5 release prep because GitHub blocks self-approval and Copilot reviews are always `COMMENTED`, never `APPROVED`. After the v0.9.5 release actually shipped via PR #190, the friction was real — every release would re-pay the same PR detour — so `required_pull_request_reviews` was removed entirely the same day:
>
> ```bash
> gh api -X DELETE repos/qodeca/erfana/branches/main/protection/required_pull_request_reviews
> ```
>
> If a second developer joins the team, restore the rule and update the release skill's Phase 0.4.5 check to allow PR mode:
>
> ```bash
> gh api -X PATCH repos/qodeca/erfana/branches/main/protection \
>   -F 'required_pull_request_reviews[required_approving_review_count]=1' \
>   -F 'required_pull_request_reviews[dismiss_stale_reviews]=true'
> ```
>
> All other Phase I gates — signed-tag ruleset, 6 required status checks, `enforce_admins=true`, conversation resolution, no force pushes, no deletions — remain intact throughout.

**Protected tag ruleset** (id [`15540259`](https://github.com/qodeca/erfana/rules/15540259)):

- Pattern: `refs/tags/v*.*.*`.
- Rules: `deletion` blocked, `non_fast_forward` blocked, `required_signatures` enforced (SSH or GPG signed tags only).
- `bypass_actors: []` — no exceptions.

**Deliberate exclusion: `e2e`** is **not** in the required-checks list. As of 2026-04-25 the `e2e` workflow has been red on develop for several consecutive runs; including it would green-lock the repo. Add it back once stable:

```bash
gh api -X PATCH repos/qodeca/erfana/branches/main/protection/required_status_checks \
  -F 'contexts[]=Lint' -F 'contexts[]=Typecheck' -F 'contexts[]=Unit tests' \
  -F 'contexts[]=Build' -F 'contexts[]=npm audit signatures' \
  -F 'contexts[]=Release readiness guards' -F 'contexts[]=e2e'
```

Rationale (kept for archaeology): flipping branch protection before the new `checks.yml` guards landed green on `develop` would have green-locked the repo. The dry-run gate above served as that validation.

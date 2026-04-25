# Release pipeline

This document is the operator reference for the Erfana multi-platform release pipeline introduced in [#174](https://github.com/qodeca/erfana/issues/174).

> **Service name note:** Microsoft has renamed "Azure Trusted Signing" to "Azure Artifact Signing". This doc uses the new name; the Azure CLI verb is still `az trustedsigning` and the electron-builder config key remains `win.azureSignOptions`. It covers topology, secrets, rotation calendar, end-user verification, failure recovery, and incident response.

Design summary: one `v*.*.*` tag push from `main` produces one GitHub draft release containing signed, notarized artifacts for Windows + macOS + Linux, plus a minisign-signed `SHA256SUMS`. The local [`releasing-erfana`](../../.claude/skills/releasing-erfana/SKILL.md) skill handles pre-tag sanity, tag push, CI polling, cryptographic verification, and human approval. CI owns build, sign, notarize, verify, and draft upload.

> **SLSA Build L2 attestations are not used.** GitHub gates `actions/attest-build-provenance` to Enterprise Cloud for private repos; qodeca is on Free tier, so this layer is disabled. The minisign signature on the aggregate `SHA256SUMS` + per-platform OS signing (Developer ID notarization on macOS, Azure Artifact Signing Authenticode on Windows) are the authenticity anchors. The trust model is equivalent for end-user verification; attacker must compromise either the release-signing minisign key OR a platform signing credential to forge, independent of any GitHub-specific trust anchor.

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
      │                    │               ┌────────────┼────────────┐
      │                    │               │            │            │
      │                    │           build_linux  build_mac    build_win
      │                    │               │            │            │
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
    CI->>GH: build_linux uploads .AppImage/.deb/.rpm
    CI->>GH: build_mac uploads .dmg/.zip (notarized + stapled)
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
| `MAC_CERT_P12_BASE64` | Apple Developer | 60 days before cert expiry | per cert exp date |
| `AZURE_CLIENT_CERTIFICATE_BASE64` (auth cert — app registration credential) | `az ad app credential list --id $AZURE_CLIENT_ID --cert` | 60 days before cert expiry (currently 2028-04-23) — i.e. **2028-02-22** | 2028-02-22 |
| `AZURE_CERT_PROFILE_NAME` (signing cert — service-side, separate from auth cert above) | Azure Artifact Signing profile | 60 days before certificate-profile expiry | per profile exp date |
| `MINISIGN_SECRET_KEY_BASE64` (primary) | Internal ops vault | Scheduled annually or on compromise; rotation key published alongside primary so end users can verify both | annual |

Owner: release engineer on rotation (currently documented under repo owner email).

## Runner strategy

| Platform | Runner | Time budget | Notes |
|---|---|---|---|
| Linux | `ubuntu-latest` (x64) | ~20 min | No external signing deps. Integrity via aggregate `SHA256SUMS` + minisign. |
| macOS | `macos-latest` (arm64 default) | ~60 min | Builds both arm64 + x64 via `--arm64 --x64`. Rosetta 2 preflight for cross-arch native modules. |
| Windows | `windows-latest` (x64) | ~45 min | Azure Artifact Signing via app-reg certificate auth (OIDC unsupported by electron-builder 26). Both NSIS + portable `.exe` signed independently. |

No self-hosted runners for release. Self-hosted Windows with a `.pfx` on disk is explicitly out of scope — side-doors outlive the rationale for creating them.

Linux arm64 is out of scope for v1. Revisit when user demand surfaces.

## Non-goals

- Auto-updater metadata (`latest.yml` / `latest-mac.yml` / `latest-linux.yml`). `electron-builder.yml` sets `publish: null`. `finalize` deletes any leaked `latest*.yml`.
- Backfilling `v0.9.4`. First release on the new workflow is `v0.9.5`.
- `release-please` / changesets / `semantic-release`.
- Dedicated `release/*` branches.
- Linux snap target.
- Sigstore/cosign per-binary signing.
- Per-artifact `.deb` / `.rpm` signing. Aggregate `SHA256SUMS` is the documented model.
- Reproducible builds. Electron's V8 snapshot + native module timestamps make it impractical in 2026.

## End-user verification

An end user downloading from the release page should run the following to confirm they got bytes we produced.

### 1. Integrity + aggregate signature (Linux packages)

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

## Branch-protection plan (Phase I — do last)

Only flip branch protection on `main` **after** the new workflow has run green on `develop` at least once and `checks.yml` guards have been validated.

Required settings:
- Required status checks: `checks.yml` (all jobs incl. `audit-signatures` and `release-guards`) + `e2e.yml`.
- Require a pull request before merging; include administrators.
- Protected tags rule `v*.*.*` with signature enforcement (SSH or GPG).
- Enable secret scanning + push protection repo-wide.

Rationale: flipping branch protection before the new `checks.yml` guards are green would green-lock the repo; no one would be able to merge.

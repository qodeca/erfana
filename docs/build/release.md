# Release pipeline

This document is the operator reference for the Erfana multi-platform release pipeline introduced in #174.

> **Service name note:** Microsoft has renamed "Azure Trusted Signing" to "Azure Artifact Signing". This doc uses the new name; the Azure CLI verb is still `az trustedsigning` and the electron-builder config key remains `win.azureSignOptions`. It covers topology, secrets, rotation calendar, end-user verification, failure recovery, and incident response.

Design summary: one `v*.*.*` tag push from `main` produces one GitHub draft release containing signed, notarized artifacts for Windows + macOS (the Linux distribution target was dropped), plus a minisign-signed `SHA256SUMS`. The local [`releasing-erfana`](../../.claude/skills/releasing-erfana/SKILL.md) skill handles pre-tag sanity, tag push, CI polling, cryptographic verification, and human approval. CI owns build, sign, notarize, verify, and draft upload.

> **SLSA Build L2 attestations are not used — by choice, no longer by constraint.** `qodeca/erfana` has been a **public** repository since 2026-06-16, so the Enterprise-Cloud gate GitHub applies to `actions/attest-build-provenance` on *private* repos does not apply here. The re-enable trigger this document originally recorded ("repo is made public") has already fired; the obsolete Team-plan rationale is retired. Attestations stay off pending a deliberate pipeline change — turning them on means adding `attestations: id-token: write` permissions plus an attest step to both build legs and extending the skill's Phase 4 gate to check provenance, and that work has not been scoped. Until then the authenticity anchors remain the minisign signature over the aggregate `SHA256SUMS` plus per-platform OS signing (Developer ID notarization on macOS, Azure Artifact Signing Authenticode on Windows): an attacker must compromise either the release-signing minisign key OR a platform signing credential to forge, independent of any GitHub-specific trust anchor.

## Topology

```
  operator                 GitHub                      GitHub Actions
  (local skill)            (tag + draft)               (release.yml)
      │
      │  push v*.*.*
      ├──────────────────►─┐
      │                    │
      │                    │   on: push: tags: v[0-9]+.[0-9]+.[0-9]+
      │                    │   also: workflow_dispatch, input `dry-run`
      │                    │         (default TRUE — skips draft + uploads)
      │                    │   every job gated on
      │                    │         if: github.repository == 'qodeca/erfana'
      │                    ├──────────────────────────► prepare
      │                    │                            │
      │                    │                            ├── assert release-notes file
      │                    │                            ├── assert checks.yml green for SHA
      │                    │                            ├── assert package-lock.json is
      │                    │                            │   byte-equal to that run's
      │                    │                            │   package-lock-digest artifact
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
      │                    │              upload `sha256sums-digest` artifact
      │                    │
      │                    │              ── any of prepare / build_mac / build_win
      │                    │                 not `success` (incl. cancellation) ──►
      │                    │                        cleanup
      │                    │                            │
      │                    │              delete the draft release, then exit 1
      │                    │              so the whole run goes red
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
      │    equality against the `sha256sums-digest` artifact
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
  S->>S: minisign -V, sha256 compare, sha256sums-digest artifact equality
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
| `MAC_CERT_P12_BASE64` | secret | Developer ID Application cert, base64 | Before cert expiry — the rotation calendar below holds the authoritative date |
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
| `MAC_CERT_P12_BASE64` | Apple Developer | 60 days before cert expiry | **2026-12-03** — the certificate expires **2027-02-01**, read from the live keychain on 2026-08-07 with `security find-certificate -c "Developer ID Application" -p \| openssl x509 -noout -enddate` (subject `Developer ID Application: QODECA sp. z o.o. (DZ477VK57L)`). This supersedes two earlier, mutually inconsistent estimates in this document (a "max 459 days since 2026-02-15" derivation implying 2027-05-20, and a stated 2027-06-14). Re-read the cert and refresh this row on every rotation. |
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

## Artifact set coupling (change all four together)

The release asset set is pinned in four places with no automated cross-check between them. Change one without the others and the `gh release upload` step fails on a glob that matches nothing — this burned **v0.11.1**.

| Location | What it pins | Current value |
|---|---|---|
| `electron-builder.yml` | build targets + artifact names | `mac.target: dmg` (arm64 only) with `dmg.artifactName: ${name}-${version}-${arch}.${ext}`; `win.target: nsis` with `nsis.artifactName: ${name}-${version}-setup.${ext}` |
| `.github/workflows/build_mac.yml` | upload glob | `gh release upload "$TAG" "$ART_DIR"/*.dmg` |
| `.github/workflows/build_win.yml` | signtool-verify + upload globs | `*-setup.exe` in both the verify loop and `gh release upload` |
| [`.claude/skills/releasing-erfana/SKILL.md`](../../.claude/skills/releasing-erfana/SKILL.md) § Constants | expected asset count | 2 binaries + `SHA256SUMS` + `SHA256SUMS.minisig`, i.e. `EXPECTED_ASSETS=4` (also asserted in §0.4 and `phase-4-verify.md` §4.5) |

**Verified in agreement on 2026-08-07.** The published `v0.16.3` release carries exactly four assets — `erfana-0.16.3-arm64.dmg`, `erfana-0.16.3-setup.exe`, `SHA256SUMS`, `SHA256SUMS.minisig` — matching all four definitions above. Adding or removing a build target is therefore a four-file change plus a release-notes/verification-doc sweep, never a one-line `electron-builder.yml` edit.

## Hardened-runtime entitlements (known gap)

The main app plist (`build/entitlements.mac.plist`) contains the strictly-required keys: `cs.allow-jit`, `cs.allow-unsigned-executable-memory` (V8 requirement), `device.camera`, `device.audio-input`. The CI guard fails the build if `cs.disable-library-validation` or `cs.allow-dyld-environment-variables` ever leak into either plist — it is Guard 2, the step named `Guard - no forbidden entitlements` in the `release-guards` job (`.github/workflows/checks.yml:243-251`, verified 2026-08-07).

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

Substitute the version you downloaded for `{version}` throughout — the worked example below uses **v0.16.3**, the current public release. Run the whole block from the directory that holds the downloaded `.dmg` / `.exe`: `SHA256SUMS` lists **only the two binaries** by bare filename, so `sha256sum -c` reports `No such file or directory` if you run it anywhere else.

```bash
VERSION=0.16.3   # the v{version} you downloaded, without the leading "v"

curl -LO "https://github.com/qodeca/erfana/releases/download/v${VERSION}/SHA256SUMS"
curl -LO "https://github.com/qodeca/erfana/releases/download/v${VERSION}/SHA256SUMS.minisig"

# Fetch our release-signing public keys (see docs/security.md § Release signing).
curl -LO https://github.com/qodeca/erfana/raw/main/docs/release-pubkey.txt

# release-pubkey.txt is a COMMENTED file publishing TWO keys (PRIMARY, the
# active signer, and ROTATION, the standby successor). `minisign -P` takes a
# single base64 key, so passing the whole file to -P cannot work. Extract
# both keys and accept either — the same approach the release skill uses at
# Phase 4.3. Minisign pubkey lines are 56 base64 chars starting with "RW".
PUBKEYS=()
while IFS= read -r line; do
  PUBKEYS+=("$line")
done < <(grep -E '^RW[A-Za-z0-9+/=]+$' release-pubkey.txt)

VERIFIED=0
for KEY in "${PUBKEYS[@]}"; do
  if minisign -V -P "$KEY" -m SHA256SUMS -x SHA256SUMS.minisig; then
    VERIFIED=1
    break
  fi
done

if [ "$VERIFIED" != "1" ]; then
  echo "SIGNATURE VERIFICATION FAILED — do not run this download." >&2
else
  # Run from the directory containing erfana-${VERSION}-arm64.dmg and/or
  # erfana-${VERSION}-setup.exe. SHA256SUMS names nothing else.
  sha256sum -c SHA256SUMS
fi
```

> A signature that verifies under **either** published key is valid. Accepting both is what lets us promote ROTATION to PRIMARY without re-signing historical releases. Do **not** paste the key values into your own scripts from this page — `docs/release-pubkey.txt` is the canonical copy, and `checks.yml` Guard 5 enforces byte-equality across exactly three published locations (`docs/release-pubkey.txt`, `docs/security.md`, `README.md`). A fourth copy would be unguarded and could drift silently.

> On macOS, `minisign` comes from `brew install minisign` and `sha256sum` may not exist — substitute `shasum -a 256 -c SHA256SUMS`.

> The minisign release pubkey is a **dedicated release-signing key**, separate from the `whisper-binaries` key. Using a second key isolates blast radius — a compromise of one does not invalidate the other.

### 2. Code signature (macOS DMG)

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
# signtool ships with the Windows SDK. Resolve the newest installed 10.* SDK
# bin directory instead of hardcoding a version — this mirrors what the
# "Verify Authenticode signatures (signtool)" step in build_win.yml does.
# Note the brace form ${env:ProgramFiles(x86)} — the parentheses belong
# INSIDE the braces, as part of the variable name. Leaving them outside
# (a common transcription of this path) resolves the 64-bit Program Files
# variable and appends a stray literal, giving a path that never exists.
$sdkRoot  = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
$sdkBin   = Get-ChildItem $sdkRoot -Directory `
  | Where-Object { $_.Name -match '^10\.' } `
  | Sort-Object Name -Descending `
  | Select-Object -First 1
$signtool = Join-Path $sdkBin.FullName "x64\signtool.exe"
if (-not (Test-Path $signtool)) { throw "signtool.exe not found under $sdkRoot" }

# Both signatures must verify independently.
& $signtool verify /pa /all /tw C:\Path\To\erfana-0.16.3-setup.exe
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
   # AES (PBES2) encryption is MANDATORY. Without these three flags openssl
   # writes a legacy RC2/3DES PKCS#12 container, which the CI runner's
   # OpenSSL 3.x and @azure/identity both reject — the Windows leg dies at
   # "Decode Azure signing certificate to PFX file" with "Decoded file is not
   # a valid PKCS#12 envelope or password is wrong". Same flags as § B.3;
   # omitting them burned v0.16.2.
   openssl pkcs12 -export -out azure-signing.pfx \
     -inkey private.key -in public.crt \
     -passout "pass:$PFX_PW" \
     -keypbe AES-256-CBC -certpbe AES-256-CBC -macalg sha256

   # Verify it loads WITHOUT -legacy — exactly what CI does.
   openssl pkcs12 -info -in azure-signing.pfx -noout -passin "pass:$PFX_PW"
   ```

   This applies to **both** install paths in step 1. A legacy PFX produced under
   Windows/winget and one produced under macOS/brew fail in CI identically; macOS
   is merely the more dangerous of the two, because LibreSSL reads legacy
   containers transparently, so a local `MAC verified OK` proves nothing about CI
   compatibility. See § B.3 for the full rationale and the OpenSSL 3.x check.
4. Upload public cert (preserves any other credentials on the app reg via `--append`):
   ```bash
   az ad app credential reset --id "$APP_ID" --cert "@public.crt" --append --years 2
   ```
5. Replace GitHub Secrets — **both, atomically, in the same sitting**:
   ```bash
   openssl base64 -A -in azure-signing.pfx | gh secret set AZURE_CLIENT_CERTIFICATE_BASE64 --repo qodeca/erfana
   printf '%s' "$PFX_PW" | gh secret set AZURE_CLIENT_CERTIFICATE_PASSWORD --repo qodeca/erfana
   ```

   `AZURE_CLIENT_CERTIFICATE_BASE64` and `AZURE_CLIENT_CERTIFICATE_PASSWORD` are a
   **matched pair**. Refreshing the PFX and updating only one of the two produces a
   secret set that passes the runner's size gate but fails the PKCS#12 envelope
   check with `Decoded file is not a valid PKCS#12 envelope or password is wrong`
   — the tag is burned and you bump to the next patch. This is exactly what
   happened on **v0.16.1**; the full diagnosis, including how to tell a
   password mismatch apart from a corrupted base64 payload, is in
   [`docs/release-incidents/v0.16.1-attempt-1.md`](../release-incidents/v0.16.1-attempt-1.md).
   Note that `gh secret set` from a file retains trailing CR/LF, so always pipe the
   password with `printf '%s'` — never `echo`.
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
2. Cut a **fresh patch release** signed with the successor key rather than re-signing an existing one. Do not upload a versioned extra signature alongside the existing one: assets are never edited in place (see § Failure recovery), and the asset set is a fixed four (`EXPECTED_ASSETS=4` — see § Artifact set coupling), so any fifth asset fails the release gate. Both keys stay published in `docs/release-pubkey.txt`, so signatures made before the rotation keep verifying.
3. Verify the old key has not been used to sign any unknown artifacts.

### D. Signed malware published (supply-chain attack)

This is A + C simultaneously. Trigger both. Additionally: open an urgent advisory on the repo; if end users are affected, coordinate a CVE within 72 hours.

## Relationship to other workstreams

- **#166** (Windows Phase 5 — distribution hygiene): this work supersedes the Windows signing + `example.com` updater-URL elements. Once this lands, narrow #166 to NSIS UX tweaks (`oneClick`, `perMachine`) or close it.
- **#165** (Phase 4 whisper): shipped in v0.9.4. Its minisign dual-pubkey trust chain is a pattern reference, not a shared keypair.
- **`whisper-binaries.yml`**: template for keychain setup, minisign signing, and signed-artifact upload. We mine it; we do not reuse its signing key.

## Branch protection (Phase I — done 2026-04-25)

Phase I configuration was applied after dry-run `24925269258` validated all 5 jobs (`prepare`, `build_mac`, `build_win`, `finalize`, `cleanup`) end-to-end on the new pipeline. That run record is no longer retrievable through the Actions API, so the reference is kept as a plain identifier.

**`main` branch protection** ([`gh api repos/qodeca/erfana/branches/main/protection`](https://api.github.com/repos/qodeca/erfana/branches/main/protection)):

- Required status checks (strict mode — branch must be up to date before merge), read live from the API on **2026-08-07**: `Lint`, `Typecheck`, `Unit tests`, `Build`, `License compliance`, `Secret scan`. Six checks.
  - `Secret scan` is **app-pinned** (`app_id: 15368`); the other five accept any app (`app_id: null`). This matters when editing the set — see the traps under § Deliberate exclusion below.
  - `npm audit signatures` and `Release readiness guards` are **not** required checks, despite earlier revisions of this document claiming they were. Both jobs still run on every push via `checks.yml`; they simply do not gate merges to `main`. `Windows checks` is likewise advisory and not required.
- **No PR review requirement** (`required_pull_request_reviews: null`) — direct push to `main` is the intended solo-developer workflow. The release skill verifies this at Phase 0.4.5 and aborts if the rule is reinstated.
- `enforce_admins: true` — administrators included.
- `allow_force_pushes: false`, `allow_deletions: false`.
- `required_conversation_resolution: false` — **not** enforced. With no PR flow there are no review conversations to resolve, so the setting is off.

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
> All other Phase I gates — signed-tag ruleset, the 6 required status checks, `enforce_admins=true`, no force pushes, no deletions — remain intact throughout. Conversation resolution is **not** among them: `required_conversation_resolution` is `false`.

**Protected tag rulesets.** Two are active, both with `bypass_actors: []` (no exceptions), verified live on 2026-08-07:

| id | Name | Tag pattern | Rules |
|---|---|---|---|
| [`17762300`](https://github.com/qodeca/erfana/rules/17762300) | Protected release tags (v*.*.*) | `refs/tags/v*.*.*` | `deletion` blocked, `non_fast_forward` blocked, `required_signatures` enforced (SSH or GPG signed tags only) |
| [`17762301`](https://github.com/qodeca/erfana/rules/17762301) | protect-whisper-build-tags | `refs/tags/whisper-build-*` | `deletion` blocked, `non_fast_forward` blocked (no signature requirement — these tags are cut by `whisper-binaries.yml`, not by an operator) |

Both rulesets were created on 2026-06-16, the day the repository was made public. The single ruleset id cited by earlier revisions of this document predates that and no longer resolves — always read ids from `gh api repos/qodeca/erfana/rulesets` rather than trusting a pasted one.

### Deliberate exclusion: `e2e`

`e2e` is **not** in the required-checks list. The workflow is currently `disabled_manually` (local-only until the `macos-latest` hang at `waitForLoadState('domcontentloaded')` is root-caused — see [docs/ci.md](../ci.md)), so requiring it would green-lock the repo.

To add it back once stable, use a **read-then-append** PATCH that round-trips the live set. Do not hand-write the list.

```bash
# Documentation only — read the traps below before running this.
gh api repos/qodeca/erfana/branches/main/protection/required_status_checks \
  | jq '{strict: .strict, checks: (.checks + [{context: "e2e", app_id: null}] | unique_by(.context))}' \
  | gh api -X PATCH repos/qodeca/erfana/branches/main/protection/required_status_checks --input -
```

Traps this form exists to avoid:

- **`--input -` defaults to POST.** `gh api` only switches verb when you say so, so `-X PATCH` is mandatory. Omit it and you are issuing a POST against a PATCH-only endpoint.
- **Round-trip `checks`, never `contexts`.** The flat `contexts[]` array is the deprecated representation. PATCHing it resets every entry's `app_id` to `null` — and `Secret scan` is app-pinned to `app_id: 15368`, so a `contexts` PATCH would silently un-pin it and let a status from any GitHub App satisfy that gate.
- **Never send both keys.** `checks` and `contexts` in the same payload is a `422`.
- **Echo `strict` back explicitly.** A PATCH that omits `strict` does not preserve it; losing it turns off "branch must be up to date before merge".
- **The context string is the check-run name, not the workflow name.** For `e2e.yml` the check run is named after the job id — `e2e` — while the workflow's display name is `E2E Tests`. Requiring `E2E Tests` would wait forever on a status that is never reported.
- **Hardcoded lists rot.** The snippet this replaced pinned six contexts: two that were never actually required (`npm audit signatures`, `Release readiness guards`) and, by omission, it would have deleted the two that are (`License compliance`, `Secret scan`).

Rationale (kept for archaeology): flipping branch protection before the new `checks.yml` guards landed green on `develop` would have green-locked the repo. The dry-run gate above served as that validation.

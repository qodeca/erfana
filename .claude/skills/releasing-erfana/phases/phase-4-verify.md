# Phase 4: Verify + publish checkpoint (CRITICAL)

This is the longest phase in the release flow and the only one that gates the final publish step. Three independent cryptographic checks (minisign signature, per-file SHA-256, byte-equal CI digest) must all pass before the operator may approve `gh release edit --draft=false --latest`.

**Pre-condition:** Phase 3 returned successfully — `release.yml` is green for tag `v${VERSION}` and `gh release view` reports a draft. `$RUN_ID` and `$VERSION` are set in the skill's working state.

**Post-condition:** the release is either published-and-latest (operator approved), kept as draft (operator deferred), or deleted (operator aborted). Any verification failure aborts before the operator is asked.

## 4.1 Fetch draft state

```bash
gh release view "v${VERSION}" --json isDraft,assets \
  | tee /tmp/release-meta.json
DRAFT=$(jq -r '.isDraft' /tmp/release-meta.json)
if [ "$DRAFT" != "true" ]; then
  echo "FAIL: Release is not a draft — expected a draft produced by release.yml"
  exit 1
fi
```

## 4.2 Download SHA256SUMS + every asset

```bash
WORK=$(mktemp -d)
cd "$WORK"
gh release download "v${VERSION}" --pattern '*' --clobber
ls -la
```

## 4.3 Verify minisign signature

The dedicated release minisign public keys (PRIMARY active signer + ROTATION standby successor — dual-key per ADR-0003) are published in `docs/release-pubkey.txt` as the canonical source. `docs/security.md` § Release signing and `README.md` mirror them for end-user discovery; checks.yml has a drift detector (introduced with #174) that fails the build if the three locations disagree.

Verification accepts either key (a SHA256SUMS.minisig that verifies under the primary OR the rotation key is valid). This lets the team rotate primary→rotation without re-signing old releases.

```bash
PUBKEY_FILE="docs/release-pubkey.txt"
PRIMARY_PATH="$WORK/release-primary.pub"
ROTATION_PATH="$WORK/release-rotation.pub"

# Extract every base64 minisign pubkey from the canonical file. Lines
# starting with "RW" are minisign pubkey magic; comments and blank lines
# are skipped. We expect exactly two: PRIMARY (first) + ROTATION (second).
mapfile -t PUBKEYS < <(grep -E '^RW[A-Za-z0-9+/=]+$' "$PUBKEY_FILE")
if [ "${#PUBKEYS[@]}" -lt 1 ]; then
  echo "FAIL: no minisign pubkeys extracted from $PUBKEY_FILE"
  exit 1
fi

# Sanity-validate each extracted key: minisign pubkeys are exactly 56
# characters of base64 starting with "RW" (2-byte algorithm magic +
# 8-byte key ID + 32-byte Ed25519 public key).
for KEY in "${PUBKEYS[@]}"; do
  if [ "${KEY:0:2}" != "RW" ]; then
    echo "FAIL: extracted pubkey does not start with RW magic: $KEY"
    exit 1
  fi
  if [ "${#KEY}" -ne 56 ]; then
    echo "FAIL: extracted pubkey length ${#KEY}, expected 56: $KEY"
    exit 1
  fi
done

PRIMARY="${PUBKEYS[0]}"
ROTATION="${PUBKEYS[1]:-}"

# Try primary first; on failure (verification, not extraction), retry
# under the rotation key. Both must succeed-or-fail loudly so a malformed
# .minisig file cannot silently slip through.
if minisign -V -P "$PRIMARY" -m SHA256SUMS -x SHA256SUMS.minisig; then
  echo "minisign verify: OK (PRIMARY key)"
elif [ -n "$ROTATION" ] && minisign -V -P "$ROTATION" -m SHA256SUMS -x SHA256SUMS.minisig; then
  echo "minisign verify: OK (ROTATION key — primary may be in flight rotating)"
else
  echo "FAIL: minisign verification failed under both PRIMARY and ROTATION keys"
  exit 1
fi
```

- [ ] At least one pubkey extracted with valid format (RW prefix, 56 chars)
- [ ] `minisign -V` exits 0 under primary OR rotation

## 4.4 Recompute per-asset hashes locally

```bash
ACTUAL="$WORK/SHA256SUMS.local"
# Hash every asset except the sums and its signature themselves.
(cd "$WORK" && for f in *; do
  case "$f" in SHA256SUMS|SHA256SUMS.minisig|SHA256SUMS.local) continue ;; esac
  sha256sum "$f"
done) | sort > "$ACTUAL"

# Compare against the sum list we just verified.
diff <(sort SHA256SUMS) "$ACTUAL" || {
  echo "FAIL: Local hashes differ from signed SHA256SUMS"
  exit 1
}
```

## 4.5 Compare against the `finalize` job's recorded SHA256SUMS

This catches tampering between `finalize` completion and the moment the operator downloads the draft asset. `finalize` publishes the exact bytes of `SHA256SUMS` it signed as a workflow artifact named `sha256sums-digest` (30-day retention). The skill downloads the artifact and byte-compares against the asset on the release.

```bash
# Download finalize's recorded SHA256SUMS as a workflow artifact.
ART_DIR="$WORK/ci-digest"
gh run download "$RUN_ID" --name sha256sums-digest --dir "$ART_DIR"

# Byte-for-byte comparison. diff exits non-zero on any difference and
# prints the delta for forensics.
if ! diff -q "$WORK/SHA256SUMS" "$ART_DIR/SHA256SUMS"; then
  echo "FAIL: Draft SHA256SUMS differs from CI-recorded SHA256SUMS"
  diff "$WORK/SHA256SUMS" "$ART_DIR/SHA256SUMS" || true
  exit 1
fi
```

Why this gate matters: the minisign signature at 4.3 proves the *original* SHA256SUMS was signed by the release key. But after `finalize` publishes, anyone with write access to the repo could use `gh release upload --clobber` to replace `SHA256SUMS` on the draft (and provide a forged minisign replacement if they also held the key). This gate catches that scenario — the workflow artifact is write-once from the run and cannot be substituted without re-running the workflow.

*If any verification step in 4.3–4.5 fails: abort. Do not prompt for approval.*

## 4.6 Operator approval — MANDATORY

Only now may the skill prompt the operator. Present:
- Number of assets
- Expected set (9 binaries + SHA256SUMS + SHA256SUMS.minisig = 11 total)
- Verification summary (all green)
- Release URL

Ask via `AskUserQuestion`:

> "All cryptographic verifications passed for v{version}. Publish the release and mark it as latest?"

| Option | Action |
|--------|--------|
| Publish + mark latest | `gh release edit "v${VERSION}" --draft=false --latest` |
| Leave as draft | Skip final edit; instruct operator to publish manually after additional review |
| Abort and delete | `gh release delete "v${VERSION}" --yes --cleanup-tag=false` and exit |

## Checkpoint 4.A

- [ ] Operator explicitly chose Publish or Leave-as-draft
- [ ] Release visibility matches operator's choice

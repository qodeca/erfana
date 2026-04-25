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

The dedicated release minisign public key is published in [docs/security.md § Release signing](../../../../docs/security.md), fenced by HTML comments so this step can extract it deterministically:

```text
<!-- minisign-pubkey-primary-begin -->
```text
RW...
```
<!-- minisign-pubkey-primary-end -->
```

Extract the pubkey block between those markers, then verify:

```bash
SECURITY_MD="docs/security.md"
PUBKEY_PATH="$WORK/release.pub"

# Extract the line between the primary fence markers, strip the markdown
# code-fence backticks. The awk range pattern operates between the
# begin/end markers (exclusive of the markers themselves).
awk '
  /^<!-- minisign-pubkey-primary-begin -->$/   { in_block=1; next }
  /^<!-- minisign-pubkey-primary-end -->$/     { in_block=0; next }
  in_block && /^[A-Za-z0-9+\/=]+$/             { print }
' "$SECURITY_MD" > "$PUBKEY_PATH"

# Sanity: pubkey must be 56-byte base64 (minisign convention).
[ -s "$PUBKEY_PATH" ] || { echo "FAIL: pubkey extraction returned empty"; exit 1; }

minisign -V -P "$(cat "$PUBKEY_PATH")" -m SHA256SUMS -x SHA256SUMS.minisig
```

- [ ] Pubkey extracted between fence markers (non-empty)
- [ ] `minisign -V` exits 0

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

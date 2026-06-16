# Git signing pre-flight check

> Pre-flight check before §1.5 commit bundle in the `releasing-erfana` skill.
> Spec heritage: [issue #174](https://github.com/qodeca/erfana/issues/174) reviewer finding.

Pre-flight check (added per #174 reviewer finding): `git commit -S` fails silently if `user.signingkey` and `gpg.format` aren't configured. Surface a clear error before attempting.

```bash
# Pre-flight: commit signing must be configured. The protected-tag rule
# (Phase I) only enforces signed TAGS, not signed commits — but our
# release commit uses -S, so a missing config is a hard fail here.
if ! git config --get user.signingkey >/dev/null 2>&1 \
   || ! git config --get gpg.format >/dev/null 2>&1; then
  echo "ERROR: commit signing not configured." >&2
  echo "Set user.signingkey and gpg.format (ssh|gpg) before re-running." >&2
  echo "Example (SSH):" >&2
  echo "  git config --global user.signingkey '/Users/<you>/.ssh/id_ed25519.pub'" >&2
  echo "  git config --global gpg.format ssh" >&2
  echo "  git config --global commit.gpgsign true" >&2
  echo "  git config --global tag.gpgsign true" >&2
  exit 1
fi

# When gpg.format=ssh, local verification (git log --show-signature,
# git verify-commit) requires gpg.ssh.allowedSignersFile. Without it,
# git reports "No signature" for a verifiably signed commit — a confusing
# red herring in the middle of Phase 2. Soft-warn (don't abort) since
# server-side verification still works.
if [ "$(git config --get gpg.format)" = "ssh" ] \
   && ! git config --get gpg.ssh.allowedSignersFile >/dev/null 2>&1; then
  echo "WARN: gpg.format=ssh but gpg.ssh.allowedSignersFile is unset." >&2
  echo "Server-side verification (GitHub) will work; local verification" >&2
  echo "(git log --show-signature) will report 'No signature' anyway." >&2
  echo "To fix:" >&2
  echo "  printf '%s namespaces=\"git\" %s\\n' \\" >&2
  echo "    \"\$(git config --get user.email)\" \"\$(cat \$(git config --get user.signingkey))\" \\" >&2
  echo "    > ~/.config/git/allowed_signers" >&2
  echo "  git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers" >&2
fi
```

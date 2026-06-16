# Erfana v{version}

_Released: {YYYY-MM-DD}_

{user-facing summary — 3-5 bullets supplied by the operator via AskUserQuestion in Phase 1.2. Examples:}

- {What end users can do that they couldn't before, in plain language}
- {Bug fix users would notice, framed in terms of the symptom}
- {Performance / quality-of-life improvement that's user-visible}
- {Optional: platform expansion, new format support, etc.}

<details>
<summary>Technical changes</summary>

{Output of `git cliff --tag "v{version}" --unreleased` — auto-generated from commit history, grouped by Conventional Commits type. Operator does NOT edit this section; it's the canonical changelog from git history.}

</details>

---

## Verification

```bash
# Aggregate integrity: minisign signature over the SHA256SUMS hash list (all platforms)
minisign -V -P "$(cat docs/release-pubkey.txt)" -m SHA256SUMS -x SHA256SUMS.minisig
sha256sum -c SHA256SUMS

# macOS: codesign + stapled notarization ticket
codesign --verify --deep --strict --verbose=2 /Applications/Erfana.app
xcrun stapler validate /path/to/Erfana-*.dmg

# Windows: Authenticode signature on the NSIS installer
signtool verify /pa /all /tw C:\Path\To\erfana-{version}-setup.exe
```

Full verification recipe: [docs/build/release.md § End-user verification](../../../../docs/build/release.md#end-user-verification).

<!--
Template guidance for the operator (delete in final notes):

PHASE 1.2 — operator supplies the user-facing summary via AskUserQuestion. Aim for 3-5 bullets that describe what END USERS can now do or what FRUSTRATION is now resolved. Plain language, no internal terms.

PHASE 1.3 — release-notes-drafter agent fills the technical section from `git cliff --tag "v{version}" --unreleased`. Do not hand-edit; if cliff output is wrong, fix the underlying commits or cliff.toml.

EXCLUDE from the user-facing section:
- Test coverage numbers
- Refactoring without user impact
- Developer tooling / skill / agent updates
- Commit hashes
- Issue numbers (unless describing a user-reported bug)
- Architecture / code-organization changes invisible to users

INCLUDE in the user-facing section:
- Features users interact with
- Bugs that affected user experience (framed as the SYMPTOM users saw, not the implementation)
- UI/UX changes
- Performance improvements users would notice
-->

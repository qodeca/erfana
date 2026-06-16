# Examples

Worked examples drawn from real Erfana releases. Used by the `releasing-erfana` skill.

### Example 1: Successful release (v0.9.5)

Operator checks out `main`, bumps `package.json` to `0.9.5`, appends CHANGELOG entry, and invokes the skill.

1. Phase 0: branch ok, tree clean, version valid, CHANGELOG contains `## 0.9.5`.
2. Phase 1: `git cliff` emits technical section; operator supplies 4 bullet points for the summary; single commit pushed.
3. `checks.yml` turns green within ~3 min.
4. Phase 2: signed tag pushed.
5. Phase 3: `release.yml` runs for ~60 min. `gh run watch` returns exit 0.
6. Phase 4: minisign verifies; per-asset sha256 matches signed SHA256SUMS; workflow-output digest matches.
7. Operator approves publish.
8. Phase 5: post-publish verification clean. Release URL surfaced.

### Example 2: Lockfile-drift abort

Operator tags a commit that never produced a green `checks.yml` run.

1. Phase 0–2 run normally.
2. Phase 3: `release.yml` starts. `prepare` job fails the lockfile-drift guard (`No green checks.yml run for <sha>`).
3. `cleanup` deletes the draft and exits red.
4. Skill surfaces the run URL and the `prepare` failure log.
5. Operator re-runs `checks.yml` on the commit; once green, operator re-invokes the skill from Phase 3 (idempotent resume).

### Example 3: Hash mismatch in Phase 4

Malicious or accidental tampering with a draft asset after `finalize`.

1. Phase 0–3 run normally.
2. Phase 4: `diff SHA256SUMS SHA256SUMS.local` surfaces a mismatch for one asset.
3. Skill aborts without prompting for approval. Prints the diff, the asset, and the run URL. Deletes the draft after operator confirmation.
4. Operator escalates to the incident-response flow in `docs/build/release.md`.

# Phase 10: Release (Optional)

**Goal:** Prepare production release with user-friendly release notes.
**Agent:** `release-engineer`

Use this phase only when preparing an actual release (not for every issue).

## Steps

1. **Invoke Release Engineer**

   Use the Task tool to spawn the release-engineer agent:
   ```
   Task(subagent_type='release-engineer')

   Prompt: "Prepare release v0.4.3

   Previous release: v0.4.2
   Analyze commits since last release.
   Generate release notes in release/0.4.3/ folder.
   Follow v0.4.1 release notes format."
   ```

2. **Release Checklist**
   - [ ] Version bumped in package.json
   - [ ] Release notes generated
   - [ ] CLAUDE.md updated
   - [ ] All tests passing
   - [ ] Build completes successfully
   - [ ] Git tag created

## Release Notes Format

Follow the established format from `release/0.4.1/erfana-0.4.1-release-notes.md`:
- User-friendly language (not technical jargon)
- "What's New" section with feature benefits
- "Bug Fixes" section
- "Technical Details" with test count and build info

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review release-engineer output and release notes quality
  2. Retry with refined instructions
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Skip/Abort]

---

## Phase Validation

Before considering release complete, ALL must be checked:

- [ ] Version bumped in package.json
- [ ] Release notes generated in proper format
- [ ] CLAUDE.md updated with release information
- [ ] All tests passing
- [ ] Build completes successfully without errors
- [ ] Git tag created for the release

**STOP if any item unchecked. Do not proceed.**

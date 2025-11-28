# Phase 7: Documentation

**Goal:** Update relevant documentation with automation where possible.
**Agent:** `project-documenter` (if significant changes), `docs-updater` (for simple fixes)

## Steps

1. **Determine Documentation Needs**
   - CLAUDE.md: Architectural changes, version updates
   - docs/: Feature documentation
   - README: User-facing changes
   - Inline comments: Complex logic

2. **Update CLAUDE.md**
   - Add to "Recent Changes" section
   - Update version if releasing
   - Update test count if changed

3. **Update Feature Docs**
   - Only if new user-facing feature
   - Follow existing doc patterns

## Documentation Automation (2025 Best Practices)

1. **Auto-Generated Documentation**
   - Update JSDoc/TSDoc for new public APIs
   - Ensure TypeScript types serve as documentation
   - Generate documentation from code where possible

2. **Changelog Management**
   - Add entry to CLAUDE.md "Recent Changes" section
   - Follow existing changelog format consistently
   - Include: what changed, why, affected files

3. **Documentation Testing**
   - Verify code examples in docs still work
   - Check that links are not broken
   - Ensure screenshots are current (if applicable)

4. **API Documentation** (if applicable)
   - Update OpenAPI/Swagger specs for REST endpoints
   - Regenerate API docs from code
   - Document IPC channel changes

## Documentation Checklist

- [ ] CLAUDE.md "Recent Changes" updated
- [ ] Test count updated: `**Total: X tests passing (Y test files)**`
- [ ] New public APIs have JSDoc/TSDoc
- [ ] Complex logic has inline comments
- [ ] Feature docs updated (if user-facing change)
- [ ] Code examples in docs still work

## Documentation Guidelines

- Prefer inline code comments over external docs for implementation details
- Don't document obvious code - focus on the "why" not the "what"
- Keep docs close to code they describe
- Update docs in the same PR as code changes

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review agent output, refine prompt
  2. Retry with adjusted parameters
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Skip/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] CLAUDE.md "Recent Changes" section updated with change summary
- [ ] Test count updated if tests were added/modified
- [ ] New public APIs have JSDoc/TSDoc comments
- [ ] Complex logic has inline explanatory comments
- [ ] Feature documentation created/updated if user-facing change

**STOP if any item unchecked. Do not proceed.**

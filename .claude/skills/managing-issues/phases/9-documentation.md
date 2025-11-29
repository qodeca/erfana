# Phase 9: Documentation

**Goal:** Update relevant documentation.
**Agent:** `update-docs`
**Quality Gate:** QG-9 (Automated)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-8 = PASS (Verification completed - VERIFIED)
- [ ] Implementation complete and verified
- [ ] All tests passing
- [ ] Typecheck passing

---

## Execution Steps

### Step 1: Determine Documentation Needs

| Change Type | Documentation Required |
|-------------|----------------------|
| Architectural | CLAUDE.md, docs/ |
| Feature | CLAUDE.md, feature docs |
| Bug fix | CLAUDE.md (if significant) |
| API change | JSDoc, CLAUDE.md |
| Config change | README, docs/ |

### Step 2: Update CLAUDE.md

Required sections to update:
- **Recent Changes**: Add change summary
- **Version**: Update if releasing
- **Test Count**: Update if tests added

Format:
```markdown
## Changes in v0.X.Y
- **Feature Name** (Date):
  - Description of changes
  - Key implementation details
  - Test count update
  - Closes #<number>
```

### Step 3: Update Test Count

Get current count:
```bash
npm run test 2>&1 | grep -E "Tests?:\s+\d+"
```

Update CLAUDE.md: `**Total: X tests passing (Y test files)**`

### Step 4: Add JSDoc/TSDoc

For new public APIs:
```typescript
/**
 * Description of function
 * @param paramName - Description
 * @returns Description of return value
 * @example
 * const result = myFunction(param);
 */
```

### Step 5: Add Inline Comments

For complex logic (the "why", not "what"):
```typescript
// Using debounce to prevent rapid re-renders during resize
// See: https://github.com/issue/123 for context
```

### Step 6: Update Feature Docs (if applicable)

Only for user-facing features:
- Create/update doc in `docs/` folder
- Follow existing doc patterns
- Include usage examples

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| CLAUDE.md Updates | Recent changes entry |
| Test Count | Updated test statistics |
| JSDoc Comments | New API documentation |
| Feature Docs | Updated feature documentation |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 10.**

- [ ] CLAUDE.md "Recent Changes" updated with change summary
- [ ] Test count updated if tests were added/modified
- [ ] New public APIs have JSDoc/TSDoc comments
- [ ] Complex logic has inline explanatory comments
- [ ] Feature documentation updated (if user-facing change)
- [ ] Code examples in docs verified (if applicable)

---

## QUALITY GATE: QG-9

**Gate Type:** Automated (ALL tiers)
**Gate ID:** QG-9

### Pass Criteria

| Criterion | Tier 1 | Tier 2 |
|-----------|--------|--------|
| CLAUDE.md updated | Required | Required |
| Test count updated | If changed | If changed |
| JSDoc for new APIs | Optional | Required |
| Feature docs | Not required | If user-facing |

### Automated Verification

Check that:
1. CLAUDE.md contains reference to issue number
2. Test count is current
3. No broken links in documentation

### Result

**QG-9 Result:** [PASS | FAIL]

### On FAIL

1. Identify missing documentation
2. Add required documentation
3. Re-verify
4. Max 3 retries, then ESCALATE

### Documentation Guidelines

**DO:**
- Update docs in same PR as code
- Keep docs close to code they describe
- Focus on "why" not "what"
- Use examples for complex features

**DO NOT:**
- Document obvious code
- Create separate doc PRs
- Over-document trivial changes

---

## NEXT PHASE

**QG-9 = PASS required to proceed to Phase 10: UAT**

**STOP if QG-9 ≠ PASS. Do not proceed.**

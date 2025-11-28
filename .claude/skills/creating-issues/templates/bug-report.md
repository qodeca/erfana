# Bug Report Template

Use this template when creating bug reports. Copy and adapt the structure below.

## Template

```markdown
## Summary
[One clear sentence describing the bug - what's broken and where]

## Steps to Reproduce
1. [First step to trigger the bug]
2. [Second step]
3. [Continue until bug manifests]

## Expected Behavior
[What should happen when following the steps above]

## Actual Behavior
[What actually happens - the bug manifestation]

## Environment
- OS: [e.g., macOS 14.0, Windows 11, Ubuntu 22.04]
- App Version: [e.g., 0.4.1]
- Node Version: [if relevant, e.g., 18.x]

## Acceptance Criteria
- [ ] [Specific condition that must be true when fixed]
- [ ] [Another testable criterion]
- [ ] [No regression in related functionality]

## Implementation Notes for Claude Code
1. Research the affected area to understand current behavior
2. Identify the root cause through code analysis
3. Consider edge cases and related functionality
4. Ensure fix doesn't introduce regressions
5. Add tests if applicable
```

## Guidelines for Using This Template

### Summary
- One sentence, clear and specific
- Bad: "It doesn't work"
- Good: "File save fails silently when filename contains special characters"

### Steps to Reproduce
- Numbered list, specific and reproducible
- Include any preconditions (e.g., "With a project open...")
- Mention if the bug is intermittent

### Expected vs Actual
- Be specific about the difference
- Include error messages if any (but not stack traces with line numbers)

### Environment
- Only include relevant details
- Version numbers help narrow down regressions

### Acceptance Criteria
- Write as testable checkboxes
- Focus on observable behavior
- Include "no regression" criteria if touching sensitive areas

### Implementation Notes
- Guide research, don't prescribe solutions
- Never include file paths or line numbers
- Suggest areas to investigate, not specific fixes
- Let Claude Code analyze the current codebase fresh

# Enhancement Template

Use this template when creating feature requests or improvement issues. Copy and adapt the structure below.

## Template

```markdown
## Summary
[One sentence describing the feature or improvement]

## Motivation
[Why is this needed? What problem does it solve? What user pain point does it address?]

## Expected Behavior
[Describe how the feature should work from a user's perspective]
- [Behavior point 1]
- [Behavior point 2]
- [Edge case handling]

## Acceptance Criteria
- [ ] [Specific, testable criterion]
- [ ] [Another measurable outcome]
- [ ] [User-facing behavior requirement]
- [ ] [No regression in existing functionality]

## Implementation Notes for Claude Code
1. Research existing patterns in the codebase
2. Identify integration points with current features
3. Consider UX consistency with similar features
4. Plan for edge cases mentioned above
5. Add tests for new functionality

## Additional Context
[Optional: Screenshots, mockups, references to similar features in other apps, related issues]
```

## Guidelines for Using This Template

### Summary
- One clear sentence describing the feature
- Bad: "Make it better"
- Good: "Add keyboard shortcut (Cmd+Shift+P) to open command palette"

### Motivation
- Explain the "why" - what problem does this solve?
- Reference user pain points or workflow improvements
- Can mention if this matches behavior in other tools (e.g., "like VS Code")

### Expected Behavior
- Describe from user's perspective, not implementation
- Use bullet points for multiple behaviors
- Include how edge cases should be handled
- Mention any visual feedback or confirmations

### Acceptance Criteria
- Checkboxes that can be verified
- Focus on observable outcomes
- Include non-functional requirements if relevant (performance, accessibility)
- Always include "no regression" for changes to existing features

### Implementation Notes
- Guide Claude Code to research, not implement a specific solution
- Never include file paths, class names, or line numbers
- Suggest patterns to look for, not specific code changes
- The codebase may have changed - let fresh analysis happen
- Mention if there are similar features to reference for consistency

### Additional Context
- Screenshots or mockups if helpful
- Links to similar features in other applications
- Related issues that should be considered together
- Any constraints or preferences (but frame as suggestions, not mandates)

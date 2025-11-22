# Claude Code-Friendly Issue Principles

This document explains why certain patterns make GitHub issues more effective when Claude Code (or any AI assistant) picks them up for implementation later.

## Core Philosophy

Issues are **living documents** that may be implemented days, weeks, or months after creation. The codebase will have changed. File paths will have moved. Line numbers will be wrong. Write issues that remain valuable regardless of when they're addressed.

## Principle 1: Focus on Behavior, Not Implementation

**Why:** Implementation details become stale. Behavior descriptions remain valid.

**Bad:**
> Fix the bug in `src/components/Panel.tsx` line 47 where the resize handler uses `4px` width.

**Good:**
> Panel resize handles are too thin to grab comfortably. The hit area should be increased for better UX.

The good version lets Claude Code:
1. Search for resize-related code
2. Analyze the current implementation
3. Determine the appropriate fix based on current architecture

## Principle 2: No File Paths or Line Numbers

**Why:** Code moves. Files get renamed. Line numbers shift with every edit.

**Bad:**
> The error occurs in `src/main/services/FileService.ts:234`

**Good:**
> File operations fail silently when the target path contains special characters

Claude Code will:
1. Search for file operation code
2. Find the current location of relevant logic
3. Not be misled by outdated references

## Principle 3: Acceptance Criteria as Checkboxes

**Why:** Checkboxes create clear, testable goals that Claude Code can verify.

**Bad:**
> Make the resize handles better and add some visual feedback.

**Good:**
> - [ ] Resize handles have minimum 6-8px hit area
> - [ ] Hover state shows teal accent color
> - [ ] Consistent behavior across all resizable panels
> - [ ] No visual regression when not hovering

Checkboxes let Claude Code:
1. Understand exactly what "done" means
2. Verify each criterion independently
3. Know when to stop implementing

## Principle 4: Guide Research, Don't Prescribe Solutions

**Why:** The best solution depends on current architecture, which Claude Code will analyze fresh.

**Bad:**
> Add a CSS override in AppDockLayout.css for `.dv-sash` to increase width to 8px.

**Good:**
> Implementation Notes for Claude Code:
> 1. Research how the layout system handles resize
> 2. Check for existing resize-related styling
> 3. Ensure changes apply consistently to all panels

This approach:
- Trusts Claude Code to find the best current solution
- Doesn't lock into potentially outdated approaches
- Encourages fresh analysis of the codebase

## Principle 5: Include Context, Not Constraints

**Why:** Context informs decisions. Constraints may become invalid.

**Bad:**
> Must use the existing ResizableDivider component. Don't modify dockview settings.

**Good:**
> The app uses dockview for panel layout. Some panels have custom resize components. Ensure UX consistency across both approaches.

Context helps Claude Code:
- Understand the landscape
- Make informed architectural decisions
- Find the right balance between approaches

## Principle 6: Describe User Impact

**Why:** Understanding the "why" leads to better solutions.

**Bad:**
> The sash width is 4px.

**Good:**
> Users struggle to grab the resize handles because they're too narrow. This makes window layout adjustment frustrating, especially on high-DPI displays.

Impact descriptions help Claude Code:
- Prioritize the right aspects of the fix
- Consider related UX improvements
- Test from the user's perspective

## Principle 7: Mention Related Areas

**Why:** Helps avoid partial fixes and ensures consistency.

**Good:**
> Affected Areas:
> - Project Tree <-> Editor divider
> - Editor <-> Terminal divider
> - Editor <-> Preview split (inside markdown editor)

This ensures Claude Code:
- Addresses all affected areas
- Maintains consistency
- Doesn't leave some panels harder to resize than others

## Quick Checklist

Before finalizing an issue, verify:

- [ ] No file paths or line numbers mentioned
- [ ] Behavior-focused, not implementation-focused
- [ ] Acceptance criteria are checkboxes
- [ ] Implementation notes guide research
- [ ] User impact is explained
- [ ] All affected areas are listed
- [ ] Issue makes sense even if codebase has changed significantly

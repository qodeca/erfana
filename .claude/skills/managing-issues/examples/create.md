# Create Operation Examples

Detailed examples showing the Create operation workflow.

---

## Example 1: Bug Report Flow

**User says:** "The resize handles are too thin and hard to grab"

**Workflow:**

```
1. Phase 1: Understand the Problem
   → Issue type: Bug (UX issue affecting resize interaction)

2. Phase 2: Ask Clarifying Questions
   → AskUserQuestion:
     - Which panels? → Project Tree, Editor, Terminal dividers
     - What size feels right? → 6-8px
     - Hover feedback? → Yes, teal accent
     - Severity? → Medium

3. Phase 3: Check for Duplicates
   → gh issue list --search "resize handle"
   → No duplicates found

4. Phase 4: Draft the Issue
   → Using bug-report template:

   ## Summary
   Panel resize handles are difficult to grab due to narrow hit area.

   ## Affected Areas
   - Project Tree <-> Editor divider
   - Editor <-> Terminal divider

   ## Expected Behavior
   - Resize handles should have comfortable grab area (~6-8px)
   - Visual feedback on hover

   ## Acceptance Criteria
   - [ ] All dividers have increased hit area
   - [ ] Hover state shows visual indicator
   - [ ] Consistent UX across all panels

   ## Implementation Notes for Claude Code
   1. Research how the layout system handles resize
   2. Check for existing resize-related styling
   3. Ensure changes apply consistently to all panels

5. Phase 5: Present and Confirm
   → Present draft to user
   → User approves
   → gh issue create --title "Resize handles are too thin" --label "bug"
   → Return issue URL
```

**Result:** Issue #35 created

---

## Example 2: Feature Request Flow

**User says:** "I want dark mode support"

**Workflow:**

```
1. Phase 1: Understand the Problem
   → Issue type: Enhancement (new feature)

2. Phase 2: Ask Clarifying Questions
   → AskUserQuestion:
     - Toggle mechanism? → System preference
     - Which components? → All (editor, preview, panels)
     - Reference implementation? → VS Code

3. Phase 3: Check for Duplicates
   → gh issue list --search "dark mode"
   → No duplicates found

4. Phase 4: Draft the Issue
   → Using enhancement template:

   ## Summary
   Add dark mode support with system preference detection.

   ## Motivation
   Users working in low-light environments need reduced eye strain.

   ## Expected Behavior
   - Automatically detect system dark/light preference
   - Apply theme to all UI components
   - Match VS Code's theme behavior

   ## Acceptance Criteria
   - [ ] System preference detection works
   - [ ] All UI components support dark theme
   - [ ] Theme switches seamlessly without restart
   - [ ] No visual glitches during transition

   ## Implementation Notes for Claude Code
   1. Research existing theme infrastructure
   2. Check how Monaco editor handles themes
   3. Ensure preview markdown respects theme

5. Phase 5: Present and Confirm
   → Present draft to user
   → User approves
   → gh issue create --title "Add dark mode support" --label "enhancement"
   → Return issue URL
```

**Result:** Issue #36 created

---

## Checkpoint Summary (Create)

| Checkpoint | Create |
|------------|--------|
| Duplicate Check | ✓ |
| Draft Approval | ✓ |
| **Total** | **2** |

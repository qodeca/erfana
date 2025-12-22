# Requirements

## Functional Requirements

### FR-001: Context menu trigger

**Priority:** High
**Description:** Monaco editor must show a custom context menu when user right-clicks with text selected. The menu replaces Monaco's default context menu.
**Rationale:** Provides consistent entry point for AI prompts matching the preview panel UX.
**Traces to:** AC-001, AC-002

### FR-002: Selection detection

**Priority:** High
**Description:** System must capture selected text, selection range (start/end line numbers), and cursor position when context menu is triggered.
**Rationale:** Selected text is required for prompt template variable substitution.
**Traces to:** AC-001, AC-003, AC-004

### FR-003: Prompt filtering by area

**Priority:** High
**Description:** Context menu must display prompts filtered by `area: code-editor` and `subArea: context-menu` from the prompt registry.
**Rationale:** Ensures only editor-appropriate prompts appear, maintaining separation from preview-specific prompts.
**Traces to:** AC-001, AC-009

### FR-004: Prompt execution

**Priority:** High
**Description:** Selected prompts must execute through the existing `executePromptTemplate()` infrastructure, sending rendered prompts to the terminal panel.
**Rationale:** Reuses proven infrastructure, ensuring consistency and maintainability.
**Traces to:** AC-003

### FR-005: Dialog integration

**Priority:** High
**Description:** Prompts with `requiresInput: true` must show the PromptDialog before execution, identical to preview context menu behavior.
**Rationale:** Some prompts require user input (e.g., modification instructions) before execution.
**Traces to:** AC-004

### FR-006: Copy selection action

**Priority:** Medium
**Description:** Context menu must include a "Copy selection" action as the last item (after separator), consistent with preview context menu.
**Rationale:** Provides expected clipboard functionality within the context menu.
**Traces to:** AC-005

### FR-007: Menu positioning

**Priority:** Medium
**Description:** Context menu must appear near the cursor position with viewport boundary detection (same logic as ContextMenu.tsx).
**Rationale:** Ensures menu is always visible and accessible regardless of cursor position.
**Traces to:** AC-008

### FR-008: Menu dismissal

**Priority:** Medium
**Description:** Context menu must close on: click outside, Escape key, or action execution (inherited from ContextMenu.tsx).
**Rationale:** Standard context menu behavior that users expect.
**Traces to:** AC-006, AC-007

### FR-009: Editor-specific prompt templates

**Priority:** High
**Description:** At least 3 editor-appropriate prompt templates must be created with `area: code-editor` frontmatter. Required prompts: Elaborate, Modify, Ask.
**Rationale:** Provides useful AI-assisted operations for editing workflows.
**Traces to:** AC-003, AC-004, AC-009

### FR-010: Scroll scheduling integration

**Priority:** Low
**Description:** After prompt execution, scroll-to-bottom scheduling must work via TerminalPortalContext (same as PreviewContextMenu).
**Rationale:** Ensures terminal output is visible after prompt execution.
**Traces to:** AC-003

## Non-Functional Requirements

### NFR-001: UX consistency

**Priority:** High
**Description:** Context menu must match PreviewContextMenu in: (a) CSS classes and styling, (b) animation timing (opacity transition), (c) z-index layering, (d) positioning offset from cursor (8px), (e) viewport boundary behavior.
**Rationale:** Users should have a consistent experience across editor and preview modes.
**Traces to:** AC-001, AC-008

### NFR-002: Code reuse

**Priority:** High
**Description:** Implementation must reuse existing infrastructure (ContextMenu, prompt registry, executePromptTemplate, useDialog) rather than duplicating.
**Rationale:** Maintains single source of truth, reduces maintenance burden, ensures consistency.
**Traces to:** Success criteria (>80% code reuse)

### NFR-003: Monaco default menu suppression

**Priority:** High
**Description:** Monaco's built-in context menu must be prevented from appearing when custom menu is shown.
**Rationale:** Avoids confusing dual-menu situation and ensures clean UX.
**Traces to:** AC-001

### NFR-004: Test coverage

**Priority:** Medium
**Description:** EditorContextMenu must have unit tests covering: rendering, prompt loading, action execution, dialog flow, copy action.
**Rationale:** Ensures reliability and prevents regressions.
**Traces to:** AC-010

### NFR-005: Performance

**Priority:** Medium
**Description:** Context menu must render and display within 100ms of right-click event. Prompt filtering via `getPromptsForArea()` must complete in <10ms.
**Rationale:** Ensures responsive UX without perceptible delay.
**Traces to:** AC-001

### NFR-006: Security

**Priority:** High
**Description:** All user input from PromptDialog must be passed through existing template sanitization. No raw HTML injection in prompt variables. Selected text must be escaped before template interpolation.
**Rationale:** Prevents XSS attacks through prompt templates sent to terminal.
**Traces to:** AC-004

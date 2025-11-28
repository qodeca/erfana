# Agent Reference Guide

Quick reference for selecting and using specialized agents during issue implementation.

---

## Agent Selection Decision Tree

```
Start: What type of work?
│
├── Prior Art Research / Requirements?
│   └── analyze-requirements
│
├── Discovery/Exploration?
│   └── codebase-explorer
│
├── Planning/Design?
│   └── solution-architect
│
├── Code Implementation?
│   └── code-implementer
│
├── Testing?
│   └── test-writer
│
├── Bug Investigation?
│   └── bug-investigator
│
├── Code Quality?
│   ├── Pre-commit → code-reviewer
│   └── Security → security-auditor
│
├── Refactoring?
│   └── refactoring-advisor
│
├── Documentation?
│   ├── Project docs → project-documenter
│   └── Simple fixes → docs-updater
│
├── Commit/PR?
│   └── diff-summarizer
│
└── Release?
    └── release-engineer
```

---

## Agent Overview

### Core Agents (7)

| Agent | Model | Tools | Purpose |
|-------|-------|-------|---------|
| `codebase-explorer` | haiku | Read, Grep, Glob, Bash | Fast codebase navigation |
| `solution-architect` | opus | Read, Grep, Glob, WebSearch | System design and planning |
| `code-implementer` | sonnet | Read, Write, Edit, Bash, Glob, Grep | Write production code |
| `test-writer` | sonnet | Read, Write, Edit, Bash, Glob, Grep | Create tests |
| `code-reviewer` | sonnet | Read, Grep, Glob | Pre-commit review |
| `project-documenter` | sonnet | Read, Write, Edit, Glob, Grep | CLAUDE.md, architecture docs |
| `diff-summarizer` | haiku | Read, Grep, Glob, Bash | Commit messages, PR descriptions |

### Conditional Agents (6)

| Agent | Model | Tools | Trigger |
|-------|-------|-------|---------|
| `analyze-requirements` | haiku/sonnet/opus | Read, WebSearch, AskUserQuestion, Grep, Glob | Phase 0.5 (all tiers) |
| `bug-investigator` | sonnet | Read, Grep, Glob, Bash | `bug` label |
| `refactoring-advisor` | sonnet | Read, Grep, Glob | `refactor` label |
| `security-auditor` | opus | Read, Grep, Glob | Tier 3, `security` label |
| `release-engineer` | sonnet | Read, Write, Edit, Bash, Glob, Grep | Version releases |
| `docs-updater` | haiku | Read, Write, Edit, Glob, Grep | Simple doc fixes |

---

## Agent Capabilities

### analyze-requirements

**Purpose**: Conduct prior art research and structured requirements gathering before codebase exploration.

**Use When**:
- Starting Phase 0.5 (Business Analysis)
- Need to research existing solutions/libraries
- Requirements are unclear or incomplete
- Acceptance criteria need validation
- Identifying scope boundaries

**Model Selection**:
- Tier 1: haiku (quick research)
- Tier 2: sonnet (focused research)
- Tier 3: opus (comprehensive research)

**Outputs**:
- Prior art research summary
- Requirements clarification document
- Validated acceptance criteria
- Scope boundaries (in/out of scope)
- Risk identification

**Example Prompt**:
```
Conduct business analysis for issue #11 (Tier 2).

Issue: Add Chrome-style dynamic tabs
Labels: enhancement
Body: "Tabs should resize dynamically, show dirty indicator, support context menu"

Steps:
1. Classify issue type
2. Search for existing tab implementations (npm, VS Code, patterns)
3. Present 3-5 questions about reference implementation, scope, edge cases
4. Validate acceptance criteria completeness
5. Document scope boundaries
6. Return research summary with recommendation
```

**Details**: See `agents/analyze-requirements.md`

---

### codebase-explorer

**Purpose**: Fast codebase navigation, pattern search, file discovery.

**Use When**:
- Starting Discovery phase
- Finding affected code areas
- Understanding project structure
- Searching for patterns or keywords

**Outputs**:
- File paths with line numbers
- Pattern locations
- Recommended files to examine

**Example Prompt**:
```
Find all files related to tab management in the codebase.
Search for components that handle file tabs, dirty indicators,
and close functionality.
```

---

### solution-architect

**Purpose**: System design validation and implementation planning.

**Use When**:
- Designing new features (Phase 2)
- Evaluating technical approaches
- Creating implementation plans
- Assessing risks

**Outputs**:
- Implementation plans
- Component designs
- Risk assessments
- Agent assignments

**Example Prompt**:
```
Design implementation for issue #11 (Chrome-style tabs).
Consider: DockviewReact integration, state management, CSS approach.
Evaluate patterns used elsewhere in the codebase.
```

---

### code-implementer

**Purpose**: Write production-quality code following approved plans.

**Use When**:
- Implementing features (Phase 3)
- Writing new components
- Modifying existing code
- Following approved architecture

**Outputs**:
- Production-ready code
- Modified files
- Typecheck verification

**Example Prompt**:
```
Implement EditorTab component following the approved plan.
Interface: IDockviewPanelHeaderProps<EditorTabParams>
Include: dirty indicator, close button, context menu support.
Follow existing patterns in src/renderer/src/components/.
```

---

### test-writer

**Purpose**: Create comprehensive tests with >80% coverage.

**Use When**:
- After implementation
- During TDD
- Improving coverage
- Writing regression tests

**Outputs**:
- Test files
- Coverage reports
- Test scenarios

**Example Prompt**:
```
Write comprehensive tests for EditorTab component.
Cover: rendering, dirty indicator, close button, middle-click,
context menu, drag prevention, accessibility.
Target >80% coverage.
```

---

### code-reviewer

**Purpose**: Code quality validation before commits.

**Use When**:
- Before git commit (Phase 4)
- After implementation
- Security review
- Best practices check

**Outputs**:
- Review findings (Critical/Medium/Low)
- Security concerns
- Improvement suggestions

**Example Prompt**:
```
Review changes for issue #11.
Files: EditorTab.tsx, EditorTab.css, useTabContextMenu.tsx
Check: security, performance, patterns, test coverage.
```

---

### project-documenter

**Purpose**: Maintain CLAUDE.md, architecture docs, changelogs.

**Use When**:
- After features (Phase 5)
- Before releases
- Version updates
- Architecture changes

**Outputs**:
- Updated CLAUDE.md
- Changelog entries
- Architecture docs

**Example Prompt**:
```
Update CLAUDE.md for v0.4.2 release.
Add Chrome-style tabs feature to Recent Changes.
Update test count to 1392.
```

---

### diff-summarizer

**Purpose**: Generate commit messages and PR descriptions.

**Use When**:
- Before finalizing commits (Phase 6)
- Creating PRs
- Writing release notes

**Outputs**:
- Conventional commit messages
- PR descriptions
- Change summaries

**Example Prompt**:
```
Generate commit message for the staged changes.
This implements Chrome-style tabs for issue #11.
```

---

### bug-investigator

**Purpose**: Root cause analysis and fix recommendations.

**Use When**:
- Issue has `bug` label
- Diagnosing unexpected behavior
- Error investigation

**Outputs**:
- Root cause identification
- Execution path trace
- Fix recommendations

**Example Prompt**:
```
Investigate terminal scroll jumping during streaming output.
Symptoms: Scroll position resets to top during Claude CLI output.
Affected: TerminalPanel.tsx, xterm.js integration.
```

---

### refactoring-advisor

**Purpose**: Code smell detection and improvement recommendations.

**Use When**:
- Issue has `refactor` label
- Code complexity too high
- Technical debt cleanup

**Outputs**:
- Code smell list
- Refactoring steps
- Risk assessment

**Example Prompt**:
```
Analyze ProjectTree.tsx for refactoring opportunities.
Current: 1338 lines, high complexity.
Recommend SOLID improvements and extractions.
```

---

### security-auditor

**Purpose**: Deep security analysis for critical changes.

**Use When**:
- Tier 3 issues
- `security` label present
- Authentication/authorization changes
- IPC handler modifications

**Outputs**:
- Security audit report
- Vulnerability findings
- Security checklist

**Example Prompt**:
```
Security audit for path traversal prevention in FileService.
Review all file operations for proper path validation.
Check IPC handlers for input sanitization.
```

---

### release-engineer

**Purpose**: Prepare production releases with user-friendly notes.

**Use When**:
- Preparing a release
- Version bumping
- Creating release artifacts

**Outputs**:
- Release notes (v0.4.1 format)
- Updated package.json
- Git tag

**Example Prompt**:
```
Prepare release v0.4.2.
Analyze commits since v0.4.1.
Generate release notes in release/0.4.2/ folder.
```

---

### docs-updater

**Purpose**: Quick fixes for typos and simple doc changes.

**Use When**:
- Tier 1 documentation issues
- Typo fixes
- Minor text corrections

**Outputs**:
- Fixed documentation

**Example Prompt**:
```
Fix typo in README.md line 42.
"recieve" should be "receive".
```

---

## When NOT to Use Agents

Agents add overhead. Skip them for:

| Scenario | Reason |
|----------|--------|
| < 10 lines of code | Direct implementation faster |
| Simple typo fixes | Use docs-updater or edit directly |
| Single file changes | Context already available |
| Trivial bugs | Root cause obvious |

---

## Agent Orchestration Patterns

### Sequential (Dependencies)

```
analyze-requirements → codebase-explorer → solution-architect → code-implementer → test-writer → code-reviewer
```

Each step depends on previous output. Business analyst outputs inform discovery and architecture.

### Parallel (Independent)

```
┌─ code-implementer (component A)
│
├─ code-implementer (component B)
│
└─ test-writer (test utilities)
```

Multiple agents can work simultaneously on independent parts.

### Iterative (Feedback Loop)

```
code-implementer → code-reviewer → code-implementer (fixes) → code-reviewer
```

Repeat until quality standards met.

---

## Agent Failure Handling

### If Agent Fails to Complete

| Agent | Failure Mode | Recovery Action |
|-------|--------------|-----------------|
| analyze-requirements | WebSearch fails | Document attempt, proceed with reduced findings |
| analyze-requirements | User skips question | Re-present with "required for clarity" |
| codebase-explorer | Search too broad | Add constraints, retry |
| solution-architect | Plan incomplete | Manual architecture, skip to implementation |
| code-implementer | Code not compiling | Fix errors manually, re-invoke |
| test-writer | Tests not covering all cases | Write additional tests manually |
| code-reviewer | Review incomplete | Manual review using checklist |
| bug-investigator | Root cause unclear | Add logging, reproduce manually |

### Retry Strategy

1. **First failure**: Review agent output, refine prompt, retry once
2. **Second failure**: Fall back to manual work for that phase
3. **Document**: Note what failed in commit message or issue comment

---

## Agent Invocation Examples

### Phase 0.5: Business Analysis
```
@analyze-requirements Conduct requirements analysis for issue #11 (Tier 2).
Issue: Add Chrome-style dynamic tabs
Labels: enhancement
Research: npm libraries, VS Code implementation, design patterns
Questions: reference implementation, scope boundaries, edge cases
```

### Phase 1: Discovery
```
@codebase-explorer Find all files related to tab management.
Search for DockviewReact usage and tab components.
Use business analysis findings: recommend VS Code-style custom implementation.
```

### Phase 2: Architecture
```
@solution-architect Design implementation for issue #11.
Acceptance criteria: dynamic sizing, dirty indicator, context menu.
Review existing patterns in src/renderer/src/components/Tabs/.
```

### Phase 3: Implementation
```
@code-implementer Implement EditorTab.tsx following approved plan.
Create: EditorTab.tsx, EditorTab.css
Modify: AppDockLayout.tsx to register component.
```

### Phase 3: Testing
```
@test-writer Write tests for EditorTab component.
Cover all acceptance criteria. Target >80% coverage.
```

### Phase 4: Review
```
@code-reviewer Review all changes for issue #11.
Check security, performance, patterns.
```

### Phase 6: Finalization
```
@diff-summarizer Generate commit message.
Type: feat, Scope: tabs, Issue: #11
```

---

## Agent Selection by Issue Label

| Label | Primary Agent | Supporting Agents |
|-------|--------------|-------------------|
| `bug` | bug-investigator | analyze-requirements, code-implementer, test-writer |
| `enhancement` | analyze-requirements | solution-architect, code-implementer, code-reviewer |
| `feature` | analyze-requirements | solution-architect, code-implementer, test-writer |
| `documentation` | project-documenter or docs-updater | - |
| `refactor` | refactoring-advisor | code-implementer, code-reviewer |
| `security` | analyze-requirements | security-auditor, code-implementer |
| `test` | test-writer | - |

**Note:** analyze-requirements is used first (Phase 0.5) for all non-trivial issues before other agents.

---

## Quality Thresholds

Agents should ensure:

| Metric | Target |
|--------|--------|
| Test coverage (new code) | > 80% |
| TypeScript strict | No errors |
| ESLint | No errors |
| Critical review issues | 0 before commit |
| Medium review issues | Document if deferring |

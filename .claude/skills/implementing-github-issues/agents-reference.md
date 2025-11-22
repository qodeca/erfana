# Agent Reference Guide

Quick reference for selecting and using specialized agents during issue implementation.

---

## Agent Selection Decision Tree

```
Start: What type of work?
│
├── Planning/Design?
│   └── architect-reviewer
│
├── Code Implementation?
│   ├── TypeScript/React → typescript-pro
│   ├── CLI/Scripts → cli-developer
│   └── Refactoring → refactoring-specialist
│
├── Testing?
│   └── test-automator
│
├── Bug Investigation?
│   └── error-detective
│
├── Code Quality?
│   ├── Pre-commit → code-reviewer
│   └── Requirements → qa-expert
│
├── Documentation?
│   └── documentation-engineer
│
└── Business Context?
    └── business-analyst
```

---

## Agent Capabilities

### architect-reviewer

**Purpose**: System design validation and architectural decisions.

**Use When**:
- Designing new features
- Evaluating technical approaches
- Reviewing system architecture
- Technology stack decisions

**Outputs**:
- Implementation plans
- Architecture diagrams
- Risk assessments
- Pattern recommendations

**Example Prompt**:
```
Review and design implementation for issue #11 (Chrome-style tabs).
Consider: DockviewReact integration, state management, CSS approach.
Evaluate patterns used elsewhere in the codebase.
```

---

### typescript-pro

**Purpose**: TypeScript implementation with type safety.

**Use When**:
- Implementing TypeScript components
- Defining interfaces and types
- API contracts
- Complex type definitions

**Outputs**:
- Production-ready TypeScript code
- Type definitions
- Interface designs

**Example Prompt**:
```
Implement EditorTab component following the approved plan.
Interface: IDockviewPanelHeaderProps<EditorTabParams>
Include: dirty indicator, close button, context menu support.
Follow existing patterns in src/renderer/src/components/.
```

---

### test-automator

**Purpose**: Test creation and coverage optimization.

**Use When**:
- Writing unit tests
- Integration test scenarios
- Coverage improvement
- Test infrastructure

**Outputs**:
- Test files
- Coverage reports
- Test utilities

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
- Pre-commit review
- Pull request review
- Security audit
- Best practices check

**Outputs**:
- Review findings (Critical/Medium/Low)
- Security concerns
- Improvement suggestions

**Example Prompt**:
```
Review changes for issue #11.
Files: EditorTab.tsx, EditorTab.css, useTabContextMenu.tsx, tabOperations.ts
Check: security, performance, patterns, test coverage.
```

---

### error-detective

**Purpose**: Error diagnosis and pattern detection.

**Use When**:
- Bug investigation
- Error correlation
- Root cause analysis
- Incident debugging

**Outputs**:
- Root cause identification
- Error patterns
- Fix recommendations

**Example Prompt**:
```
Investigate terminal scroll jumping during streaming output.
Symptoms: Scroll position resets to top during Claude CLI output.
Affected: TerminalPanel.tsx, xterm.js integration.
```

---

### refactoring-specialist

**Purpose**: Code restructuring and complexity reduction.

**Use When**:
- Code smell detection
- Complexity reduction
- Technical debt cleanup
- Pattern application

**Outputs**:
- Refactored code
- Extracted modules
- Pattern implementations

**Example Prompt**:
```
Refactor ProjectTree.tsx to reduce complexity.
Apply: SOLID principles, Strategy pattern for context menu.
Extract: Pure logic to testable utilities.
```

---

### documentation-engineer

**Purpose**: Technical documentation and API docs.

**Use When**:
- Feature documentation
- API documentation
- README updates
- Architecture docs

**Outputs**:
- Documentation files
- API reference
- Code comments

**Example Prompt**:
```
Document the new EditorTab component.
Include: usage, props, CSS customization, context menu.
Update CLAUDE.md with changelog entry.
```

---

### cli-developer

**Purpose**: Command-line tools and scripts.

**Use When**:
- Build scripts
- CLI utilities
- Developer tools
- Automation scripts

**Outputs**:
- CLI tools
- Build configurations
- Shell scripts

---

### business-analyst

**Purpose**: Requirements and stakeholder analysis.

**Use When**:
- Requirements gathering
- Feature prioritization
- ROI analysis
- Process documentation

**Outputs**:
- Requirements documents
- User stories
- Impact analysis

---

### qa-expert

**Purpose**: Quality assurance and acceptance validation.

**Use When**:
- Pre-release validation
- Acceptance criteria verification
- Quality gate definition
- Regression planning

**Outputs**:
- Test plans
- Quality reports
- Acceptance sign-off

---

## When NOT to Use Agents

Agents add overhead. Skip them for:

| Scenario | Reason |
|----------|--------|
| < 10 lines of code | Direct implementation faster |
| Simple typo fixes | No architecture needed |
| Documentation updates | Direct edit sufficient |
| Single file changes | Context already available |
| Trivial bugs | Root cause obvious |

---

## Agent Orchestration Patterns

### Sequential (Dependencies)

```
architect-reviewer → typescript-pro → test-automator → code-reviewer
```

Each step depends on previous output.

### Parallel (Independent)

```
┌─ typescript-pro (component A)
│
├─ typescript-pro (component B)
│
└─ test-automator (test utilities)
```

Multiple agents can work simultaneously on independent parts.

### Iterative (Feedback Loop)

```
typescript-pro → code-reviewer → typescript-pro (fixes) → code-reviewer
```

Repeat until quality standards met.

---

## Agent Failure Handling

### If Agent Fails to Complete

| Agent | Failure Mode | Recovery Action |
|-------|--------------|-----------------|
| architect-reviewer | Plan incomplete | Manual architecture, skip to implementation |
| typescript-pro | Code not compiling | Fix errors manually, re-invoke for remaining work |
| test-automator | Tests not covering all cases | Write additional tests manually |
| code-reviewer | Review incomplete | Manual review using checklist |
| error-detective | Root cause unclear | Add logging, reproduce manually |

### Context Passing Between Agents

Results from one agent should inform the next:

```
# Architect output becomes implementation input
architect_plan = Task(subagent_type='architect-reviewer')

# Pass plan to typescript-pro
Task(subagent_type='typescript-pro')
Prompt: "Implement following this plan: {architect_plan}"

# Pass implementation to code-reviewer
Task(subagent_type='code-reviewer')
Prompt: "Review these changes: {list of files modified}"
```

### Retry Strategy

1. **First failure**: Review agent output, refine prompt, retry once
2. **Second failure**: Fall back to manual work for that phase
3. **Document**: Note what failed in commit message or issue comment

---

## Agent Invocation Template

```
Use Task tool with subagent_type='<agent-name>'

Prompt structure:
1. Context: Issue number, acceptance criteria
2. Scope: Specific files/components to work on
3. Constraints: Patterns to follow, things to avoid
4. Expected output: What the agent should produce
```

### Example: Full Feature Implementation

```
# Phase 2: Architecture
Task(subagent_type='architect-reviewer')
Prompt: "Design implementation for issue #11..."

# Phase 3: Implementation
Task(subagent_type='typescript-pro')
Prompt: "Implement EditorTab.tsx following approved plan..."

Task(subagent_type='test-automator')
Prompt: "Write tests for EditorTab component..."

# Phase 4: Review
Task(subagent_type='code-reviewer')
Prompt: "Review all changes for issue #11..."
```

---

## Agent Selection by Issue Label

| Label | Primary Agent | Supporting Agents |
|-------|--------------|-------------------|
| `bug` | error-detective | typescript-pro, test-automator |
| `enhancement` | architect-reviewer | typescript-pro, code-reviewer |
| `documentation` | documentation-engineer | - |
| `refactor` | refactoring-specialist | code-reviewer |
| `security` | code-reviewer | typescript-pro |
| `performance` | architect-reviewer | typescript-pro |
| `test` | test-automator | - |

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

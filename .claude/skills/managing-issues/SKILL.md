---
name: managing-issues
version: 2.0.0
status: active
description: Full lifecycle management of GitHub issues - create, implement, and review. Routes to appropriate operation based on user intent. Use when creating issues, reporting bugs, requesting features, implementing issues, reviewing code, or working on GitHub issues.
---

# Managing GitHub Issues

Complete lifecycle management for GitHub issues and source code through structured operations with specialized agents and human checkpoints. Includes issue creation, implementation, and standalone code review.

## CRITICAL RULES

**These rules are NON-NEGOTIABLE. Violations cause automatic failures.**

### General Rules
- MUST create TodoWrite list at operation start
- MUST delegate to agents, not execute directly
- Retry failed steps max 3 times, then escalate to user

### Implement Operation Enforcement Rules
- **NO PHASE SKIPPING** - ALL 12 phases (0-11) MUST execute
- **QUALITY GATES MANDATORY** - Every phase ends with QG-N
- **SEQUENTIAL EXECUTION** - Phase N cannot start until QG-(N-1) = PASS
- **INPUT CONDITIONS REQUIRED** - STOP if any input condition unchecked
- **OUTPUT CONDITIONS REQUIRED** - STOP if any output condition unchecked
- **NON-OVERRIDABLE GATES** - QG-0, QG-6, QG-8 CANNOT be skipped
- MUST NOT skip security scan (QG-6 - NEVER skippable)

### Create Operation Rules
- MUST NOT create/modify issues without user approval

---

## Operations

| Operation | Trigger Phrases | Description |
|-----------|-----------------|-------------|
| **Create** | "create issue", "report bug", "request feature", "file issue" | Create new GitHub issues from user descriptions |
| **Implement** | "implement #N", "fix #N", "work on #N", "tackle issue" | Implement existing GitHub issues |
| **Review** | "review", "check code", "analyze", "audit" | Comprehensive source code review |

### Future Operations (Planned)

| Operation | Description | Status |
|-----------|-------------|--------|
| View | View issue details and comments | Planned |
| List | Search and list issues | Planned |
| Update | Update issue status, labels, assignees | Planned |
| Close | Close issues with resolution | Planned |
| Triage | Prioritize and categorize issues | Planned |

---

## Auto-Discovery Triggers

This skill auto-activates when user input matches these patterns:

### Create Operation Triggers
- "create issue", "create an issue", "file an issue"
- "report bug", "report a bug", "found a bug"
- "request feature", "want a feature", "new feature"
- "file issue", "open issue", "submit issue"
- "there's a problem with...", "something's broken"

### Implement Operation Triggers
- "implement #N", "implement issue #N"
- "fix #N", "fix issue #N", "resolve #N"
- "work on #N", "work on issue #N"
- "tackle issue", "address issue"
- "let's fix", "let's implement", "let's work on"

### Review Operation Triggers
- "review", "review code", "review file", "review component"
- "check", "check code", "check this", "check my code"
- "analyze", "analyze code", "analyze architecture"
- "audit", "audit security", "security audit"
- "look at", "take a look at", "examine"
- "what do you think of", "is this code good"

### Ambiguous (Will Ask for Clarification)
- "issue #N" (view? implement?)
- "help with issues" (create? implement?)
- "GitHub issue" (without clear action)

---

## Operation Routing

### Step 1: Detect Intent

Analyze user input to determine operation:

```
User says "create issue" / "report bug" / "request feature"
  → Route to Create operation

User says "implement #N" / "fix #N" / "work on issue"
  → Route to Implement operation

User says "review" / "check code" / "analyze" / "audit"
  → Route to Review operation

User says "show issue #N" / "view #N"
  → Not yet implemented (inform user)

Ambiguous input
  → Ask: "Would you like to create a new issue, implement an existing one, or review code?"
```

### Step 2: Route to Operation

- **Create**: See [operations/create.md](operations/create.md)
- **Implement**: See [operations/implement.md](operations/implement.md)
- **Review**: See [operations/review.md](operations/review.md)

---

## Progress Tracking (MANDATORY)

At operation start, create todo list with operation-specific phases.

### Create Operation Todos

```
TodoWrite([
  {content: "Phase 1: Understand the problem", status: "in_progress", activeForm: "Understanding problem"},
  {content: "Phase 2: Ask clarifying questions", status: "pending", activeForm: "Asking clarifying questions"},
  {content: "Phase 3: Check for duplicates", status: "pending", activeForm: "Checking for duplicates"},
  {content: "Phase 4: Draft the issue", status: "pending", activeForm: "Drafting issue"},
  {content: "Phase 5: Present and confirm", status: "pending", activeForm: "Presenting for approval"}
])
```

### Implement Operation Todos

```
TodoWrite([
  {content: "Phase 0: Pre-flight (QG-0)", status: "in_progress", activeForm: "Running pre-flight checks"},
  {content: "Phase 1: Business Analysis (QG-1)", status: "pending", activeForm: "Analyzing requirements"},
  {content: "Phase 2: Discovery (QG-2)", status: "pending", activeForm: "Discovering codebase"},
  {content: "Phase 3: Architecture (QG-3)", status: "pending", activeForm: "Designing architecture"},
  {content: "Phase 4: Implementation (QG-4)", status: "pending", activeForm: "Implementing code"},
  {content: "Phase 5: Architectural Review (QG-5)", status: "pending", activeForm: "Reviewing architecture"},
  {content: "Phase 6: Security (QG-6)", status: "pending", activeForm: "Scanning security"},
  {content: "Phase 7: Quality Review (QG-7)", status: "pending", activeForm: "Reviewing quality"},
  {content: "Phase 8: Verification (QG-8)", status: "pending", activeForm: "Verifying implementation"},
  {content: "Phase 9: Documentation (QG-9)", status: "pending", activeForm: "Updating documentation"},
  {content: "Phase 10: UAT (QG-10)", status: "pending", activeForm: "Running acceptance tests"},
  {content: "Phase 11: Finalization (QG-11)", status: "pending", activeForm: "Finalizing commit"}
])
```

### Review Operation Todos

```
TodoWrite([
  {content: "Phase 0: Select review scope", status: "in_progress", activeForm: "Selecting review scope"},
  {content: "Phase 1: Identify target files", status: "pending", activeForm: "Identifying target files"},
  {content: "Phase 2: Select review level", status: "pending", activeForm: "Selecting review level"},
  {content: "Phase 3: Execute review", status: "pending", activeForm: "Executing review"},
  {content: "Phase 4: Present results", status: "pending", activeForm: "Presenting results"}
])
```

**Rules:**
- Mark phase `in_progress` BEFORE starting
- Mark phase `completed` IMMEDIATELY after quality gate passes
- Only ONE phase should be `in_progress` at a time
- **STOP if quality gate fails after 3 retries**

---

## Agents

All agents are embedded in `agents/` directory with full execution logic.

### Create Operation Agents

| Agent | Purpose |
|-------|---------|
| draft-issue | Draft GitHub issues following templates |

### Implement Operation Agents

| Agent | Phase | Purpose |
|-------|-------|---------|
| analyze-requirements | 1 | Prior art research + requirements |
| explore-codebase | 2 | Find files and patterns |
| design-solution | 3, 8 | Plan + verify implementation |
| implement-code | 4 | Write production code |
| write-tests | 4 | Create comprehensive tests |
| review-architecture | 5 | SOLID principles, coupling, patterns |
| audit-security | 6 | Security scanning |
| review-code | 7 | Comprehensive quality review |
| update-docs | 9 | Update documentation |
| summarize-diff | 11 | Generate commit messages |

### Review Operation Agents

| Agent | Purpose |
|-------|---------|
| review-standalone | Orchestrate standalone code reviews by scope and level |

*Note: Review operation also reuses Implement agents (review-architecture, review-code, audit-security) for deep analysis.*

### Conditional Agents

| Agent | Trigger | Purpose |
|-------|---------|---------|
| investigate-bug | `bug` label | Root cause analysis |
| advise-refactor | `refactor` label | Code smell detection |
| fix-docs | Tier 1 doc issues | Quick doc fixes |

See [reference/agents-reference.md](reference/agents-reference.md) for detailed agent specifications.

---

## Quality Gate Summary (Implement Operation)

| Gate | Phase | Type | Can Override |
|------|-------|------|--------------|
| QG-0 | Pre-flight | Mandatory | **NO** |
| QG-1 | Business Analysis | Checkpoint (T2) | Yes |
| QG-2 | Discovery | Checkpoint (T2) | Yes |
| QG-3 | Architecture | User-Approval | Yes |
| QG-4 | Implementation | Automated | Yes |
| QG-5 | Architectural Review | Checkpoint (T2) | Yes |
| QG-6 | Security | Mandatory | **NO** |
| QG-7 | Quality Review | Checkpoint (T2) | Yes |
| QG-8 | Verification | Mandatory | **NO** |
| QG-9 | Documentation | Automated | Yes |
| QG-10 | UAT | User-Approval (T2) | Yes |
| QG-11 | Finalization | User-Approval | Yes |

---

## Implement Workflow Overview

```
START → QG-0 (Pre-flight) [MANDATORY]
          ↓ PASS
        QG-1 → QG-2 → QG-3 (Architecture)
                        ↓ User Approval
        QG-4 (Implement) → QG-5 (Arch Review)
                            ↓
        QG-6 (Security) [MANDATORY - NEVER SKIP]
          ↓ PASS
        QG-7 → QG-8 (Verify) [MANDATORY]
                ↓ PASS
        QG-9 → QG-10 → QG-11 (Finalize)
                         ↓ User Approval
                       DONE

On FAIL (after 3 retries): ESCALATE to user
Mandatory gates (QG-0, QG-6, QG-8): Cannot override
```

---

## Available Labels

Use these standard labels (check project for custom labels with `gh label list`):

| Label | When to Use |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New feature or improvement |
| `documentation` | Docs improvements |
| `good first issue` | Simple, newcomer-friendly |
| `help wanted` | Extra attention needed |
| `security` | Security-related issues |
| `breaking-change` | Breaking API changes |

---

## gh CLI Quick Reference

```bash
# List issues
gh issue list
gh issue list --search "keyword"
gh issue list --label "bug"

# View issue
gh issue view 123

# Create issue (requires user approval)
gh issue create --title "Title" --label "bug" --body "Body"

# Comment on issue
gh issue comment 123 --body "Comment"

# Close issue
gh issue close 123
```

---

## Anti-Patterns

### DO NOT:

1. **Skip phases** - ALL phases must execute (tier determines depth, not skip)
2. **Skip quality gates** - Every phase MUST end with QG-N check
3. **Proceed on FAIL** - STOP if any quality gate fails after retries
4. **Override mandatory gates** - QG-0, QG-6, QG-8 are NEVER skippable
5. **Create issues without approval** - Always wait for explicit user confirmation
6. **Include file paths in issues** - They become stale
7. **Skip duplicate check** - Always search first
8. **Execute directly** - Delegate to agents
9. **Scope creep** - Stay within acceptance criteria

---

## Examples

See [examples.md](examples.md) for detailed walkthroughs:

| Example | Operation | Description |
|---------|-----------|-------------|
| Report resize handle bug | Create | Bug report flow |
| Request dark mode | Create | Feature request flow |
| Fix README typo | Implement | Tier 1 trivial issue |
| Add Chrome-style tabs | Implement | Tier 2 standard feature |
| Review EditorTab | Review | Standard component review |
| Quick PR review | Review | Quick review of changes |
| Deep services audit | Review | Deep module review |

---

## Reference

- **Operations**: [operations/](operations/) - Create, Implement, Review workflows
- **Agents**: [agents/](agents/) - Specialized execution agents
- **Phases**: [phases/](phases/) - Implement operation phase guides (0-11)
- **Templates**: [templates/](templates/) - Issue and implementation templates
- **Reference**: [reference/](reference/) - Agent specs and issue principles

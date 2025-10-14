# Agent Delegation Guide

Complete guide for delegating tasks to specialized Claude Code agents in Erfana development.

## Overview

**Location**: `.claude/agents/` - 10 specialized subagents with independent context windows

**Purpose**: Each agent has deep domain expertise and isolated context, preventing context pollution in main conversation while providing specialized capabilities.

**Key Benefit**: Mandatory agents (code-reviewer, typescript-pro, etc.) prevent production issues by enforcing quality gates at critical points.

---

## Agent Categories

### Mandatory Agents (MUST USE)

These agents MUST be invoked at specified trigger points. Skipping them risks production issues.

#### 1. code-reviewer
**When to use** (MANDATORY):
- After implementing ANY code changes (features, fixes, refactors)
- Before git commits or pull requests
- Before merging branches or pushing to production
- When user explicitly requests code review

**Capabilities**:
- Security vulnerability detection
- Code quality assessment
- Performance optimization review
- Best practices validation across all languages

**Invocation**:
```
"Use the code-reviewer subagent to review [component/file] for [security/quality/performance]"
```

**Example**:
```
"Use the code-reviewer subagent to review the authentication module for security vulnerabilities"
```

---

#### 2. typescript-pro
**When to use** (MANDATORY):
- When modifying ANY TypeScript file (.ts, .tsx)
- Defining data structures, interfaces, types
- Creating API contracts or component props
- Type errors or runtime type issues detected

**Capabilities**:
- Strict type definitions
- Compile-time type checking
- Runtime error prevention
- Type safety opportunities identification

**Invocation**:
```
"Use the typescript-pro subagent to ensure type safety for [module/component]"
```

**Example**:
```
"Use the typescript-pro subagent to add strict type definitions to the API client"
```

---

#### 3. test-automator
**When to use** (MANDATORY):
- After implementing new features
- After bug fixes requiring test coverage
- When test coverage drops below 80%
- Before deployments if tests missing

**Capabilities**:
- Comprehensive test suite generation
- Unit, integration, and E2E tests
- Test coverage analysis
- Maintains >80% coverage target

**Invocation**:
```
"Use the test-automator subagent to create tests for [feature/component]"
```

**Example**:
```
"Use the test-automator subagent to generate comprehensive test suite for user service"
```

---

#### 4. documentation-engineer
**When to use** (MANDATORY):
- After creating or modifying APIs/endpoints
- After adding new features or components
- When documentation is outdated or missing
- User explicitly requests documentation updates

**Capabilities**:
- Technical documentation generation
- API documentation (OpenAPI/Swagger)
- Developer content creation
- Documentation-as-code systems
- Automated generation

**Invocation**:
```
"Use the documentation-engineer subagent to document [API/feature/component]"
```

**Example**:
```
"Use the documentation-engineer subagent to update API documentation for the new authentication endpoints"
```

---

#### 5. qa-expert
**When to use** (MANDATORY):
- Before ANY feature release or deployment
- When quality gates need validation
- After receiving bug reports or customer complaints
- Requirements change requiring quality assessment

**Capabilities**:
- Quality gate validation
- Acceptance criteria verification
- Bug report analysis
- Release readiness assessment

**Invocation**:
```
"Use the qa-expert subagent to validate quality for [feature/release]"
```

**Example**:
```
"Use the qa-expert subagent to validate the user authentication feature before release"
```

---

#### 6. error-detective
**When to use** (MANDATORY):
- When ANY error, exception, or failure occurs
- Error rates increase or patterns emerge
- After incidents, outages, or system behavior changes
- User reports unexpected behavior

**Capabilities**:
- Error pattern correlation
- Distributed error analysis
- Cascading failure prediction
- Root cause identification

**Invocation**:
```
"Use the error-detective subagent to analyze [error/failure/incident]"
```

**Example**:
```
"Use the error-detective subagent to investigate the API timeout errors in production"
```

---

### Proactive Agents (USE WHEN APPLICABLE)

These agents should be used when context matches, but aren't strictly mandatory.

#### 7. architect-reviewer
**When to use** (PROACTIVE):
- Designing new features or system components
- Modifying system architecture or technology stack
- Evaluating technical decisions
- After creating architectural diagrams or design documents

**Capabilities**:
- System design validation
- Architectural decision review
- Technology stack evaluation
- Scalability assessment

**Invocation**:
```
"Use the architect-reviewer subagent to review [architecture/design] for [feature/system]"
```

**Example**:
```
"Use the architect-reviewer subagent to evaluate the microservices architecture for the new payment system"
```

---

#### 8. refactoring-specialist
**When to use** (PROACTIVE):
- Code complexity exceeds thresholds (cyclomatic > 10)
- Code smells detected (long methods, duplication)
- During code reviews identifying technical debt
- User requests code quality improvements

**Capabilities**:
- Code structure improvement
- Technical debt reduction
- Complexity reduction
- Duplication elimination

**Invocation**:
```
"Use the refactoring-specialist subagent to refactor [component/module] to reduce [complexity/duplication]"
```

**Example**:
```
"Use the refactoring-specialist subagent to refactor the UserService class to reduce cyclomatic complexity"
```

---

#### 9. business-analyst
**When to use** (PROACTIVE):
- Defining new features or requirements
- Analyzing business impact or ROI
- Gathering stakeholder needs
- Before technical implementation planning

**Capabilities**:
- Requirements gathering
- Stakeholder analysis
- Process documentation
- Business impact assessment
- ROI evaluation

**Invocation**:
```
"Use the business-analyst subagent to analyze requirements for [feature/initiative]"
```

**Example**:
```
"Use the business-analyst subagent to gather requirements for the new reporting dashboard feature"
```

---

#### 10. cli-developer
**When to use** (PROACTIVE):
- Creating automation scripts or build tools
- Developing CLI tools or terminal interfaces
- Improving developer workflows or utilities

**Capabilities**:
- CLI tool development
- Terminal interface design
- Developer automation
- Build tool creation
- Workflow optimization

**Invocation**:
```
"Use the cli-developer subagent to build [tool/script] for [workflow/automation]"
```

**Example**:
```
"Use the cli-developer subagent to create a deployment automation script for staging environments"
```

---

## Invocation Syntax

### Natural Language (Primary Method)

**Pattern**:
```
"Use the <agent-name> subagent to <task description>"
```

**Examples**:
```
"Use the code-reviewer subagent to review the authentication module for security vulnerabilities"
"Use the typescript-pro subagent to add strict type definitions to the API client"
"Use the test-automator subagent to generate comprehensive test suite for user service"
"Use the documentation-engineer subagent to update docs for the new webhook endpoints"
```

### Automatic Delegation (Rare)

Agents with "MUST BE USED" or "use PROACTIVELY" in descriptions may trigger automatically, but research shows Claude "almost never delegates automatically" without explicit invocation.

**Best Practice**: Always use explicit natural language invocation to ensure execution.

---

## Decision Framework

### Step 1: Pattern Match Task

Quick checklist for mandatory agents:

| Task Type | Agent | Priority |
|-----------|-------|----------|
| Code changes | code-reviewer | MANDATORY |
| TypeScript files | typescript-pro | MANDATORY |
| New feature | test-automator | MANDATORY |
| API changes | documentation-engineer | MANDATORY |
| Before deploy | qa-expert | MANDATORY |
| Error occurred | error-detective | MANDATORY |

### Step 2: Assess Context

Proactive agent checklist:

| Context | Agent | Priority |
|---------|-------|----------|
| Architecture decision | architect-reviewer | PROACTIVE |
| Code quality issue | refactoring-specialist | PROACTIVE |
| Business requirements | business-analyst | PROACTIVE |
| Developer tooling | cli-developer | PROACTIVE |

### Step 3: Invoke Agent

1. **Identify the agent**: Match task to agent capability
2. **Craft invocation**: Use natural language pattern
3. **Be specific**: Clear task descriptions improve output
4. **Trust results**: Agents have deep domain expertise

---

## Best Practices

### Critical Rules

1. **NEVER skip mandatory agents** - They prevent production issues
2. **Delegate early** - Before problems compound
3. **Be specific** - Clear task descriptions improve agent output
4. **Trust specialization** - Agents have deep domain expertise
5. **Use isolated contexts** - Prevents context pollution in main thread

### When to Delegate

**Mandatory Triggers** (Auto-delegate):
- ✅ Completed code implementation → code-reviewer
- ✅ Modified TypeScript file → typescript-pro
- ✅ Added new feature → test-automator + documentation-engineer
- ✅ About to deploy → qa-expert
- ✅ Error encountered → error-detective

**Proactive Triggers** (Consider delegating):
- 🔵 Architecture discussion → architect-reviewer
- 🔵 Code smells detected → refactoring-specialist
- 🔵 Requirements gathering → business-analyst
- 🔵 Automation needed → cli-developer

### Delegation Workflow

```
1. Recognize trigger condition
   ↓
2. Select appropriate agent(s)
   ↓
3. Craft specific invocation with context
   ↓
4. Agent executes in isolated context
   ↓
5. Results returned to main conversation
   ↓
6. Apply agent recommendations
```

---

## Agent Execution Model

### Isolated Context Windows

Each agent operates with:
- **Independent context**: No pollution of main conversation
- **Focused expertise**: Deep domain knowledge
- **Full tool access**: All tools specified in agent config (YAML frontmatter)
- **Stateless execution**: Single report returned to caller

### Tool Access by Agent

Agents have access to various tools based on their needs:

**Most agents**: `*` (all tools available)
- code-reviewer, typescript-pro, test-automator, documentation-engineer, qa-expert, error-detective, architect-reviewer, refactoring-specialist, business-analyst, cli-developer

**Restricted agents**: Specific tool subsets (if any - check agent YAML)

---

## Examples by Scenario

**Feature Implementation**: business-analyst → architect-reviewer → typescript-pro → test-automator → code-reviewer → documentation-engineer → qa-expert

**Bug Fix**: error-detective → code-reviewer → test-automator

**Refactoring**: refactoring-specialist → typescript-pro → test-automator → code-reviewer

**New Tool**: cli-developer → code-reviewer → documentation-engineer

---

## Troubleshooting

### Agent Not Executing?

**Check invocation syntax**:
- ✅ Correct: "Use the code-reviewer subagent to..."
- ❌ Wrong: "/task code-reviewer" or "Run code-reviewer"

**Verify agent exists**:
- Check `.claude/agents/` directory
- Verify YAML frontmatter is valid

### Agent Returns Unexpected Results?

**Improve task description**:
- Be specific about scope
- Provide context
- Specify expected output format

### Too Many Agents?

**Combine wisely**:
- OK: test-automator + documentation-engineer (related tasks)
- Avoid: All 10 agents for simple change (overkill)

---

## Agent Definitions

All agent configurations stored in `.claude/agents/*.md` with YAML frontmatter.

**Files**:
- `architect-reviewer.md` (294 lines)
- `business-analyst.md` (296 lines)
- `cli-developer.md` (295 lines)
- `code-reviewer.md` (296 lines)
- `documentation-engineer.md` (285 lines)
- `error-detective.md` (297 lines)
- `qa-expert.md` (298 lines)
- `refactoring-specialist.md` (294 lines)
- `test-automator.md` (299 lines)
- `typescript-pro.md` (286 lines)

**Total**: 2,940 lines of specialized agent configurations

---

## Integration with Erfana

**Common workflows**:
- **New IPC channel**: typescript-pro → code-reviewer → documentation-engineer
- **New UI component**: typescript-pro → test-automator → code-reviewer
- **Bug fix**: error-detective → test-automator → code-reviewer
- **Refactoring**: refactoring-specialist → typescript-pro → code-reviewer

---

## See Also

- [Agent Configurations](../.claude/agents/) - Individual agent definitions
- [CLAUDE.md](../CLAUDE.md) - Quick reference and main instructions
- [Development Tasks](./development-tasks.md) - Common development patterns

# Agent Reference Guide

Quick reference for selecting and using embedded agents during issue management.

---

## Agent Overview

All agents are embedded in `agents/` directory with full input/output contracts.

### Create Operation Agents

| Agent | Purpose |
|-------|---------|
| draft-issue | Draft GitHub issues following templates |

### Review Operation Agents

| Agent | Purpose |
|-------|---------|
| review-standalone | Orchestrate standalone code reviews by scope and level |

*Note: Review operation also reuses Implement agents (review-architecture, review-code, audit-security) for deep analysis.*

### Implement Operation Agents (Core Workflow)

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

### Release Agents (Used by releasing-erfana skill)

| Agent | Purpose |
|-------|---------|
| prepare-release | Prepare releases (not part of Implement operation) |

### Conditional Agents

| Agent | Trigger | Purpose |
|-------|---------|---------|
| investigate-bug | `bug` label | Root cause analysis |
| advise-refactor | `refactor` label | Code smell detection |
| fix-docs | Tier 1 doc issues | Quick doc fixes |

---

## Agent Selection Decision Tree

```
Start: What operation are you in?
│
├── Create Operation
│   └── draft-issue
│
├── Review Operation
│   │
│   ├── Quick Level
│   │   └── review-standalone (security, anti-patterns)
│   │
│   ├── Standard Level
│   │   ├── review-standalone (orchestrator)
│   │   ├── review-code (quality)
│   │   └── audit-security (security)
│   │
│   └── Deep Level
│       ├── review-standalone (orchestrator)
│       ├── review-architecture (SOLID)
│       ├── review-code (quality)
│       └── audit-security (OWASP)
│
└── Implement Operation: What phase are you in?
    │
    ├── Phase 1: Business Analysis
    │   └── analyze-requirements
    │
    ├── Phase 2: Discovery
    │   └── explore-codebase
    │
    ├── Phase 3: Architecture
    │   └── design-solution
    │
    ├── Phase 4: Implementation
    │   ├── Code → implement-code
    │   └── Tests → write-tests
    │
    ├── Phase 5: Architectural Review
    │   └── review-architecture
    │
    ├── Phase 6: Security
    │   └── audit-security
    │
    ├── Phase 7: Quality Review
    │   └── review-code
    │
    ├── Phase 8: Verification
    │   └── design-solution (verify mode)
    │
    ├── Phase 9: Documentation
    │   └── update-docs
    │
    ├── Phase 10: UAT
    │   └── (manual user testing)
    │
    └── Phase 11: Finalization
        └── summarize-diff
```

*Note: Release functionality is handled by the separate `releasing-erfana` skill.*

### By Issue Label

| Label | Primary Agent | Supporting |
|-------|---------------|------------|
| `bug` | investigate-bug | implement-code, write-tests |
| `enhancement` | analyze-requirements | design-solution, implement-code |
| `documentation` | fix-docs or update-docs | - |
| `refactor` | advise-refactor | implement-code, review-code |
| `security` | audit-security | implement-code |

---

## Agent Details

### draft-issue

**Operation:** Create
**File:** `agents/draft-issue.md`

**Modes:**
- `gather-requirements`: Ask clarifying questions
- `draft`: Generate issue using template

**Inputs:**
- mode, issue_type, user_description, gathered_requirements

**Outputs:**
- title, body, labels, template_used

**Use When:**
- Creating new GitHub issues
- Drafting bug reports
- Drafting feature requests

**Constraints:**
- NEVER include file paths or line numbers
- ALWAYS use checkbox format for criteria
- Focus on behavior, not implementation

---

### review-standalone

**Operation:** Review
**File:** `agents/review-standalone.md`

**Modes (by level):**
- `quick`: Security and anti-patterns only
- `standard`: + Code quality, basic SOLID, testing
- `deep`: + All SOLID, coupling, cohesion, performance, documentation

**Inputs:**
- scope (file, component, module, feature, pr, codebase)
- level (quick, standard, deep)
- target_files, dimensions

**Outputs:**
- review_status, scope, level, files_reviewed, findings, summary, recommendations

**Use When:**
- Standalone code review (not tied to issue)
- PR review before merge
- Component/module quality check
- Architecture assessment
- Security audit

**Key Features:**
- ALWAYS asks for scope and level
- Supports 6 review scopes
- 3 review levels with increasing depth
- 10 review dimensions
- Categorizes findings by severity (critical/high/medium/low)

---

### analyze-requirements

**Phase:** 1 (Business Analysis)
**File:** `agents/analyze-requirements.md`

**Inputs:**
- issue_number, issue_body, issue_labels, tier

**Outputs:**
- issue_type, research_summary, requirements, acceptance_criteria, scope_boundaries, risks

**Use When:**
- Starting any issue implementation
- Requirements need clarification
- Prior art research needed

---

### explore-codebase

**Phase:** 2 (Discovery)
**File:** `agents/explore-codebase.md`

**Inputs:**
- issue_number, issue_summary, search_targets, research_findings

**Outputs:**
- affected_files, patterns_found, recommended_examination, structure_notes

**Use When:**
- Need to find related code
- Understanding project structure
- Identifying affected areas

---

### design-solution

**Phase:** 3 (Architecture), 8 (Verification)
**File:** `agents/design-solution.md`

**Inputs:**
- issue_number, issue_body, acceptance_criteria, affected_files, patterns_found, tier

**Outputs:**
- implementation_plan, file_changes, test_strategy, risks, estimates, verification_criteria

**Use When:**
- Planning new features (Phase 3)
- Verifying implementation (Phase 8)
- Evaluating technical approaches

---

### implement-code

**Phase:** 4 (Implementation)
**File:** `agents/implement-code.md`

**Inputs:**
- issue_number, implementation_plan, step_number, patterns_to_follow

**Outputs:**
- files_created, files_modified, implementation_notes, typecheck_status

**Use When:**
- Writing new components
- Modifying existing code
- Following approved plan

**Constraints:**
- NEVER add features not in plan
- NEVER refactor surrounding code
- ALWAYS verify typecheck

---

### write-tests

**Phase:** 4 (Implementation)
**File:** `agents/write-tests.md`

**Inputs:**
- issue_number, files_to_test, acceptance_criteria, test_strategy

**Outputs:**
- test_files_created, test_count, coverage_estimate, scenarios_covered

**Use When:**
- After implementation
- During TDD
- Improving coverage

**Target:** >80% coverage for new code

---

### review-architecture

**Phase:** 5 (Architectural Review)
**File:** `agents/review-architecture.md`

**Inputs:**
- issue_number, files_changed, implementation_plan, tier, codebase_patterns

**Outputs:**
- assessment, solid_analysis, coupling_score, cohesion_score, findings, critical_issues, recommendations, technical_debt

**Use When:**
- After implementation complete (Tier 2)
- Validating SOLID principles
- Assessing coupling and cohesion
- Checking design pattern usage

**Key Evaluations:**
| Principle | Check |
|-----------|-------|
| Single Responsibility | ONE reason to change per component |
| Open/Closed | Extensible without modification |
| Liskov Substitution | Subtypes replaceable |
| Interface Segregation | Minimal, focused interfaces |
| Dependency Inversion | Depend on abstractions |

**Assessment Outcomes:**
- SOUND: No critical issues, max 2 high
- NEEDS_IMPROVEMENT: High issues or multiple medium
- ARCHITECTURAL_ISSUES: Has critical issues

---

### review-code

**Phase:** 7 (Quality Review)
**File:** `agents/review-code.md`

**Inputs:**
- issue_number, files_changed, acceptance_criteria

**Outputs:**
- review_status, findings, critical_issues, suggestions, security_concerns

**Use When:**
- Before git commit
- After implementation
- Security review needed

---

### audit-security

**Phase:** 6 (Security)
**File:** `agents/audit-security.md`

**Inputs:**
- issue_number, files_changed, issue_labels, tier, ipc_handlers_modified

**Outputs:**
- audit_status, vulnerabilities, npm_audit_result, owasp_checklist, blocking_issues

**Use When:**
- All tiers (basic scan for Tier 1, full audit for Tier 2)
- Security label present

---

### update-docs

**Phase:** 9 (Documentation)
**File:** `agents/update-docs.md`

**Inputs:**
- issue_number, issue_summary, files_changed, test_count, test_files

**Outputs:**
- files_updated, claude_md_section, test_count_updated

**Use When:**
- After features
- Updating CLAUDE.md
- Before releases

---

### summarize-diff

**Phase:** 11 (Finalization)
**File:** `agents/summarize-diff.md`

**Inputs:**
- issue_number, issue_summary, commit_type

**Outputs:**
- commit_message, commit_type, commit_scope, pr_description

**Use When:**
- Before commits
- Creating PRs
- Generating changelogs

---

### prepare-release

**Skill:** releasing-erfana (NOT part of Implement operation)
**File:** `agents/prepare-release.md`

**Inputs:**
- version, previous_version, release_type

**Outputs:**
- release_notes, version_updated, changelog_entry, tag_created, build_status

**Use When:**
- Preparing production release via `releasing-erfana` skill
- Version bumping
- Creating tags

*Note: This agent is NOT used by the Implement operation. Use the `releasing-erfana` skill instead.*

---

### investigate-bug

**Conditional:** `bug` label
**File:** `agents/investigate-bug.md`

**Inputs:**
- issue_number, issue_body, symptoms, reproduction_steps

**Outputs:**
- root_cause, execution_trace, affected_files, fix_recommendations

**Use When:**
- Bug investigation
- Root cause analysis
- Diagnosing errors

---

### advise-refactor

**Conditional:** `refactor` label
**File:** `agents/advise-refactor.md`

**Inputs:**
- issue_number, target_files, refactor_goals, constraints

**Outputs:**
- code_smells, refactoring_steps, patterns_to_apply, risk_assessment

**Use When:**
- Code complexity high
- Technical debt cleanup
- SOLID improvements

---

### fix-docs

**Conditional:** Tier 1 documentation
**File:** `agents/fix-docs.md`

**Inputs:**
- issue_number, file_path, fix_description, line_number

**Outputs:**
- file_updated, changes_made, lines_modified

**Use When:**
- Typo fixes
- Minor corrections
- Simple doc updates

---

## When NOT to Use Agents

Agents add overhead. Skip them for:

| Scenario | Action |
|----------|--------|
| <10 lines of code | Edit directly |
| Simple typo | Edit directly |
| Single file change | Edit directly |
| Obvious bug fix | Edit directly |

---

## Agent Invocation Pattern

All agents follow this pattern:

```markdown
1. Read agent file: `agents/<agent-name>.md`
2. Validate inputs against Input Contract
3. Execute steps using tools (Glob, Grep, Read, Write, Edit, Bash)
4. Validate outputs against Output Contract
5. Check Quality Gate
6. Return structured output
```

---

## Error Recovery

| Agent | Common Failure | Recovery |
|-------|----------------|----------|
| explore-codebase | No files found | Broaden search, retry |
| design-solution | Plan incomplete | Manual architecture |
| implement-code | Typecheck fails | Fix errors, retry |
| write-tests | Coverage low | Add more tests |
| review-architecture | SOLID violations | Fix issues, re-review |
| review-code | Critical issues | Fix issues, re-review |
| audit-security | Vulnerabilities | STOP, fix security |

---

## Quality Thresholds

| Metric | Target |
|--------|--------|
| Test coverage (new code) | >80% |
| TypeScript strict | No errors |
| ESLint | No errors |
| Critical review issues | 0 before commit |
| Security vulnerabilities | 0 high/critical |

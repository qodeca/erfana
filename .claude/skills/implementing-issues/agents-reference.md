# Agent Reference Guide

Quick reference for selecting and using embedded agents during issue implementation.

---

## Agent Overview

All agents are embedded in `agents/` directory with full input/output contracts.

### Core Workflow Agents

| Agent | Phase | Purpose |
|-------|-------|---------|
| analyze-requirements | 0.5 | Prior art research + requirements |
| explore-codebase | 1 | Find files and patterns |
| design-solution | 2, 6 | Plan + verify implementation |
| implement-code | 3 | Write production code |
| write-tests | 3 | Create comprehensive tests |
| review-code | 5 | Pre-commit review |
| audit-security | 4 | Security scanning |
| update-docs | 7 | Update documentation |
| summarize-diff | 9 | Generate commit messages |
| prepare-release | 10 | Prepare releases |

### Conditional Agents

| Agent | Trigger | Purpose |
|-------|---------|---------|
| investigate-bug | `bug` label | Root cause analysis |
| advise-refactor | `refactor` label | Code smell detection |
| fix-docs | Tier 1 doc issues | Quick doc fixes |

---

## Agent Selection Decision Tree

```
Start: What phase are you in?
│
├── Phase 0.5: Business Analysis
│   └── analyze-requirements
│
├── Phase 1: Discovery
│   └── explore-codebase
│
├── Phase 2: Architecture
│   └── design-solution
│
├── Phase 3: Implementation
│   ├── Code → implement-code
│   └── Tests → write-tests
│
├── Phase 4: Security
│   └── audit-security
│
├── Phase 5: Review
│   └── review-code
│
├── Phase 6: Verification
│   └── design-solution (verify mode)
│
├── Phase 7: Documentation
│   └── update-docs
│
├── Phase 9: Finalization
│   └── summarize-diff
│
└── Phase 10: Release
    └── prepare-release
```

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

### analyze-requirements

**Phase:** 0.5 (Business Analysis)
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

**Phase:** 1 (Discovery)
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

**Phase:** 2 (Architecture), 6 (Verification)
**File:** `agents/design-solution.md`

**Inputs:**
- issue_number, issue_body, acceptance_criteria, affected_files, patterns_found, tier

**Outputs:**
- implementation_plan, file_changes, test_strategy, risks, estimates, verification_criteria

**Use When:**
- Planning new features (Phase 2)
- Verifying implementation (Phase 6)
- Evaluating technical approaches

---

### implement-code

**Phase:** 3 (Implementation)
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

**Phase:** 3 (Implementation)
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

### review-code

**Phase:** 5 (Review)
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

**Phase:** 4 (Security)
**File:** `agents/audit-security.md`

**Inputs:**
- issue_number, files_changed, issue_labels, tier, ipc_handlers_modified

**Outputs:**
- audit_status, vulnerabilities, npm_audit_result, owasp_checklist, blocking_issues

**Use When:**
- All tiers (basic scan)
- Tier 3 (full audit)
- Security label present

---

### update-docs

**Phase:** 7 (Documentation)
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

**Phase:** 9 (Finalization)
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

**Phase:** 10 (Release)
**File:** `agents/prepare-release.md`

**Inputs:**
- version, previous_version, release_type

**Outputs:**
- release_notes, version_updated, changelog_entry, tag_created, build_status

**Use When:**
- Preparing production release
- Version bumping
- Creating tags

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

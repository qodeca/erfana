# Agent: review-architecture

Architectural quality review for implemented code changes.

**Reference:** `reference/code-review-standards-2025.md` Section 6 (SOLID Principles)

---

## Purpose

Evaluate the architectural quality of implementation against SOLID principles, design patterns, and software engineering best practices. This agent reviews the *actual code* produced, not just whether it matches the plan.

**MANDATORY:** This review is required for all Tier 2 implementations.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| files_changed | array | Yes | List of modified file paths |
| implementation_plan | object | Yes | Approved plan from design-solution |
| tier | number | Yes | Complexity tier (2 or 3) |
| codebase_patterns | object | No | Established patterns in the codebase |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] files_changed is non-empty array
- [ ] implementation_plan is object with steps
- [ ] tier is 2 (not used for tier 1)

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Read Changed Files

For each file in files_changed:

```
Read(file_path="<changed_file>")
```

Build mental model of:
- Component structure
- Dependencies between files
- Public interfaces exposed

### Step 2: Analyze Single Responsibility Principle (SRP)

**Reference:** `reference/code-review-standards-2025.md` Section 6.1

For each component/class/module:

**Questions to answer:**
- Does this have ONE clear purpose?
- Would changes to feature X affect unrelated feature Y?
- Can you describe its responsibility in one sentence without "and"?

**Detection patterns:**
```bash
# Count lines per file
wc -l <file>
→ >300 lines = HIGH violation
→ >500 lines = CRITICAL violation

# Check for mixed concerns
Grep(pattern="import.*from.*(api|store|service)", path="<component>")
→ Flag if component imports from multiple architectural layers

# Count exports
Grep(pattern="export (const|function|class|interface|type)", path="<file>")
→ >10 exports = MEDIUM violation
```

**Red flags and severity:**
| Indicator | Threshold | Severity |
|-----------|-----------|----------|
| Component lines | >300 | HIGH |
| Component lines | >500 | CRITICAL |
| Unrelated imports | UI + API + Storage | MEDIUM |
| Methods not using state | >3 methods | LOW |
| "Manager/Handler/Processor" names | Any | MEDIUM |
| Multiple exports | >10 | MEDIUM |

**SRP violation example:**
```typescript
// ❌ BAD: Multiple responsibilities
class UserService {
  fetchUser() { }         // Data fetching
  validateEmail() { }     // Validation
  formatUserName() { }    // Formatting
  sendWelcomeEmail() { }  // Side effects
  logUserActivity() { }   // Logging
}

// ✅ GOOD: Single responsibility each
class UserRepository { fetchUser() { } }
class EmailValidator { validate() { } }
class UserFormatter { formatName() { } }
```

### Step 3: Analyze Open/Closed Principle (OCP)

**Reference:** `reference/code-review-standards-2025.md` Section 6.2

**Check for:**
- Can new behavior be added without modifying existing code?
- Are there switch statements on type/kind that grow with features?

**Detection patterns:**
```bash
# Growing switch statements
Grep(pattern="switch\\s*\\([^)]*type|kind|status|action", path="<file>")
→ Flag as MEDIUM if >3 cases

# Type discrimination chains
Grep(pattern="if.*typeof.*===|instanceof", path="<file>")
→ Flag if multiple consecutive checks

# Hardcoded type arrays
Grep(pattern="\\[(\"[^\"]+\",\\s*){3,}", path="<file>")
→ Flag hardcoded lists that likely grow
```

**Red flags and severity:**
| Indicator | Threshold | Severity |
|-----------|-----------|----------|
| Switch on type/kind | >5 cases | HIGH |
| Switch on type/kind | >3 cases | MEDIUM |
| if/else typeof chain | >3 branches | MEDIUM |
| No extension points | Critical path | HIGH |

**OCP violation example:**
```typescript
// ❌ BAD: Must modify to add new type
function getIcon(type: string) {
  switch(type) {
    case 'file': return FileIcon;
    case 'folder': return FolderIcon;
    case 'image': return ImageIcon;
    // Adding new type requires modifying this function
  }
}

// ✅ GOOD: Open for extension
const iconRegistry: Record<string, IconComponent> = {
  file: FileIcon,
  folder: FolderIcon,
  image: ImageIcon,
};
// New types can be registered without modifying function
iconRegistry['video'] = VideoIcon;

function getIcon(type: string) {
  return iconRegistry[type] ?? DefaultIcon;
}
```

### Step 4: Analyze Liskov Substitution Principle (LSP)

**Reference:** `reference/code-review-standards-2025.md` Section 6.3

**Check for:**
- Do subclasses/implementations behave consistently with their base?
- Any type narrowing or `instanceof` checks?
- Preconditions not strengthened in subtypes?
- Postconditions not weakened in subtypes?

**Detection patterns:**
```bash
# Methods throwing "not implemented"
Grep(pattern="throw.*not implemented|throw.*NotImplemented", path="<file>")
→ HIGH violation

# Type guards after interface usage
Grep(pattern="instanceof\\s+[A-Z]", path="<file>")
→ Review context, may indicate LSP issue

# Empty method bodies in implementations
Grep(pattern="\\{\\s*\\}", path="<file>")
→ Check if these are interface implementations
```

**Red flags and severity:**
| Indicator | Threshold | Severity |
|-----------|-----------|----------|
| "Not implemented" throws | Any | HIGH |
| instanceof after base type | In core logic | MEDIUM |
| Empty override methods | Any | HIGH |
| Override changes behavior | Side effects differ | CRITICAL |

**LSP violation example:**
```typescript
// ❌ BAD: Violates LSP
interface Bird {
  fly(): void;
}

class Penguin implements Bird {
  fly(): void {
    throw new Error('Penguins cannot fly'); // LSP violation!
  }
}

// ✅ GOOD: Proper abstraction
interface Bird {
  move(): void;
}

interface FlyingBird extends Bird {
  fly(): void;
}

class Penguin implements Bird {
  move(): void { /* swim */ }
}

class Eagle implements FlyingBird {
  move(): void { /* fly */ }
  fly(): void { /* fly implementation */ }
}
```

### Step 5: Analyze Interface Segregation Principle (ISP)

**Reference:** `reference/code-review-standards-2025.md` Section 6.4

**Check for:**
- Are interfaces focused and minimal?
- Do consumers use all methods of interfaces they depend on?
- Are there "fat" interfaces forcing implementations to stub methods?

**Detection patterns:**
```bash
# Large interfaces
Grep(pattern="interface\\s+[A-Z]", path="<file>")
→ Count methods in each interface
→ >7 methods = MEDIUM violation
→ >10 methods = HIGH violation

# Optional methods in interfaces
Grep(pattern="\\?\\s*:", path="<file>")
→ Review if these indicate ISP issue

# Find interface implementations
Grep(pattern="implements\\s+[A-Z]", path="<file>")
→ Check if implementation uses all methods
```

**Red flags and severity:**
| Indicator | Threshold | Severity |
|-----------|-----------|----------|
| Interface methods | >10 | HIGH |
| Interface methods | >7 | MEDIUM |
| Optional methods | >3 in one interface | MEDIUM |
| Empty implementations | Any | HIGH |

**ISP violation example:**
```typescript
// ❌ BAD: Fat interface
interface Worker {
  work(): void;
  eat(): void;
  sleep(): void;
  attendMeeting(): void;
  writeCode(): void;
  designSystem(): void;
  managePeople(): void;
}

// Robot can't eat or sleep!
class Robot implements Worker {
  work(): void { /* works */ }
  eat(): void { /* empty - violation! */ }
  sleep(): void { /* empty - violation! */ }
  // ...more empty methods
}

// ✅ GOOD: Segregated interfaces
interface Workable { work(): void; }
interface Eatable { eat(): void; }
interface Sleepable { sleep(): void; }
interface Codeable { writeCode(): void; }

class Robot implements Workable, Codeable {
  work(): void { /* works */ }
  writeCode(): void { /* codes */ }
}

class Human implements Workable, Eatable, Sleepable, Codeable {
  work(): void { /* works */ }
  eat(): void { /* eats */ }
  sleep(): void { /* sleeps */ }
  writeCode(): void { /* codes */ }
}
```

### Step 6: Analyze Dependency Inversion Principle (DIP)

**Reference:** `reference/code-review-standards-2025.md` Section 6.5

**Check for:**
- Do high-level modules depend on abstractions?
- Are dependencies injected rather than created?
- Do low-level details depend on high-level policies?

**Detection patterns:**
```bash
# Direct instantiation
Grep(pattern="new [A-Z][a-zA-Z]+(Service|Repository|Manager|Handler)", path="<file>")
→ MEDIUM violation each

# Concrete imports crossing layers
Grep(pattern="import.*from.*\\.\\./(services|repositories|stores)", path="src/renderer/components/")
→ Components should not import concrete services

# Singleton usage
Grep(pattern="\\.getInstance\\(\\)|singleton", path="<file>")
→ Review if this creates tight coupling
```

**Red flags and severity:**
| Indicator | Threshold | Severity |
|-----------|-----------|----------|
| Direct `new Service()` | Any | MEDIUM |
| Import concrete across layers | Any | HIGH |
| Global singleton access | In component | MEDIUM |
| No injection mechanism | Critical path | HIGH |

**DIP violation example:**
```typescript
// ❌ BAD: Direct dependency creation
class UserController {
  private userService = new UserService();      // Tight coupling!
  private emailService = new EmailService();    // Can't mock in tests!
  private logger = Logger.getInstance();        // Global singleton!

  async createUser(data: UserData) {
    const user = await this.userService.create(data);
    await this.emailService.sendWelcome(user);
    this.logger.info('User created');
    return user;
  }
}

// ✅ GOOD: Dependency injection
interface IUserService { create(data: UserData): Promise<User>; }
interface IEmailService { sendWelcome(user: User): Promise<void>; }
interface ILogger { info(message: string): void; }

class UserController {
  constructor(
    private userService: IUserService,    // Injected abstraction
    private emailService: IEmailService,  // Injected abstraction
    private logger: ILogger               // Injected abstraction
  ) {}

  async createUser(data: UserData) {
    const user = await this.userService.create(data);
    await this.emailService.sendWelcome(user);
    this.logger.info('User created');
    return user;
  }
}

// Easy to test with mocks!
const controller = new UserController(
  mockUserService,
  mockEmailService,
  mockLogger
);
```

### Step 7: Evaluate Coupling

**Assess coupling levels:**

```
Grep(pattern="import.*from", path="<file>")
```

**Metrics to consider:**
- Number of imports from other modules
- Depth of import paths (../../../)
- Circular dependency potential

**Coupling Matrix:**
| Level | Characteristics | Action |
|-------|----------------|--------|
| Low | Interfaces, events, messages | Acceptable |
| Medium | Direct function calls, shared types | Review necessity |
| High | Shared mutable state, internal access | Flag for refactor |

### Step 8: Evaluate Cohesion

**Check each module for:**
- Do all functions/methods work toward same goal?
- Are related things grouped together?

**Red flags:**
- "Utility" files with unrelated functions
- Components mixing UI, data fetching, and business logic
- Files named *Helper, *Utils, *Common

### Step 9: Check Dependency Directions

**Verify layer boundaries:**

```
Correct:
  components → hooks → stores → services → utils

Violations:
  services → components (service importing React)
  utils → stores (utility depending on state)
```

**Detection:**
```
Grep(pattern="import.*from.*@/components", path="src/main/")
→ Should find nothing (main shouldn't import renderer components)
```

### Step 10: Anti-Pattern Detection

**Check for common anti-patterns:**

| Anti-Pattern | Detection | Impact |
|--------------|-----------|--------|
| God Object | Single file with many responsibilities | High |
| Feature Envy | Methods using more external state than own | Medium |
| Shotgun Surgery | Small change requires many file edits | High |
| Primitive Obsession | Strings/numbers instead of domain types | Medium |
| Data Clumps | Same group of fields repeated | Low |

### Step 11: Compile Findings

Categorize by severity:
- **Critical**: Fundamental architectural flaw
- **High**: Significant principle violation
- **Medium**: Minor concern, can defer
- **Low**: Suggestion for improvement

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| assessment | string | "SOUND" / "NEEDS_IMPROVEMENT" / "ARCHITECTURAL_ISSUES" |
| solid_analysis | object | Assessment of each SOLID principle |
| coupling_score | string | "low" / "medium" / "high" |
| cohesion_score | string | "high" / "medium" / "low" |
| findings | array | List of architectural issues found |
| critical_issues | array | Issues that MUST be addressed |
| recommendations | array | Improvement suggestions |
| technical_debt | array | Debt introduced (for documentation) |

### SOLID Analysis Structure

```json
{
  "single_responsibility": {
    "status": "pass|warn|fail",
    "notes": "Assessment details",
    "violations": []
  },
  "open_closed": { ... },
  "liskov_substitution": { ... },
  "interface_segregation": { ... },
  "dependency_inversion": { ... }
}
```

### Finding Structure

```json
{
  "severity": "critical|high|medium|low",
  "principle": "SRP|OCP|LSP|ISP|DIP|coupling|cohesion|pattern",
  "file": "path/to/file.ts",
  "line": 42,
  "issue": "Description of the architectural issue",
  "impact": "What problems this could cause",
  "recommendation": "How to fix"
}
```

### Output Format

```json
{
  "assessment": "NEEDS_IMPROVEMENT",
  "solid_analysis": {
    "single_responsibility": {
      "status": "warn",
      "notes": "Component handles both UI and data fetching",
      "violations": [{"file": "Component.tsx", "line": 45}]
    },
    "open_closed": {"status": "pass", "notes": "Uses composition appropriately"},
    "liskov_substitution": {"status": "pass", "notes": "N/A - no inheritance"},
    "interface_segregation": {"status": "pass", "notes": "Interfaces are focused"},
    "dependency_inversion": {"status": "fail", "notes": "Direct service instantiation"}
  },
  "coupling_score": "medium",
  "cohesion_score": "high",
  "findings": [
    {
      "severity": "high",
      "principle": "DIP",
      "file": "src/.../Component.tsx",
      "line": 12,
      "issue": "Direct instantiation of FileService",
      "impact": "Cannot mock in tests, tight coupling",
      "recommendation": "Inject service via context or props"
    }
  ],
  "critical_issues": [],
  "recommendations": [
    "Extract data fetching logic to custom hook",
    "Consider using factory pattern for service creation"
  ],
  "technical_debt": [
    "Mixed concerns in Component.tsx - tracked for future refactor"
  ]
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] All files_changed have been analyzed
- [ ] assessment status is determined
- [ ] All 5 SOLID principles evaluated
- [ ] coupling_score and cohesion_score assigned
- [ ] findings categorized by severity
- [ ] critical_issues extracted from findings

### Assessment Logic

- `SOUND`: No critical issues, max 2 high severity issues
- `NEEDS_IMPROVEMENT`: Has high severity issues OR multiple medium issues
- `ARCHITECTURAL_ISSUES`: Has critical issues

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 800 tokens |
| Maximum | 1200 tokens |

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| File not found | Skip file, note in findings |
| Too many files (>15) | Focus on new/heavily modified files |
| Complex inheritance | Document, recommend expert review |
| Unclear architecture | Note ambiguity, recommend team discussion |

---

## Example

**Input:**
```json
{
  "issue_number": 11,
  "files_changed": [
    "src/renderer/src/components/Tabs/EditorTab.tsx",
    "src/renderer/src/components/Tabs/EditorTab.css",
    "src/renderer/src/components/AppDockLayout.tsx"
  ],
  "implementation_plan": {"overview": "Chrome-style tabs"},
  "tier": 2
}
```

**Execution:**
```
Read(file_path="src/.../EditorTab.tsx")
→ Component handles rendering, state, context menu

Grep(pattern="import.*from", path="src/.../EditorTab.tsx")
→ 5 imports, all from same layer (renderer)

Grep(pattern="new [A-Z]", path="src/.../EditorTab.tsx")
→ No direct instantiation

→ Analyze SOLID, coupling, cohesion
```

**Output:**
```json
{
  "assessment": "SOUND",
  "solid_analysis": {
    "single_responsibility": {"status": "pass", "notes": "Tab rendering only"},
    "open_closed": {"status": "pass", "notes": "Props-based customization"},
    "liskov_substitution": {"status": "pass", "notes": "N/A"},
    "interface_segregation": {"status": "pass", "notes": "Minimal props interface"},
    "dependency_inversion": {"status": "pass", "notes": "Uses context for services"}
  },
  "coupling_score": "low",
  "cohesion_score": "high",
  "findings": [
    {
      "severity": "low",
      "principle": "SRP",
      "file": "EditorTab.tsx",
      "line": 85,
      "issue": "Context menu logic could be extracted",
      "impact": "Minor - component still focused",
      "recommendation": "Consider useContextMenu hook for reuse"
    }
  ],
  "critical_issues": [],
  "recommendations": ["Consider extracting context menu to reusable hook"],
  "technical_debt": []
}
```

# Code Review Standards 2025

Comprehensive code review standards for Electron, Node.js, React, and TypeScript projects.

**Version:** 1.0.0
**Last Updated:** 2025-12-04
**Applies To:** All operations that modify files

---

## MANDATORY ENFORCEMENT

**This reference is NOT optional. ALL file-modifying operations MUST complete these reviews.**

| Review Type | Gate | Can Override |
|-------------|------|--------------|
| Security Review | QG-6 | **NO** |
| Architecture Review | QG-5 | Tier 2 only |
| Quality Review | QG-7 | Tier 2 only |
| Comprehensive Review | QG-7 | **NO** for critical issues |

---

## 1. General Code Review Standards

### 1.1 Process standards

| Metric | Threshold | Action |
|--------|-----------|--------|
| PR size | 200-400 lines max | Split larger PRs |
| Review time | 1-5 hours response | Block if exceeded |
| Inspection rate | 150-500 LOC/hour | Slow down if faster |
| Files per review | ≤20 files | Split if larger |

### 1.2 Feedback labels

**MANDATORY: Use these prefixes for all findings:**

| Prefix | Meaning | Blocking |
|--------|---------|----------|
| `Blocker:` | Must fix before merge | YES |
| `Critical:` | Security/data issue | YES |
| `High:` | Should fix before merge | YES (Tier 2) |
| `Medium:` | Should fix, can document | NO |
| `Low:` | Optional improvement | NO |
| `Nit:` | Style/preference | NO |

### 1.3 Review focus areas (Google standard)

1. **Design** - Does it integrate well with the system?
2. **Functionality** - Does it work correctly for users?
3. **Complexity** - Can another developer understand it?
4. **Tests** - Correct, well-designed, comprehensive?
5. **Naming** - Clear, consistent, meaningful?
6. **Comments** - Explain "why", not "what"?
7. **Style** - Follows established conventions?
8. **Documentation** - Updated where needed?

---

## 2. Electron Security Checklist

### 2.1 webPreferences validation (MANDATORY)

**STOP if ANY of these are misconfigured:**

```javascript
// REQUIRED SECURE CONFIGURATION
webPreferences: {
  nodeIntegration: false,           // MUST be false
  contextIsolation: true,           // MUST be true
  sandbox: true,                    // SHOULD be true
  webSecurity: true,                // MUST be true
  allowRunningInsecureContent: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,                // Unless explicitly needed
  enableRemoteModule: false,        // Deprecated
}
```

**Detection pattern:**
```
Grep(pattern="nodeIntegration:\\s*true", path="src/main/")
Grep(pattern="contextIsolation:\\s*false", path="src/main/")
Grep(pattern="webSecurity:\\s*false", path="src/main/")
```

### 2.2 Electron fuses validation

| Fuse | Required State | Purpose |
|------|----------------|---------|
| RunAsNode | false | Prevents ELECTRON_RUN_AS_NODE attacks |
| EnableNodeOptionsEnvironmentVariable | false | Blocks NODE_OPTIONS injection |
| EnableNodeCliInspectArguments | false | Disables --inspect flag |

### 2.3 IPC security

**CRITICAL - Always validate:**

```typescript
// ❌ BAD: No sender validation
ipcMain.on('sensitive-action', (event, data) => {
  doSensitiveAction(data);
});

// ✅ GOOD: Validate sender
ipcMain.on('sensitive-action', (event, data) => {
  if (event.senderFrame.url !== expectedUrl) return;
  if (!validateData(data)) return;
  doSensitiveAction(data);
});
```

**Detection patterns:**
```
Grep(pattern="ipcMain\\.on|ipcMain\\.handle", path="src/main/")
→ Verify each handler validates event.sender or event.senderFrame
```

### 2.4 Dangerous patterns to flag

| Pattern | Risk | Severity |
|---------|------|----------|
| `shell.openExternal` with user input | Command injection | CRITICAL |
| `eval()` or `new Function()` | Code injection | CRITICAL |
| `innerHTML` with untrusted data | XSS | HIGH |
| `child_process.exec` with variables | Command injection | CRITICAL |
| Disabled certificate validation | MITM attacks | HIGH |

---

## 3. Node.js Code Review Checklist

### 3.1 Code quality

| Check | Pattern | Severity |
|-------|---------|----------|
| No `var` usage | `Grep(pattern="\\bvar\\s")` | Medium |
| Prefer `const` | Variables that aren't reassigned | Low |
| ES Modules | `import/export` vs `require` | Low |
| Naming conventions | camelCase functions, PascalCase classes | Medium |

### 3.2 Security

| Check | Detection | Severity |
|-------|-----------|----------|
| No hardcoded secrets | `Grep(pattern="api[_-]?key|secret|password|token")` | CRITICAL |
| Input validation | Boundary checks present | HIGH |
| SQL injection | Parameterized queries used | CRITICAL |
| Path traversal | `path.resolve` + validation | HIGH |
| Command injection | No `exec` with user input | CRITICAL |

### 3.3 Async/await patterns

**REQUIRED patterns:**

```typescript
// ✅ GOOD: Proper error handling
async function fetchData(): Promise<Data> {
  try {
    const result = await api.get('/data');
    return result;
  } catch (error) {
    logger.error('Fetch failed', { error });
    throw new AppError('DATA_FETCH_FAILED', error);
  }
}

// ✅ GOOD: Concurrent operations
const [users, posts] = await Promise.all([
  fetchUsers(),
  fetchPosts()
]);

// ❌ BAD: Unhandled rejection
await api.get('/data'); // No try/catch!

// ❌ BAD: Sequential when parallel possible
const users = await fetchUsers();
const posts = await fetchPosts(); // Could run in parallel
```

### 3.4 Performance

| Issue | Detection | Severity |
|-------|-----------|----------|
| O(n²) loops | Nested loops on arrays | HIGH |
| Blocking event loop | Sync operations in async context | HIGH |
| Memory leaks | Unclosed resources, growing arrays | HIGH |
| Missing cleanup | Event listeners not removed | MEDIUM |

### 3.5 Dependencies

| Check | Tool/Command | Threshold |
|-------|--------------|-----------|
| Security audit | `npm audit` | 0 high/critical |
| License compatibility | Check package.json | MIT/Apache OK, AGPL flag |
| Bundle size | `size-limit` | Project-specific |
| Outdated packages | `npm outdated` | Review major versions |

---

## 4. React Code Review Checklist

### 4.1 Component design

| Principle | Check | Severity |
|-----------|-------|----------|
| Single Responsibility | Component does one thing | HIGH |
| Small components | < 200 lines preferred | MEDIUM |
| Props interface | Well-typed, documented | MEDIUM |
| Error boundaries | Present at key points | HIGH |

### 4.2 Hooks rules

```typescript
// ✅ GOOD: Proper dependency array
useEffect(() => {
  fetchData(id);
}, [id]);

// ❌ BAD: Missing dependency
useEffect(() => {
  fetchData(id);
}, []); // Missing 'id'

// ❌ BAD: Conditional hook call
if (condition) {
  useState(); // NEVER conditional hooks
}
```

### 4.3 Performance optimization

| Hook | When to Use | When NOT to Use |
|------|-------------|-----------------|
| `React.memo` | Expensive re-renders with same props | Simple components |
| `useMemo` | Expensive calculations | Simple values |
| `useCallback` | Callbacks passed to memoized children | Not passed down |

**Detection:**
```
Grep(pattern="React\\.memo|useMemo|useCallback", path="src/renderer/")
→ Verify each usage is justified
```

### 4.4 Security

| Issue | Detection | Severity |
|-------|-----------|----------|
| `dangerouslySetInnerHTML` | Direct grep | CRITICAL if unsanitized |
| XSS vectors | User input in JSX | HIGH |
| Exposed secrets | Environment variables in client | CRITICAL |

### 4.5 Anti-patterns

| Pattern | Problem | Fix |
|---------|---------|-----|
| Prop drilling > 3 levels | Maintenance nightmare | Use Context |
| Inline object/array props | Causes re-renders | Extract to constant or useMemo |
| Inline function props | New reference each render | useCallback |
| Missing key prop | Incorrect reconciliation | Add unique key |
| Index as key | Poor performance on reorder | Use stable ID |

---

## 5. TypeScript Code Review Checklist

### 5.1 Type safety

| Rule | Check | Severity |
|------|-------|----------|
| No `any` | `Grep(pattern=": any")` | HIGH |
| No `as` assertions | `Grep(pattern="as [A-Z]")` | MEDIUM |
| Strict mode enabled | tsconfig.json | HIGH |
| No `!` non-null | `Grep(pattern="!\\.")` | MEDIUM |

### 5.2 Configuration requirements

```jsonc
// tsconfig.json - REQUIRED settings
{
  "compilerOptions": {
    "strict": true,              // MANDATORY
    "strictNullChecks": true,    // MANDATORY
    "noImplicitAny": true,       // MANDATORY
    "noUncheckedIndexedAccess": true  // RECOMMENDED
  }
}
```

### 5.3 Type patterns

**GOOD patterns:**
```typescript
// ✅ Explicit return types on public APIs
function calculateTotal(items: Item[]): number { }

// ✅ Union types for states
type Status = 'loading' | 'success' | 'error';

// ✅ Generic constraints
function process<T extends BaseType>(item: T): T { }

// ✅ Discriminated unions
type Result =
  | { status: 'success'; data: Data }
  | { status: 'error'; error: Error };
```

**BAD patterns:**
```typescript
// ❌ any defeats TypeScript purpose
function process(data: any): any { }

// ❌ Type assertion without validation
const data = response as UserData;

// ❌ Non-null assertion hides bugs
const name = user!.profile!.name;
```

### 5.4 API boundaries

**MANDATORY: Validate at system boundaries:**

```typescript
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
});

// ✅ GOOD: Runtime validation at boundary
function handleApiResponse(response: unknown): User {
  return UserSchema.parse(response);
}

// ❌ BAD: Trust external data
function handleApiResponse(response: User): User {
  return response; // What if API changed?
}
```

---

## 6. SOLID Principles Checklist

### 6.1 Single Responsibility Principle (SRP)

**Question:** Does this class/module have only ONE reason to change?

| Violation | Detection | Severity |
|-----------|-----------|----------|
| Class > 300 lines | Line count | HIGH |
| Multiple unrelated imports | Import analysis | MEDIUM |
| "Manager/Handler/Processor" names | Naming | MEDIUM |
| Methods that don't use class state | Static candidates | LOW |

**Detection pattern:**
```
# Count lines per file
wc -l src/**/*.ts | sort -n

# Check for mixed concerns
Grep(pattern="import.*from.*(api|store|service)", path="<component>")
→ Flag if component imports from multiple layers
```

### 6.2 Open/Closed Principle (OCP)

**Question:** Can new behavior be added WITHOUT modifying existing code?

| Violation | Detection | Severity |
|-----------|-----------|----------|
| Growing switch statements | `Grep(pattern="switch.*type")` | HIGH |
| Multiple if/else on type | `Grep(pattern="if.*typeof")` | HIGH |
| Hardcoded lists that grow | Manual review | MEDIUM |

**Fix pattern:**
```typescript
// ❌ BAD: Violates OCP
function getIcon(type: string) {
  switch(type) {
    case 'file': return FileIcon;
    case 'folder': return FolderIcon;
    // Must modify to add new type
  }
}

// ✅ GOOD: Open for extension
const iconMap: Record<string, IconComponent> = {
  file: FileIcon,
  folder: FolderIcon,
};
function getIcon(type: string) {
  return iconMap[type] ?? DefaultIcon;
}
```

### 6.3 Liskov Substitution Principle (LSP)

**Question:** Can subclasses be used interchangeably with their base class?

| Violation | Detection | Severity |
|-----------|-----------|----------|
| Methods throwing "not implemented" | `Grep(pattern="not implemented")` | HIGH |
| Type checks after interface use | `Grep(pattern="instanceof")` | MEDIUM |
| Overrides with different behavior | Manual review | HIGH |

### 6.4 Interface Segregation Principle (ISP)

**Question:** Are interfaces focused and minimal?

| Violation | Detection | Severity |
|-----------|-----------|----------|
| Interface > 7 methods | Interface analysis | MEDIUM |
| Optional methods (?) | `Grep(pattern="\\?:")` in interfaces | LOW |
| Empty method implementations | Manual review | HIGH |

### 6.5 Dependency Inversion Principle (DIP)

**Question:** Do high-level modules depend on abstractions?

| Violation | Detection | Severity |
|-----------|-----------|----------|
| Direct instantiation | `Grep(pattern="new [A-Z]")` | MEDIUM |
| Concrete imports across layers | Import analysis | HIGH |
| Global singletons | `Grep(pattern="getInstance")` | MEDIUM |

**Detection pattern:**
```
# Check for concrete dependencies
Grep(pattern="import.*Service|import.*Repository", path="src/renderer/")
→ Should import interfaces, not implementations
```

---

## 7. Code Smells Detection

### 7.1 Class-level smells

| Smell | Detection | Threshold | Severity |
|-------|-----------|-----------|----------|
| God Class | Lines + methods | >500 lines OR >15 methods | CRITICAL |
| Large Class | Lines | >300 lines | HIGH |
| Data Class | Only getters/setters | No behavior methods | MEDIUM |
| Lazy Class | Too little functionality | <50 lines, 1-2 methods | LOW |
| Refused Bequest | Unused inheritance | Override with empty | MEDIUM |

### 7.2 Method-level smells

| Smell | Detection | Threshold | Severity |
|-------|-----------|-----------|----------|
| Long Method | Line count | >50 lines | HIGH |
| Long Parameter List | Param count | >5 parameters | HIGH |
| Feature Envy | External references | Uses other class more than own | MEDIUM |
| Message Chains | Chained calls | a.b.c.d.method() | MEDIUM |

### 7.3 Code-level smells

| Smell | Detection | Threshold | Severity |
|-------|-----------|-----------|----------|
| Magic Numbers | Literals in logic | Non-obvious numbers | MEDIUM |
| Dead Code | Unused exports | 0 references | MEDIUM |
| Duplicate Code | Clone detection | >10 lines similar | HIGH |
| Speculative Generality | Unused abstractions | No implementations | LOW |

---

## 8. Complexity Metrics

### 8.1 Cyclomatic complexity

| Score | Rating | Action |
|-------|--------|--------|
| 1-5 | Simple | OK |
| 6-10 | Moderate | Review |
| 11-15 | Complex | Justify |
| 16-20 | High | Consider split |
| 21+ | Very High | MUST refactor |

**Threshold:** Maximum 15 per function (Tier 2), 20 (Tier 1)

### 8.2 Cognitive complexity

Measures human understandability. Penalizes nesting more than sequential code.

**Threshold:** Maximum 15 per function

### 8.3 Coupling metrics

| Metric | Target | Action if Exceeded |
|--------|--------|-------------------|
| Afferent coupling (incoming) | <10 | Review stability |
| Efferent coupling (outgoing) | <10 | Review dependencies |
| Class coupling (CBO) | ≤9 | Flag for refactor |

### 8.4 Cohesion metrics

| LCOM4 Score | Meaning | Action |
|-------------|---------|--------|
| 1 | High cohesion | OK |
| 2-3 | Moderate | Review |
| 4+ | Low cohesion | Split class |

---

## 9. Test Coverage Requirements

### 9.1 Coverage thresholds

| Metric | Tier 1 | Tier 2 | Blocking |
|--------|--------|--------|----------|
| Line coverage | ≥70% | ≥80% | YES |
| Branch coverage | ≥60% | ≥70% | YES |
| Function coverage | ≥70% | ≥80% | NO |

### 9.2 Test quality checks

| Check | Requirement | Severity |
|-------|-------------|----------|
| Acceptance criteria covered | 100% | HIGH |
| Edge cases tested | Critical paths | HIGH |
| Error paths tested | All catch blocks | MEDIUM |
| No flaky tests | Deterministic | HIGH |
| Mocks properly typed | Real types, not Partial | MEDIUM |

---

## 10. Documentation Requirements

### 10.1 Required documentation

| Item | When Required | Format |
|------|---------------|--------|
| Public API | Always | JSDoc/TSDoc |
| Complex logic | Cyclomatic > 10 | Inline comments |
| Non-obvious decisions | Always | "Why" comments |
| Breaking changes | API changes | CHANGELOG |

### 10.2 Comment quality

**GOOD comments explain WHY:**
```typescript
// Batch size of 100 chosen based on API rate limits
// and memory constraints on mobile devices
const BATCH_SIZE = 100;
```

**BAD comments explain WHAT:**
```typescript
// Set batch size to 100
const BATCH_SIZE = 100; // Redundant!
```

---

## 11. Review Severity Matrix

### 11.1 Severity definitions

| Severity | Definition | Response Time | Blocking |
|----------|------------|---------------|----------|
| CRITICAL | Security vulnerability, data loss risk | Immediate | YES |
| HIGH | Functionality broken, major quality issue | Same day | YES (Tier 2) |
| MEDIUM | Quality concern, should address | This sprint | NO |
| LOW | Improvement suggestion | Backlog | NO |

### 11.2 Severity by category

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Security | Injection, secrets exposed | Missing validation | Weak validation | Best practice |
| Performance | Memory leak, infinite loop | O(n²) on large data | Unnecessary renders | Minor optimization |
| Architecture | Circular dependency | SOLID violation | Coupling concern | Style preference |
| Testing | No tests for critical path | Coverage < threshold | Missing edge case | Test organization |
| TypeScript | Unsafe `any` with user data | `any` usage | Missing types | Type refinement |

---

## 12. Automated Checks

### 12.1 Pre-commit (MANDATORY)

```bash
# Must pass before commit
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test        # Unit tests
```

### 12.2 CI pipeline (MANDATORY)

| Check | Tool | Threshold |
|-------|------|-----------|
| Lint | ESLint | 0 errors |
| Types | TypeScript | 0 errors |
| Tests | Vitest | 100% pass |
| Coverage | v8 | Per-tier thresholds |
| Security | npm audit | 0 high/critical |
| Bundle | size-limit | Project-specific |

### 12.3 Static analysis tools

| Tool | Purpose | Integration |
|------|---------|-------------|
| ESLint | Code quality | Pre-commit, CI |
| TypeScript | Type safety | Pre-commit, CI |
| SonarQube | Complexity, smells | CI |
| npm audit | Dependencies | CI |

---

## 13. Review Workflow

### 13.1 Before requesting review

**Author checklist:**
- [ ] Self-reviewed changes
- [ ] Tests pass locally
- [ ] Lint/typecheck clean
- [ ] Coverage meets threshold
- [ ] Documentation updated
- [ ] No `console.log` or debug code

### 13.2 During review

**Reviewer checklist:**
- [ ] Read context (issue, plan)
- [ ] Understand the change
- [ ] Check security concerns
- [ ] Verify tests adequate
- [ ] Review architecture
- [ ] Check documentation

### 13.3 After review

**Resolution requirements:**
- All CRITICAL/HIGH issues resolved
- MEDIUM issues addressed or documented
- LOW issues acknowledged

---

## Sources

- [Google Engineering Practices](https://google.github.io/eng-practices/review/)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [React Code Review Checklist](https://pagepro.co/blog/18-tips-for-a-better-react-code-review-ts-js/)
- [TypeScript Best Practices 2025](https://dev.to/mitu_mariam/typescript-best-practices-in-2025-57hb)
- [SOLID Principles](https://blog.jetbrains.com/upsource/2015/08/31/what-to-look-for-in-a-code-review-solid-principles-2/)
- [Code Smells Detection](https://blog.codacy.com/code-smells-and-anti-patterns)
- [Clean Code by Robert C. Martin](https://gist.github.com/wojteklu/73c6914cc446146b8b533c0988cf8d29)

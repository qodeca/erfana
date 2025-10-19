## Critical Issues (P0 - Immediate Action Required)

### ISSUE-1: 🔴 Dangerously Low Test Coverage

**Severity:** CRITICAL
**Priority:** P0
**Impact:** High risk of regressions, difficult to refactor safely
**Effort:** 2-3 weeks

**Evidence:**
- Only **19 test files** across entire 9,964-line codebase
- Coverage thresholds artificially set to **10%** to avoid blocking builds
- Core services lack unit tests:
  - FileWatcherService.test.ts: **47 lines** (minimal coverage)
  - DirectoryWatcherService.test.ts: **98 lines** (basic coverage)
  - TerminalService.test.ts: **63 lines** (basic coverage)
- Zero integration tests for IPC communication
- Zero E2E tests with Playwright
- Critical logic untested:
  - Session token guards
  - Pause/resume race prevention
  - Watcher cleanup on ENOENT
  - Terminal cwd verification

**Files Affected:**
- `/Users/marcinobel/Projects/erfana/src/main/services/*` - Incomplete test coverage
- `/Users/marcinobel/Projects/erfana/src/main/ipc/*` - No IPC contract tests
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/*` - Minimal component tests

**Risks:**
1. Session token guard logic could break silently
2. Race conditions during project switching unverified
3. Watcher cleanup failures could cause memory leaks
4. Terminal functionality fragile without tests
5. Cannot safely refactor without breaking changes

**Recommendations:**

1. **Increase coverage targets** (immediate):
   ```json
   // vitest.config.ts
   coverage: {
     thresholds: {
       main: { lines: 60, functions: 60, branches: 55 },
       renderer: { lines: 50, functions: 50, branches: 45 },
       preload: { lines: 70, functions: 70, branches: 65 }
     }
   }
   ```

2. **Add service layer tests** (Week 1-2):
   - FileWatcherService: Session guards, pause/resume, debouncing
   - DirectoryWatcherService: Bulk detection, ignored patterns, ENOENT
   - TerminalService: PTY lifecycle, cwd verification, cleanup

3. **Add IPC contract tests** (Week 2):
   ```typescript
   describe('IPC Contracts', () => {
     test('project:changed payload matches schema', () => {
       const payload = { oldPath: '/old', newPath: '/new' }
       expect(() => ProjectChangedSchema.parse(payload)).not.toThrow()
     })
   })
   ```

4. **Add E2E tests with Playwright** (Week 3):
   - Project open/switch with dirty editors
   - File watching + external changes
   - Terminal creation + command execution
   - Multi-file tabs workflow

5. **Add integration tests** (Week 3):
   - File creation → watcher notification → tree update
   - Project switch → cleanup → new watchers
   - Save with pause/resume → no double-refresh

**Success Criteria:**
- Coverage >60% for main process
- All critical paths tested
- CI fails on coverage drop
- E2E tests for top 5 user flows

---

### ISSUE-2: 🔴 Path Traversal Vulnerability

**Severity:** CRITICAL
**Priority:** P0
**Impact:** Security vulnerability - unauthorized file system access
**Effort:** 2 days

**Evidence:**

Current validation is insufficient:

```typescript
// FileService.ts:149-152
if (this.projectPath && !filePath.startsWith(this.projectPath)) {
  throw new Error('Cannot delete files outside the project directory')
}
```

**Vulnerabilities:**

1. **Path traversal bypass:**
   ```typescript
   // Attacker could exploit via IPC:
   window.api.file.readFile('/project/../../../etc/passwd')
   // Passes startsWith check but reads system files
   ```

2. **No symlink resolution** before boundary check
3. **No validation** of special characters in file names
4. **Missing checks** for reserved filenames (Windows: CON, PRN, AUX, NUL)
5. **No rate limiting** on IPC handlers (DoS risk)
6. **Terminal cwd verification** trusts shell output without validation

**Files Affected:**
- `/Users/marcinobel/Projects/erfana/src/main/services/FileService.ts:29-220`
- `/Users/marcinobel/Projects/erfana/src/main/ipc/file-handlers.ts`
- `/Users/marcinobel/Projects/erfana/src/main/services/TerminalService.ts:172-234`

**Attack Scenarios:**

1. **Read sensitive files:**
   ```typescript
   await window.api.file.readFile('/project/../../../etc/passwd')
   ```

2. **Write to system directories:**
   ```typescript
   await window.api.file.writeFile('/project/../../usr/local/bin/malware', code)
   ```

3. **Delete critical files:**
   ```typescript
   await window.api.file.deleteFile('/project/../../../important.db')
   ```

**Recommendations:**

1. **Create comprehensive path validation utility** (Day 1):
   ```typescript
   // src/main/utils/path-validator.ts
   import { realpath } from 'fs/promises'
   import { normalize, resolve, sep } from 'path'

   export class PathValidator {
     private static readonly RESERVED_NAMES = new Set([
       'CON', 'PRN', 'AUX', 'NUL',
       'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
       'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
     ])

     private static readonly FORBIDDEN_CHARS = /[<>:"|?*\x00-\x1f]/g

     static async validatePath(path: string, projectRoot: string): Promise<void> {
       // 1. Normalize and resolve paths
       const normalizedPath = normalize(resolve(path))
       const normalizedRoot = normalize(resolve(projectRoot))

       // 2. Resolve symlinks
       let realPath: string
       let realRoot: string
       try {
         realPath = await realpath(normalizedPath)
         realRoot = await realpath(normalizedRoot)
       } catch (error) {
         // Path doesn't exist yet (e.g., creating new file)
         realPath = normalizedPath
         realRoot = normalizedRoot
       }

       // 3. Check containment (must start with root)
       if (!realPath.startsWith(realRoot + sep) && realPath !== realRoot) {
         throw new Error(`Path outside project boundary: ${path}`)
       }

       // 4. Check for path traversal patterns
       if (path.includes('..')) {
         throw new Error(`Path traversal detected: ${path}`)
       }

       // 5. Validate no forbidden characters
       if (this.FORBIDDEN_CHARS.test(path)) {
         throw new Error(`Invalid characters in path: ${path}`)
       }

       // 6. Check for reserved names (Windows)
       if (process.platform === 'win32') {
         const basename = path.split(/[\\/]/).pop()?.toUpperCase() || ''
         if (this.RESERVED_NAMES.has(basename)) {
           throw new Error(`Reserved filename: ${basename}`)
         }
       }

       // 7. Check for null bytes (security)
       if (path.includes('\0')) {
         throw new Error('Null byte in path')
       }
     }
   }
   ```

2. **Apply validation to all file operations** (Day 1):
   ```typescript
   // FileService.ts
   async readFile(filePath: string): Promise<string> {
     await PathValidator.validatePath(filePath, this.projectPath!)
     return await fs.readFile(filePath, 'utf-8')
   }
   ```

3. **Add rate limiting** (Day 2):
   ```typescript
   // src/main/utils/rate-limiter.ts
   export class RateLimiter {
     private readonly requests = new Map<string, number[]>()

     async checkLimit(
       key: string,
       maxRequests: number,
       windowMs: number
     ): Promise<void> {
       const now = Date.now()
       const requests = this.requests.get(key) || []

       // Remove old requests outside window
       const recent = requests.filter(time => now - time < windowMs)

       if (recent.length >= maxRequests) {
         throw new Error('Rate limit exceeded')
       }

       recent.push(now)
       this.requests.set(key, recent)
     }
   }

   // Usage in IPC handlers:
   const limiter = new RateLimiter()

   ipcMain.handle('file:readFile', async (event, path: string) => {
     await limiter.checkLimit('readFile', 100, 1000) // 100 req/sec
     // ... rest of handler
   })
   ```

4. **Sanitize terminal output** (Day 2):
   ```typescript
   private sanitizeCwd(output: string): string {
     // Remove ANSI escape codes
     const clean = output.replace(/\x1b\[[0-9;]*m/g, '')

     // Validate looks like a path
     if (!/^[a-zA-Z0-9\/_\-\.~]+$/.test(clean)) {
       throw new Error('Invalid cwd format')
     }

     return clean
   }
   ```

**Testing:**
```typescript
describe('PathValidator', () => {
  test('blocks path traversal', async () => {
    await expect(
      PathValidator.validatePath('/project/../etc/passwd', '/project')
    ).rejects.toThrow('Path traversal detected')
  })

  test('blocks paths outside root', async () => {
    await expect(
      PathValidator.validatePath('/other/file.txt', '/project')
    ).rejects.toThrow('Path outside project boundary')
  })

  test('allows valid paths', async () => {
    await expect(
      PathValidator.validatePath('/project/sub/file.txt', '/project')
    ).resolves.not.toThrow()
  })
})
```

**Success Criteria:**
- All file operations validate paths
- Path traversal attacks blocked
- Rate limiting prevents DoS
- Terminal output sanitized
- Tests cover attack vectors

---

### ISSUE-3: 🔴 Type Safety Violations Throughout Codebase

**Severity:** CRITICAL
**Priority:** P0
**Impact:** Runtime errors, difficult debugging, loss of TypeScript benefits
**Effort:** 2 days

**Evidence:**

**Problem 1: SettingsService uses `unknown` and type casting**

```typescript
// SettingsService.ts:35-37
const ElectronStore = module.default as unknown as new <S>(
  options?: unknown  // ❌ BAD: Should be properly typed
) => StoreLike<S>
```

**Problem 2: DockviewApi type casting gymnastics**

```typescript
// useProjectStore.ts:39-41
const panel = api.getPanel(id) as unknown as {
  api?: { close?: () => void }
} | null
// ❌ BAD: Should use proper Dockview types
```

**Problem 3: Error handling with unknown types**

```typescript
// FileService.ts:102
const code = (error as { code?: unknown }).code
// ❌ Should be: NodeJS.ErrnoException
```

**Problem 4: any types in tests**

```typescript
// Multiple test files use `any` for mocks
const mockApi: any = { getPanel: vi.fn() }
```

**Files Affected:**
- `/Users/marcinobel/Projects/erfana/src/main/services/SettingsService.ts:35-37`
- `/Users/marcinobel/Projects/erfana/src/renderer/src/stores/useProjectStore.ts:39-41`
- `/Users/marcinobel/Projects/erfana/src/main/services/FileService.ts:102`
- `/Users/marcinobel/Projects/erfana/src/renderer/src/utils/panelUtils.ts` (multiple `unknown`)

**Impact:**
1. Loss of compile-time type checking
2. Runtime errors not caught during development
3. Poor IDE autocomplete and IntelliSense
4. Difficult refactoring (no type safety net)
5. Hidden bugs from type mismatches

**Recommendations:**

1. **Fix SettingsService types** (2 hours):
   ```typescript
   // Option A: Use type definitions
   import type Store from 'electron-store'

   type StoreLike<T> = Pick<Store<T>, 'get' | 'set' | 'delete'>

   private store: StoreLike<Settings> | null
   private storePromise: Promise<StoreLike<Settings>>

   constructor() {
     this.store = null
     this.storePromise = import('electron-store').then((module) => {
       const ElectronStore = module.default as typeof Store
       const instance = new ElectronStore<Settings>({
         name: 'erfana-settings'
       })
       this.store = instance
       return instance
     })
   }
   ```

2. **Fix Dockview types** (2 hours):
   ```typescript
   // Import proper types from dockview
   import type { IDockviewPanel } from 'dockview'

   // In useProjectStore.ts
   const panel = api.getPanel(id) as IDockviewPanel | undefined
   if (panel?.api) {
     panel.api.close()
   }
   ```

3. **Create error type guards** (2 hours):
   ```typescript
   // src/main/utils/type-guards.ts
   export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
     return (
       error instanceof Error &&
       'code' in error &&
       typeof (error as any).code === 'string'
     )
   }

   export function isSystemError(error: unknown): error is SystemError {
     return (
       isNodeError(error) &&
       'errno' in error &&
       'syscall' in error
     )
   }

   // Usage:
   try {
     await fs.readFile(path)
   } catch (error) {
     if (isNodeError(error) && error.code === 'ENOENT') {
       // Type-safe error handling
     }
   }
   ```

4. **Add strict null checks** (4 hours):
   ```typescript
   // Enable in tsconfig.json
   {
     "compilerOptions": {
       "strict": true,
       "strictNullChecks": true,
       "noImplicitAny": true,
       "strictFunctionTypes": true
     }
   }
   ```

5. **Create Dockview type definitions** (2 hours):
   ```typescript
   // src/types/dockview.d.ts
   import { IDockviewPanel } from 'dockview'

   declare module 'dockview' {
     interface IDockviewPanel {
       api: {
         close: () => void
         setActive: () => void
         // ... other methods
       }
     }
   }
   ```

**Testing:**
```typescript
describe('Type Guards', () => {
  test('isNodeError identifies Node errors', () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException
    error.code = 'ENOENT'

    expect(isNodeError(error)).toBe(true)

    if (isNodeError(error)) {
      // TypeScript knows error.code exists
      expect(error.code).toBe('ENOENT')
    }
  })
})
```

**Success Criteria:**
- Zero `any` types in production code
- Zero `unknown` without type guards
- All error handling uses type guards
- IDE autocomplete works everywhere
- No runtime type errors

---

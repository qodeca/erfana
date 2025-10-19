### ISSUE-7: 🟠 No Monitoring or Observability

**Severity:** HIGH
**Priority:** P1
**Impact:** Cannot diagnose production issues, no visibility into performance
**Effort:** 1 day

**Evidence:**

**Missing Capabilities:**
- No error tracking (Sentry, Bugsnag, Rollbar)
- No performance monitoring
- No usage analytics
- No crash reporting
- Console.log only (lost after app close)
- No structured logging
- No metrics collection

**Current State:**
```typescript
// src/main/services/*.ts - Only console.log
console.log('👁️  Starting watch for:', filePath)
console.error('❌ Failed to create terminal:', error)
```

**Impact:**
1. Cannot diagnose production crashes
2. No visibility into error frequency
3. Cannot track performance regressions
4. No usage data for prioritization
5. Support tickets hard to debug

**Recommendations:**

1. **Add Sentry error tracking** (3 hours):
   ```typescript
   // src/main/index.ts
   import * as Sentry from '@sentry/electron/main'

   Sentry.init({
     dsn: process.env.SENTRY_DSN,
     environment: app.isPackaged ? 'production' : 'development',
     release: app.getVersion(),
     beforeSend(event) {
       // Filter sensitive data
       if (event.request?.url) {
         event.request.url = '[REDACTED]'
       }
       return event
     }
   })

   // src/renderer/main.tsx
   import * as Sentry from '@sentry/electron/renderer'

   Sentry.init({
     dsn: process.env.SENTRY_DSN,
     integrations: [
       new Sentry.BrowserTracing(),
       new Sentry.Replay()
     ],
     tracesSampleRate: 0.1,
     replaysSessionSampleRate: 0.1,
     replaysOnErrorSampleRate: 1.0
   })
   ```

2. **Add structured logging** (2 hours):
   ```typescript
   // src/main/utils/logger.ts
   import winston from 'winston'
   import { app } from 'electron'
   import path from 'path'

   const logDir = app.getPath('userData')

   export const logger = winston.createLogger({
     level: process.env.LOG_LEVEL || 'info',
     format: winston.format.combine(
       winston.format.timestamp(),
       winston.format.errors({ stack: true }),
       winston.format.json()
     ),
     transports: [
       new winston.transports.File({
         filename: path.join(logDir, 'error.log'),
         level: 'error',
         maxsize: 10 * 1024 * 1024, // 10MB
         maxFiles: 5
       }),
       new winston.transports.File({
         filename: path.join(logDir, 'combined.log'),
         maxsize: 10 * 1024 * 1024,
         maxFiles: 5
       })
     ]
   })

   if (!app.isPackaged) {
     logger.add(new winston.transports.Console({
       format: winston.format.simple()
     }))
   }

   // Usage:
   logger.info('Watch started', { filePath, webContentsId })
   logger.error('Terminal creation failed', { error, config })
   ```

3. **Add performance monitoring** (2 hours):
   ```typescript
   // src/main/utils/metrics.ts
   export class MetricsCollector {
     private metrics = new Map<string, number[]>()

     recordTiming(name: string, durationMs: number): void {
       if (!this.metrics.has(name)) {
         this.metrics.set(name, [])
       }
       this.metrics.get(name)!.push(durationMs)
     }

     getStats(name: string): { avg: number; p50: number; p95: number; p99: number } {
       const values = this.metrics.get(name) || []
       if (values.length === 0) return { avg: 0, p50: 0, p95: 0, p99: 0 }

       const sorted = values.slice().sort((a, b) => a - b)
       const avg = values.reduce((a, b) => a + b) / values.length

       return {
         avg,
         p50: sorted[Math.floor(sorted.length * 0.5)],
         p95: sorted[Math.floor(sorted.length * 0.95)],
         p99: sorted[Math.floor(sorted.length * 0.99)]
       }
     }

     async reportMetrics(): Promise<void> {
       const report: Record<string, any> = {}

       for (const [name, _] of this.metrics) {
         report[name] = this.getStats(name)
       }

       logger.info('Performance metrics', report)

       // Send to monitoring service
       await Sentry.captureMessage('Performance Report', {
         level: 'info',
         extra: report
       })
     }
   }

   export const metrics = new MetricsCollector()

   // Usage:
   const start = performance.now()
   await fileService.readFile(path)
   metrics.recordTiming('file.read', performance.now() - start)
   ```

4. **Add IPC latency tracking** (1 hour):
   ```typescript
   // src/preload/index.ts
   const instrumentedApi = {
     file: {
       readFile: async (path: string) => {
         const start = performance.now()
         try {
           const result = await ipcRenderer.invoke('file:readFile', path)
           const duration = performance.now() - start

           ipcRenderer.send('metrics:ipc-latency', {
             channel: 'file:readFile',
             duration
           })

           return result
         } catch (error) {
           Sentry.captureException(error, {
             tags: { ipc_channel: 'file:readFile' }
           })
           throw error
         }
       }
     }
   }
   ```

**Success Criteria:**
- Sentry captures all production errors
- Structured logs written to files
- Performance metrics collected
- IPC latency tracked
- Crash reports sent automatically
- Can diagnose issues from logs alone

---

### ISSUE-8: 🟠 Watcher Resource Leaks

**Severity:** HIGH
**Priority:** P1
**Impact:** Memory leaks, degraded performance over time
**Effort:** 1 day

**Evidence:**

**Problem 1: No cleanup on webContents destruction**

```typescript
// file-watcher-handlers.ts - Missing cleanup
ipcMain.handle('file-watch:start', async (event, filePath: string) => {
  await fileWatcherService.watchFile(filePath, event.sender)
  // ❌ No event.sender.on('destroyed', cleanup)
})
```

**Problem 2: No max lifetime for watchers**

```typescript
// FileWatcherService.ts
private readonly MAX_WATCHED_FILES = 100  // ✅ Count limit
// ❌ No time-based cleanup
// ❌ No idle timeout
```

**Problem 3: Debounce timers not guaranteed to clear**

```typescript
// FileWatcherService.ts:34-39
async stopAll(): Promise<void> {
  for (const [, watched] of this.watchedFiles.entries()) {
    if (watched.debounceTimer) {
      clearTimeout(watched.debounceTimer)  // May be too late
    }
    await watched.watcher.close()
  }
}
```

**Files Affected:**
- `/Users/marcinobel/Projects/erfana/src/main/ipc/file-watcher-handlers.ts:16-31`
- `/Users/marcinobel/Projects/erfana/src/main/ipc/directory-watcher-handlers.ts:16-28`
- `/Users/marcinobel/Projects/erfana/src/main/services/FileWatcherService.ts`

**Impact:**
1. Memory grows unbounded over long sessions
2. Event listeners accumulate
3. Performance degrades
4. Eventually crashes with OOM

**Recommendations:**

1. **Add automatic cleanup on webContents destruction** (2 hours):
   ```typescript
   // file-watcher-handlers.ts
   ipcMain.handle('file-watch:start', async (event, filePath: string) => {
     // Track cleanup function
     const cleanup = () => {
       fileWatcherService.unwatchFile(filePath, event.sender)
     }

     // Register cleanup on webContents destruction
     event.sender.once('destroyed', cleanup)

     // Store cleanup function to prevent duplicate registrations
     if (!webContentsCleanup.has(event.sender.id)) {
       webContentsCleanup.set(event.sender.id, new Set())
     }
     webContentsCleanup.get(event.sender.id)!.add(cleanup)

     await fileWatcherService.watchFile(filePath, event.sender)
     return { success: true }
   })

   const webContentsCleanup = new Map<number, Set<() => void>>()
   ```

2. **Add idle timeout for watchers** (4 hours):
   ```typescript
   interface WatchedFile {
     filePath: string
     watcher: FSWatcher
     webContentsSet: Set<WebContents>
     debounceTimer: NodeJS.Timeout | null
     version: number
     lastActivity: Date  // NEW
     idleTimer: NodeJS.Timeout | null  // NEW
   }

   private readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000  // 30 minutes

   private resetIdleTimer(watched: WatchedFile): void {
     // Clear existing timer
     if (watched.idleTimer) {
       clearTimeout(watched.idleTimer)
     }

     // Update last activity
     watched.lastActivity = new Date()

     // Set new idle timer
     watched.idleTimer = setTimeout(() => {
       this.handleIdleTimeout(watched.filePath)
     }, this.IDLE_TIMEOUT_MS)
   }

   private handleIdleTimeout(filePath: string): void {
     const watched = this.watchedFiles.get(filePath)
     if (!watched) return

     logger.info('Closing idle watcher', {
       filePath,
       idleMinutes: (Date.now() - watched.lastActivity.getTime()) / 1000 / 60
     })

     // Close watcher
     watched.watcher.close()
     this.watchedFiles.delete(filePath)
   }

   private notifyChange(filePath: string): void {
     const watched = this.watchedFiles.get(filePath)
     if (!watched) return

     // Reset idle timer on activity
     this.resetIdleTimer(watched)

     // ... rest of notify logic
   }
   ```

3. **Add health check endpoint** (2 hours):
   ```typescript
   // Add IPC handler
   ipcMain.handle('debug:watcher-health', async () => {
     return {
       fileWatchers: fileWatcherService.getHealthCheck(),
       directoryWatchers: directoryWatcherService.getHealthCheck()
     }
   })

   // In FileWatcherService:
   getHealthCheck(): {
     totalWatchers: number
     watcherDetails: Array<{
       path: string
       webContents: number
       lastActivity: Date
       idleMinutes: number
     }>
   } {
     const details = Array.from(this.watchedFiles.entries()).map(([path, watched]) => ({
       path,
       webContents: watched.webContentsSet.size,
       lastActivity: watched.lastActivity,
       idleMinutes: (Date.now() - watched.lastActivity.getTime()) / 1000 / 60
     }))

     return {
       totalWatchers: this.watchedFiles.size,
       watcherDetails: details
     }
   }
   ```

4. **Add memory monitoring** (2 hours):
   ```typescript
   // src/main/utils/memory-monitor.ts
   import { app } from 'electron'

   export class MemoryMonitor {
     private interval: NodeJS.Timeout | null = null

     start(): void {
       // Check every 5 minutes
       this.interval = setInterval(() => {
         const usage = process.memoryUsage()

         logger.info('Memory usage', {
           heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + ' MB',
           heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + ' MB',
           rss: Math.round(usage.rss / 1024 / 1024) + ' MB'
         })

         // Alert on high memory
         if (usage.heapUsed > 500 * 1024 * 1024) { // 500 MB
           logger.warn('High memory usage detected', {
             heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + ' MB'
           })

           Sentry.captureMessage('High Memory Usage', {
             level: 'warning',
             extra: usage
           })
         }
       }, 5 * 60 * 1000)
     }

     stop(): void {
       if (this.interval) {
         clearInterval(this.interval)
       }
     }
   }

   export const memoryMonitor = new MemoryMonitor()

   // Start in main process
   app.whenReady().then(() => {
     memoryMonitor.start()
   })
   ```

**Testing:**
```typescript
describe('Watcher cleanup', () => {
  test('cleans up on webContents destruction', async () => {
    const mockWebContents = createMockWebContents()

    await fileWatcherService.watchFile('/test.md', mockWebContents)

    expect(fileWatcherService.getWatcherCount()).toBe(1)

    // Simulate webContents destruction
    mockWebContents.emit('destroyed')

    expect(fileWatcherService.getWatcherCount()).toBe(0)
  })

  test('closes idle watchers after timeout', async () => {
    vi.useFakeTimers()

    await fileWatcherService.watchFile('/test.md', mockWebContents)

    // Advance past idle timeout
    vi.advanceTimersByTime(31 * 60 * 1000)

    expect(fileWatcherService.getWatcherCount()).toBe(0)
  })
})
```

**Success Criteria:**
- Watchers cleaned up on webContents destruction
- Idle watchers closed after 30 minutes
- Memory usage monitored
- Health check endpoint available
- No memory leaks over 24-hour session

---

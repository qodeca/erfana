## High Priority Issues (P1 - Next Sprint)

### ISSUE-4: 🟠 Race Condition in Monaco Model Swapping

**Severity:** HIGH
**Priority:** P1
**Impact:** Editor shows wrong file content, potential data loss
**Effort:** 1 day

**Evidence:**

Current implementation has no request versioning:

```typescript
// MarkdownEditorPanel.tsx (1,119 lines, 32 hooks)
useEffect(() => {
  if (!currentFile?.path) return

  // Load file content (async)
  window.api.file.readFile(currentFile.path).then(content => {
    // No check if this is still the current file
    setCurrentFile({ ...currentFile, content })
  })
}, [currentFile])
```

**Race Scenario:**
1. User rapidly switches: File A → B → C (within 100ms)
2. Effect 1 fires: Load A (async, takes 50ms)
3. Effect 2 fires: Load B (async, takes 30ms)
4. Effect 3 fires: Load C (async, takes 20ms)
5. **Result:** C loads first, then B, then A
6. **Bug:** UI shows "File C" but editor contains content from File A

**Files Affected:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/Panels/MarkdownEditorPanel.tsx:59-1119`

**Impact:**
- User edits wrong file, loses work
- Save operations corrupt files
- Confusion and data integrity issues

**Recommendations:**

1. **Add request versioning** (4 hours):
   ```typescript
   const loadVersionRef = useRef(0)

   useEffect(() => {
     if (!currentFile?.path) return

     const currentVersion = ++loadVersionRef.current

     window.api.file.readFile(currentFile.path).then(content => {
       // Ignore stale responses
       if (currentVersion !== loadVersionRef.current) {
         console.log('Ignoring stale file load:', currentFile.path)
         return
       }

       setCurrentFile({ ...currentFile, content })
     })
   }, [currentFile])
   ```

2. **Add AbortController for cleanup** (2 hours):
   ```typescript
   const abortControllerRef = useRef<AbortController>()

   useEffect(() => {
     if (!currentFile?.path) return

     // Cancel previous request
     abortControllerRef.current?.abort()
     abortControllerRef.current = new AbortController()

     const signal = abortControllerRef.current.signal

     loadFile(currentFile.path, { signal })
       .then(content => {
         if (!signal.aborted) {
           setCurrentFile({ ...currentFile, content })
         }
       })
       .catch(error => {
         if (error.name !== 'AbortError') {
           console.error('File load error:', error)
         }
       })

     return () => {
       abortControllerRef.current?.abort()
     }
   }, [currentFile])
   ```

3. **Add loading state** (2 hours):
   ```typescript
   const [isLoading, setIsLoading] = useState(false)

   useEffect(() => {
     if (!currentFile?.path) return

     const currentVersion = ++loadVersionRef.current
     setIsLoading(true)

     loadFile(currentFile.path).then(content => {
       if (currentVersion !== loadVersionRef.current) return

       setCurrentFile({ ...currentFile, content })
       setIsLoading(false)
     })
   }, [currentFile])

   // In render:
   {isLoading && <LoadingSpinner />}
   ```

**Testing:**
```typescript
describe('MarkdownEditorPanel rapid file switching', () => {
  test('handles rapid file switches correctly', async () => {
    const { rerender } = render(<MarkdownEditorPanel />)

    // Switch files rapidly
    rerender(<MarkdownEditorPanel filePath="/file-a.md" />)
    rerender(<MarkdownEditorPanel filePath="/file-b.md" />)
    rerender(<MarkdownEditorPanel filePath="/file-c.md" />)

    // Wait for async loads
    await waitFor(() => {
      expect(screen.getByText('file-c.md')).toBeInTheDocument()
    })

    // Verify correct file content loaded
    const editor = screen.getByRole('textbox')
    expect(editor).toHaveValue('Content of file-c.md')
  })
})
```

**Success Criteria:**
- No stale file loads after rapid switching
- Editor always shows correct file content
- Loading states visible to user
- Cleanup happens on unmount

---

### ISSUE-5: 🟠 Missing React Error Boundaries

**Severity:** HIGH
**Priority:** P1
**Impact:** Entire app crashes on component errors, loss of unsaved work
**Effort:** 2 days

**Evidence:**

No error boundaries in component tree:

```typescript
// App.tsx - No error boundary wrapper
export function App() {
  return (
    <QueryClientProvider>
      <ToastProvider>
        <AppDockLayout />  {/* One error here crashes entire app */}
      </ToastProvider>
    </QueryClientProvider>
  )
}
```

**Files Affected:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/App.tsx`
- All panel components lack error boundaries
- No fallback UI for errors

**Impact:**
1. Monaco error → Entire app crashes → Unsaved work lost
2. Terminal error → App unresponsive → No way to recover
3. ProjectTree error → Cannot access files → Must restart
4. Poor user experience → Frustration and data loss

**Recommendations:**

1. **Add top-level error boundary** (4 hours):
   ```typescript
   // src/renderer/src/components/ErrorBoundary/ErrorBoundary.tsx
   import React, { Component, ErrorInfo, ReactNode } from 'react'

   interface Props {
     children: ReactNode
     fallback?: ReactNode
     onError?: (error: Error, errorInfo: ErrorInfo) => void
   }

   interface State {
     hasError: boolean
     error: Error | null
   }

   export class ErrorBoundary extends Component<Props, State> {
     constructor(props: Props) {
       super(props)
       this.state = { hasError: false, error: null }
     }

     static getDerivedStateFromError(error: Error): State {
       return { hasError: true, error }
     }

     componentDidCatch(error: Error, errorInfo: ErrorInfo) {
       console.error('React Error Boundary caught:', error, errorInfo)
       this.props.onError?.(error, errorInfo)

       // Send to error tracking service
       window.api?.errorTracking?.captureException(error, {
         componentStack: errorInfo.componentStack
       })
     }

     handleReset = () => {
       this.setState({ hasError: false, error: null })
     }

     render() {
       if (this.state.hasError) {
         if (this.props.fallback) {
           return this.props.fallback
         }

         return (
           <div style={{ padding: '2rem', textAlign: 'center' }}>
             <h1>Something went wrong</h1>
             <p>{this.state.error?.message}</p>
             <button onClick={this.handleReset}>Try Again</button>
             <button onClick={() => window.location.reload()}>
               Reload App
             </button>
           </div>
         )
       }

       return this.props.children
     }
   }
   ```

2. **Wrap App with error boundary** (1 hour):
   ```typescript
   // App.tsx
   export function App() {
     return (
       <ErrorBoundary
         onError={(error, info) => {
           console.error('Top-level error:', error, info)
         }}
       >
         <QueryClientProvider>
           <ToastProvider>
             <AppDockLayout />
           </ToastProvider>
         </QueryClientProvider>
       </ErrorBoundary>
     )
   }
   ```

3. **Add panel-specific error boundaries** (6 hours):
   ```typescript
   // EditorErrorBoundary.tsx
   export function EditorErrorBoundary({ children }: { children: ReactNode }) {
     return (
       <ErrorBoundary
         fallback={
           <div className="editor-error">
             <h3>Editor Error</h3>
             <p>The editor encountered an error. Other panels still work.</p>
             <button onClick={() => window.location.reload()}>
               Reload Editor
             </button>
           </div>
         }
       >
         {children}
       </ErrorBoundary>
     )
   }

   // Usage in MarkdownEditorPanel:
   <EditorErrorBoundary>
     <MonacoMarkdownEditor />
   </EditorErrorBoundary>
   ```

4. **Add promise rejection handler** (2 hours):
   ```typescript
   // main.tsx
   window.addEventListener('unhandledrejection', (event) => {
     console.error('Unhandled promise rejection:', event.reason)
     event.preventDefault()

     // Show user-friendly toast
     toast.error('An unexpected error occurred', {
       description: event.reason?.message || 'Please try again'
     })
   })
   ```

**Testing:**
```typescript
describe('ErrorBoundary', () => {
  test('catches component errors', () => {
    const ThrowError = () => {
      throw new Error('Test error')
    }

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test error')).toBeInTheDocument()
  })

  test('allows reset after error', () => {
    // ... test reset functionality
  })
})
```

**Success Criteria:**
- Top-level error boundary catches all errors
- Panel-specific boundaries isolate failures
- User can recover without losing work
- Errors logged to monitoring service
- Graceful fallback UI shown

---


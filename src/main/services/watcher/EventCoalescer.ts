// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * EventCoalescer - Merges redundant file system events (VS Code pattern)
 *
 * Based on VS Code's watcher.ts:378-436 implementation.
 *
 * Coalescing Rules:
 * 1. CREATE + DELETE (same path) → removed (no event)
 * 2. DELETE + CREATE (same path) → UPDATED
 * 3. CREATE + UPDATE (same path) → CREATE only
 * 4. UPDATE + UPDATE (same path) → single UPDATE
 *
 * Additional Features:
 * - Cascade prevention: When directory deleted, remove all child events
 * - Case-insensitive path comparison on macOS/Windows
 * - Normalized paths for consistent matching
 */

import { platform } from 'os'
import path from 'path'

export type FileChangeType = 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'

export interface FileChangeEvent {
  type: FileChangeType
  path: string
}

export interface CoalesceResult {
  events: FileChangeEvent[]
  coalescedCount: number
}

// Determine if we should use case-insensitive comparison
const IS_CASE_INSENSITIVE = platform() === 'darwin' || platform() === 'win32'

/**
 * Normalize path for consistent comparison
 * - Lowercase on case-insensitive platforms
 * - Normalize path separators
 */
function normalizePath(filePath: string): string {
  let normalized = path.normalize(filePath)
  if (IS_CASE_INSENSITIVE) {
    normalized = normalized.toLowerCase()
  }
  return normalized
}

/**
 * Check if a path is a child of a directory path
 */
function isChildPath(childPath: string, parentPath: string): boolean {
  const normalizedChild = normalizePath(childPath)
  const normalizedParent = normalizePath(parentPath)

  // Must start with parent path + separator
  return (
    normalizedChild.startsWith(normalizedParent + path.sep) ||
    normalizedChild.startsWith(normalizedParent + '/')
  )
}

/**
 * Internal event tracking for coalescing
 */
interface EventStack {
  events: FileChangeEvent[]
  originalPath: string // Preserve original case
}

export class EventCoalescer {
  private eventMap: Map<string, EventStack> = new Map()
  private deletedDirectories: Set<string> = new Set()
  private totalEventsReceived = 0

  /**
   * Process a single event into the coalescer
   */
  processEvent(event: FileChangeEvent): void {
    this.totalEventsReceived++
    const normalizedPath = normalizePath(event.path)

    // Check if this event is for a file inside a deleted directory
    // (cascade prevention)
    for (const deletedDir of this.deletedDirectories) {
      if (isChildPath(event.path, deletedDir)) {
        // Skip events for paths inside deleted directories
        return
      }
    }

    // Track deleted directories for cascade prevention
    if (event.type === 'unlinkDir') {
      this.deletedDirectories.add(normalizedPath)
    }

    // Get or create event stack for this path
    let stack = this.eventMap.get(normalizedPath)
    if (!stack) {
      stack = { events: [], originalPath: event.path }
      this.eventMap.set(normalizedPath, stack)
    }

    // Apply coalescing rules
    this.applyCoalescingRules(stack, event)
  }

  /**
   * Process multiple events
   */
  processEvents(events: FileChangeEvent[]): void {
    for (const event of events) {
      this.processEvent(event)
    }
  }

  /**
   * Get coalesced events and clear state
   */
  coalesce(): CoalesceResult {
    const originalCount = this.totalEventsReceived
    const coalescedEvents: FileChangeEvent[] = []

    for (const [, stack] of this.eventMap) {
      // Each stack should have at most one event after coalescing
      if (stack.events.length > 0) {
        // Use the last event (after all coalescing)
        const finalEvent = stack.events[stack.events.length - 1]
        // Preserve original path case
        coalescedEvents.push({
          type: finalEvent.type,
          path: stack.originalPath
        })
      }
    }

    const coalescedCount = originalCount - coalescedEvents.length

    // Clear state for next batch
    this.clear()

    return {
      events: coalescedEvents,
      coalescedCount: Math.max(0, coalescedCount)
    }
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.eventMap.clear()
    this.deletedDirectories.clear()
    this.totalEventsReceived = 0
  }

  /**
   * Get current pending event count (for debugging)
   */
  getPendingCount(): number {
    let count = 0
    for (const [, stack] of this.eventMap) {
      count += stack.events.length
    }
    return count
  }

  /**
   * Apply coalescing rules to an event stack
   */
  private applyCoalescingRules(stack: EventStack, newEvent: FileChangeEvent): void {
    const lastEvent = stack.events.length > 0 ? stack.events[stack.events.length - 1] : null

    if (!lastEvent) {
      // First event for this path
      stack.events.push(newEvent)
      return
    }

    // Rule 1: CREATE/ADD + DELETE/UNLINK → removed (no event)
    if (this.isCreateEvent(lastEvent) && this.isDeleteEvent(newEvent)) {
      // Remove the create event, result is no event
      stack.events.pop()
      return
    }

    // Rule 2: DELETE/UNLINK + CREATE/ADD → UPDATED/CHANGE
    if (this.isDeleteEvent(lastEvent) && this.isCreateEvent(newEvent)) {
      // Convert to change event
      stack.events.pop()
      stack.events.push({
        type: 'change',
        path: newEvent.path
      })
      return
    }

    // Rule 3: CREATE/ADD + UPDATE/CHANGE → CREATE only
    if (this.isCreateEvent(lastEvent) && this.isChangeEvent(newEvent)) {
      // Keep the create, ignore the change
      return
    }

    // Rule 4: UPDATE/CHANGE + UPDATE/CHANGE → single UPDATE
    if (this.isChangeEvent(lastEvent) && this.isChangeEvent(newEvent)) {
      // Keep existing change, ignore new one
      return
    }

    // Rule 5: DELETE + DELETE → single DELETE
    if (this.isDeleteEvent(lastEvent) && this.isDeleteEvent(newEvent)) {
      // Keep existing delete
      return
    }

    // Default: replace with new event (handles edge cases)
    stack.events.pop()
    stack.events.push(newEvent)
  }

  /**
   * Check if event is a create/add type
   */
  private isCreateEvent(event: FileChangeEvent): boolean {
    return event.type === 'add' || event.type === 'addDir'
  }

  /**
   * Check if event is a delete/unlink type
   */
  private isDeleteEvent(event: FileChangeEvent): boolean {
    return event.type === 'unlink' || event.type === 'unlinkDir'
  }

  /**
   * Check if event is a change/update type
   */
  private isChangeEvent(event: FileChangeEvent): boolean {
    return event.type === 'change'
  }

}

/**
 * Convenience function to coalesce an array of events
 */
export function coalesceEvents(events: FileChangeEvent[]): CoalesceResult {
  const coalescer = new EventCoalescer()
  coalescer.processEvents(events)
  return coalescer.coalesce()
}

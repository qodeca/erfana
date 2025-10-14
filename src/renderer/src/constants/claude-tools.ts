/**
 * Claude Code Tools Constants
 *
 * Shared constants for Claude Code tool names used across the application.
 * Ensures consistency and type safety.
 */

/**
 * All available Claude Code tools (17 total)
 * This is the complete set of tools available in Claude Code.
 */
export const ALL_CLAUDE_TOOLS = [
  // File Operations (7)
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'LS',

  // System Operations (1)
  'Bash',

  // AI & Web (3)
  'WebSearch',
  'WebFetch',
  'Task',

  // Workflow & Tasks (4)
  'TodoRead',
  'TodoWrite',
  'SlashCommand',
  'ExitPlanMode',

  // Jupyter Notebooks (2)
  'NotebookRead',
  'NotebookEdit'
] as const

/**
 * Planning mode safe tools (9 total)
 * Read-only and safe tools allowed in planning mode.
 */
export const PLANNING_MODE_TOOLS = [
  'Read',
  'LS',
  'Glob',
  'Grep',
  'Task',
  'WebSearch',
  'TodoRead',
  'TodoWrite',
  'NotebookRead'
] as const

/**
 * Type for Claude Code tool names
 */
export type ClaudeToolName = typeof ALL_CLAUDE_TOOLS[number]

/**
 * Check if a tool is valid
 */
export function isValidClaudeTool(tool: string): tool is ClaudeToolName {
  return (ALL_CLAUDE_TOOLS as readonly string[]).includes(tool)
}

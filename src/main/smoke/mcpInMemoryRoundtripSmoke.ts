// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MCP SDK in-memory round-trip smoke (SD-019, issue #19 — Wave A, AC#4).
 *
 * Proves the pinned `@modelcontextprotocol/sdk@1.29.0` survives a full
 * client ↔ server exchange: an `InMemoryTransport.createLinkedPair()` links
 * a `Client` to an `McpServer` that registers one trivial tool, then we
 * assert `client.listTools()` *contains* the tool AND `client.callTool()`
 * *returns the expected result* — deliberately more than a bare
 * `registerTool` call (SD-019 §4 Decision 4).
 *
 * `InMemoryTransport` sidesteps the `RunAsNode: false` fuse that #30's stdio
 * server will hit; that is carried forward as an open risk for #30, not
 * blessed here (no `StdioServerTransport` is exercised).
 *
 * @see specs/designs/sd-019-native-dep-spike.md §4 Decision 4, §8.8
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import type { SmokeCheck } from './types'

const TOOL_NAME = 'erfana_smoke_echo'
const ECHO_INPUT = 'ping'
const EXPECTED_OUTPUT = `echo:${ECHO_INPUT}`

/**
 * Run the MCP round-trip and return two named checks:
 *  - `mcp:listTools`  — the registered tool is advertised by the server.
 *  - `mcp:callTool`   — invoking the tool returns the expected text content.
 *
 * Never throws: a transport/protocol failure is captured into the returned
 * checks so callers (orchestrator + vitest) can fail closed uniformly.
 */
export async function runMcpRoundtripSmoke(): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = []
  const server = new McpServer({ name: 'erfana-smoke-server', version: '0.0.0' })
  const client = new Client({ name: 'erfana-smoke-client', version: '0.0.0' })

  server.registerTool(
    TOOL_NAME,
    { description: 'Echoes its input back — smoke tool only.', inputSchema: { value: z.string() } },
    async ({ value }) => ({ content: [{ type: 'text', text: `echo:${value}` }] })
  )

  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const listed = await client.listTools()
    const hasTool = listed.tools.some((t) => t.name === TOOL_NAME)
    checks.push({
      name: 'mcp:listTools',
      passed: hasTool,
      detail: `advertised tools: [${listed.tools.map((t) => t.name).join(', ')}]`,
    })

    const called = await client.callTool({ name: TOOL_NAME, arguments: { value: ECHO_INPUT } })
    const content = Array.isArray(called.content)
      ? (called.content as Array<{ type: string; text?: string }>)
      : []
    const text = content.find((c) => c.type === 'text')?.text
    checks.push({
      name: 'mcp:callTool',
      passed: text === EXPECTED_OUTPUT,
      detail: `callTool returned '${text ?? '<none>'}' (expected '${EXPECTED_OUTPUT}')`,
    })
  } catch (error) {
    checks.push({
      name: 'mcp:roundtrip',
      passed: false,
      detail: error instanceof Error ? error.message : 'unknown MCP error',
    })
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }

  return checks
}

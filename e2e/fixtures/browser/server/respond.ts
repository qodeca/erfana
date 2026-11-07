// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** Small response and request helpers shared by the fixture routes. */

import type * as http from 'node:http'

export function sendText(
  res: http.ServerResponse,
  status: number,
  body: string,
  contentType = 'text/html; charset=utf-8',
  extraHeaders: http.OutgoingHttpHeaders = {}
): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...extraHeaders })
  res.end(body)
}

export function sendJson(
  res: http.ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: http.OutgoingHttpHeaders = {}
): void {
  sendText(res, status, JSON.stringify(value), 'application/json; charset=utf-8', extraHeaders)
}

const MAX_BODY_BYTES = 64 * 1024

/** Reads a small request body as UTF-8; rejects bodies over 64 KiB. */
export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body over 64 KiB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

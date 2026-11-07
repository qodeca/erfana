// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The load-error page's sentence for each Chromium network error (spec 025,
 * 025-FR-059): a fixed table in code, one message per code, with a default.
 *
 * Codes and names follow Chromium's `net/base/net_error_list.h`, as Electron
 * reports them in `did-fail-load` (`errorCode`, negative). Certificate errors
 * normally show Erfana's certificate page instead (025-FR-021); they are here
 * so a certificate failure that reaches the load-error page still reads well.
 * The page shows the message and the code, for example
 * "ERR_CONNECTION_REFUSED (-102)".
 */

export interface NetErrorEntry {
  /** Chromium's name without the `ERR_` prefix. */
  readonly name: string
  /** One sentence, with a full stop. */
  readonly message: string
}

/** The sentence for a code that is not in the table. */
export const DEFAULT_NET_ERROR_MESSAGE = 'The page could not be loaded.'

const CERTIFICATE = "The site's security certificate is not valid."

const TABLE: ReadonlyMap<number, NetErrorEntry> = new Map(
  (
    [
      [-2, 'FAILED', 'The page could not be loaded.'],
      [-6, 'FILE_NOT_FOUND', 'The file was not found.'],
      [-7, 'TIMED_OUT', 'The request timed out.'],
      [-8, 'FILE_TOO_BIG', 'The file is too big to open.'],
      [-10, 'ACCESS_DENIED', 'Access to this address was denied.'],
      [-15, 'SOCKET_NOT_CONNECTED', 'The connection is not open.'],
      [-20, 'BLOCKED_BY_CLIENT', 'Erfana blocked this address.'],
      [-21, 'NETWORK_CHANGED', 'The network changed while the page was loading.'],
      [-22, 'BLOCKED_BY_ADMINISTRATOR', 'An administrator policy blocked this address.'],
      [-27, 'BLOCKED_BY_RESPONSE', 'The site does not allow this page to be shown here.'],
      [-29, 'CLEARTEXT_NOT_PERMITTED', 'This address may only be loaded over a secure connection.'],
      [-100, 'CONNECTION_CLOSED', 'The server closed the connection without sending anything.'],
      [-101, 'CONNECTION_RESET', 'The connection was reset.'],
      [-102, 'CONNECTION_REFUSED', 'The server refused the connection – nothing is listening on that address and port.'],
      [-103, 'CONNECTION_ABORTED', 'The connection was aborted.'],
      [-104, 'CONNECTION_FAILED', 'The connection failed.'],
      [-105, 'NAME_NOT_RESOLVED', "The server's address could not be found."],
      [-106, 'INTERNET_DISCONNECTED', 'This computer is not connected to the internet.'],
      [-107, 'SSL_PROTOCOL_ERROR', 'The site sent a response that is not a valid secure connection.'],
      [-108, 'ADDRESS_INVALID', 'The address is not valid.'],
      [-109, 'ADDRESS_UNREACHABLE', 'The address cannot be reached from this network.'],
      [-111, 'TUNNEL_CONNECTION_FAILED', 'The connection through the proxy failed.'],
      [-113, 'SSL_VERSION_OR_CIPHER_MISMATCH', 'The site uses an unsupported security protocol.'],
      [-118, 'CONNECTION_TIMED_OUT', 'The server took too long to respond.'],
      [-130, 'PROXY_CONNECTION_FAILED', 'The proxy server is not responding.'],
      [-137, 'NAME_RESOLUTION_FAILED', "The server's name could not be looked up."],
      [-138, 'NETWORK_ACCESS_DENIED', 'Network access was denied – a firewall or security program may be blocking it.'],
      [-200, 'CERT_COMMON_NAME_INVALID', CERTIFICATE],
      [-201, 'CERT_DATE_INVALID', "The site's security certificate has expired or is not yet valid."],
      [-202, 'CERT_AUTHORITY_INVALID', "The site's security certificate is not trusted."],
      [-203, 'CERT_CONTAINS_ERRORS', CERTIFICATE],
      [-206, 'CERT_REVOKED', "The site's security certificate has been revoked."],
      [-207, 'CERT_INVALID', CERTIFICATE],
      [-300, 'INVALID_URL', 'The address is not valid.'],
      [-301, 'DISALLOWED_URL_SCHEME', 'This kind of address cannot be opened here.'],
      [-302, 'UNKNOWN_URL_SCHEME', 'This kind of address cannot be opened here.'],
      [-310, 'TOO_MANY_REDIRECTS', 'The page redirected too many times.'],
      [-311, 'UNSAFE_REDIRECT', 'The page redirected to an address that is not allowed.'],
      [-312, 'UNSAFE_PORT', 'The port is blocked because it is used by other services.'],
      [-320, 'INVALID_RESPONSE', 'The server sent an invalid response.'],
      [-324, 'EMPTY_RESPONSE', 'The server sent no data.'],
      [-355, 'INCOMPLETE_CHUNKED_ENCODING', 'The server stopped sending the page part-way.'],
      [-501, 'INSECURE_RESPONSE', 'The server sent a response that is not secure.']
    ] as const
  ).map(([code, name, message]) => [code, { name, message }])
)

/** The entry for a Chromium network error code, or `null` when it is not in the table. */
export function netErrorEntry(code: number): NetErrorEntry | null {
  return TABLE.get(code) ?? null
}

/** The sentence for a Chromium network error code; the default for an unknown code. */
export function netErrorMessage(code: number): string {
  return netErrorEntry(code)?.message ?? DEFAULT_NET_ERROR_MESSAGE
}

/**
 * The code as the page shows it: "ERR_CONNECTION_REFUSED (-102)", or just
 * "(-999)" for a code the table does not name.
 */
export function netErrorCodeText(code: number): string {
  const entry = netErrorEntry(code)
  return entry === null ? `(${code})` : `ERR_${entry.name} (${code})`
}

/**
 * `ERR_ABORTED`: the load was cancelled – by Stop, a newer navigation, a
 * download or HTTP 204 – not failed, so no load-error page shows (025-FR-002
 * reverts the pending address instead).
 */
export const NET_ERROR_ABORTED = -3

/** True when a failed load should show the load-error page (every code but `ERR_ABORTED`). */
export function showsLoadErrorPage(code: number): boolean {
  return code !== NET_ERROR_ABORTED
}

/** Every code in the table, for tests and the user guide. */
export function netErrorCodes(): number[] {
  return [...TABLE.keys()]
}

<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# What Chromium actually does with `http://` and IPv6 in a preview

Decision record for [#108](https://github.com/qodeca/erfana/issues/108). Measured
in a throwaway Electron harness that mirrors the preview: the same scheme
privileges as `previewScheme.ts` (`standard`, `secure`, `supportFetchAPI`,
`corsEnabled`), `sandbox: true`, and the same unconditional deny in
`setPermissionRequestHandler` / `setPermissionCheckHandler` that
`previewSessionPolicy.ts:96-97` installs.

**Electron 39.8.10 (Chromium 142), macOS.** The harness was deleted; it lives only
in this record.

## Why it was run

The plan for #108 assumed — on reasoning, not measurement — that because
`previewScheme.ts` registers the scheme with `secure: true`, the previewed
document is a secure context, and therefore Chromium blocks `http://`
subresources as **mixed content before CSP or the network filter is consulted**.

If that were true, allowing an `http://` origin would write an irreversible,
git-committed, team-wide grant that **does nothing** — a dead Allow button that
looks alive, which is worse than the dead end #108 exists to remove.

It is not true.

## Results

| Question | Answer |
|---|---|
| Is the document a secure context? | **Yes** — `isSecureContext === true`, with `origin === null` |
| Does `http://127.0.0.1:PORT` load? | **Yes** — script and image both |
| Did Local Network Access block loopback? | **No**, despite the deny-all permission handlers |
| Is a public `http://` subresource blocked as mixed content? | **No** — no `Mixed Content` message at all |
| Was anything autoupgraded to https? | **No** |
| Does Chromium accept an IPv6 CSP host-source? | **No** — see below |

## The finding that changes the plan

**Mixed-content blocking does not apply here.** The document reports
`isSecureContext === true` and yet a plain `http://` subresource is not refused
before the request: Chromium attempted the load and it failed at DNS, and
Electron's own "Insecure Resources" warning listed the two `http://` URLs by
name — a warning it can only print about resources it tried to fetch.

The likely reason is the second half of that first row. The document sits at an
**opaque origin** (`origin === null`) because of `sandbox allow-scripts` with no
`allow-same-origin`. Mixed content is decided against the *origin's* scheme, not
against `isSecureContext`, and an opaque origin has no scheme to be mixed with.

So `secure: true` buys the secure-context capability gates; it does not buy
mixed-content restriction. Those are two different mechanisms and it is easy to
assume they travel together.

**Consequence for #108:** an approved `http://` origin **works**. The owner's
decision to make `http://` approvable everywhere produces functioning grants, not
dead ones, and the UI does not need to hedge about whether a grant will load.

It does need to say what `http://` costs, which is a different sentence: the
connection is not encrypted, so anyone positioned on the network can change what
the page loads — and the page is already the thing the allowlist exists to
contain.

*Caveat, stated because the harness cannot close it: the public-http probe used
`cdn.example.invalid`, which does not resolve. That proves the request was **not
refused before it left**, which is what mixed-content blocking would have done.
It does not prove a real public http host returns 200.*

## IPv6 stays refused, and now we know it is refused twice

Chromium rejects an IPv6 host-source outright:

```
The source list for the Content Security Policy directive 'img-src'
contains an invalid source: 'http://[::1]:9000'. It will be ignored.
```

The last four words are the dangerous part. The source is not an error that fails
the policy — it is **silently dropped**, so a grant written for an IPv6 literal
would sit in the network filter's allowed set while the CSP never carried it. The
two chokepoints would desync, and the row would read as granted while the
resource stayed refused.

This matches the CSP3 grammar (`host-char = ALPHA / DIGIT / "-"`) and
[w3c/webappsec-csp#224](https://github.com/w3c/webappsec-csp/issues/224). It is
the one refusal in the preview that is a property of the mechanism rather than a
policy Erfana chose, and it is the reason the band states a reason for it instead
of showing a blank refusal.

## What was NOT measured

- A **private-range** address (`192.168.1.5:8080`). An unroutable address stalls
  the document load rather than answering the question. The public-http result
  makes the same point about mixed content; whether Local Network Access gates
  RFC1918 differently from loopback is still open.
- A real public http host returning 200 — see the caveat above.
- Whether any of this differs on Windows.

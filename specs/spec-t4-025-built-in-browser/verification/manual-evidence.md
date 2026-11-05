# Spec 025 manual evidence

This file records the acceptance IDs of spec 025 that no automated test can cover: the `packaged`, `bench`, `manual`, `review` and `all` lanes of the Test checklist in `requirements/04-acceptance.md`.

`node scripts/check-spec025-trace.mjs` reads the table below. A row counts only when:

- cell 1 is exactly the acceptance ID (for example `025-AC-040`);
- cell 2 lists the lanes the row covers, comma-separated;
- the last cell holds at least one path in backticks, and every such path exists in the repository.

Add a row only when its evidence file exists and really proves the acceptance criterion. A file that merely exists is not proof; a reviewer reads it against the criterion. Do not add placeholder rows.

| ID | Lane | Result | Evidence |
|---|---|---|---|
| 025-AC-040 | review | Pass, 2026-11-03: no setting, flag, environment variable or hidden control turns the browser off | `specs/spec-t4-025-built-in-browser/verification/review-025-AC-040.md` |
| 025-AC-042 | review | Pass, 2026-11-03: a failed load logs its full URL with the query string, the exception is technical-debt entry 68, and the one URL-logging site carries the comment | `specs/spec-t4-025-built-in-browser/verification/review-025-AC-042.md` |
| 025-AC-044 | review | Pass, 2026-11-03, re-reviewed at `5643b433` (S-36 profile split) after a user-guide fix in this review: the browser page and the Data handling page carry every listed item, and the checked claims match the code | `specs/spec-t4-025-built-in-browser/verification/review-025-AC-044.md` |
| 025-AC-049 | bench | Reworked 2026-11-05 for the Erfana-drawn band (pointer move to the band window's first presented frame): Linux in Docker under xvfb, 3 runs of 200 traced moves after 20 warm-up, p95 25.2–25.6 ms against 50 ms; the 2026-11-03 macOS pass (p95 41.2–41.9 ms) timed the old engine outline and is kept as history; macOS and Windows runs of the band still to be taken | `docs/performance/browser-025-highlight.md` `e2e/browser-pick-highlight.bench.ts` |
| 025-AC-050 | bench | Pass on the macOS reference machine (Apple M5 Pro, macOS 27.2), 2026-11-03: React app, 100 picks, confirm to menu p95 73.3 ms (≤ 500 ms) and Explain to terminal p95 231.0 ms (≤ 2 s); worst case reported, 20 picks, 148.8 ms and 265.8 ms; Windows and Linux runs still to be taken | `docs/performance/browser-025-send.md` `e2e/browser-pick-send.bench.ts` |

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
| 025-AC-044 | review | Pass, 2026-11-03, after a user-guide fix in this review: the browser page and the Data handling page carry every listed item, and the checked claims match the code | `specs/spec-t4-025-built-in-browser/verification/review-025-AC-044.md` |

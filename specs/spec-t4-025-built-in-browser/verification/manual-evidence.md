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

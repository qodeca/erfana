# SD-047 — Context-meter freeze after compaction (fallback-read bound + version guard)

**Status:** shipped – issue #47 closed 2026-08-09 (`d437ef9` "fix(claude-status): bound the post-compaction transcript re-read"). The single `recordFallbackResult()` sketched in §5 shipped as a four-function API in `fallbackGuard.ts`: `getFallbackResult`, `recordFallbackProvisional`, `finalizeFallbackResult`, `rollbackFallbackProvisional` (plus `__resetFallbackGuardForTests` / `__fallbackGuardSizeForTests`).
**Issue:** #47 — Claude Code context-window meter freezes the UI after a compaction.
**Phase:** 4 (Architecture / design only — no source changes here).
**Scope:** `src/main/services/claudeStatus/ClaudeTranscriptParser.ts` (fallback control-flow behaviour change) + the extracted `src/main/services/claudeStatus/fallbackGuard.ts` cache module + their tests.

> **Revision: guard extracted to `fallbackGuard.ts` (QG-6).** At the QG-6 architecture
> checkpoint the version-guard cache was moved out of `ClaudeTranscriptParser.ts` into its
> own module `src/main/services/claudeStatus/fallbackGuard.ts`. `parseTranscript` now keeps
> only the A–D fallback control flow and gained an optional test-only injected-reader param
> (`readFn`, defaults to the real `readRelevantText`). The design below is unchanged in
> mechanism; where it still describes the guard as "parser-internal" / a "module-level Map
> inside `ClaudeTranscriptParser`", read `fallbackGuard.ts` as the actual home — see the
> updated §4, §5 and §9. `FALLBACK_READ_MAX_BYTES` stays in the parser (its only consumer);
> `MAX_FALLBACK_GUARD_ENTRIES` moved with the cache into `fallbackGuard.ts`.

---

## 1. Problem recap (verified, Phases 2–3)

`parseTranscript()` first tail-reads the final 256 KB (`TAIL_THRESHOLD_BYTES`). When the
latest usable turn is not in that tail (the post-compaction state), the tail scan returns
`null` and the fallback at lines 335–341 re-reads the **entire** file via
`readRelevantText(filePath, Number.MAX_SAFE_INTEGER)` — up to ~18.8 MB read + `JSON.parse`
per line, synchronously on the main thread. `ClaudeStatusService.runRefresh()` calls
`parseTranscript` ~1×/sec per terminal, and after a compaction the not-in-tail condition
is **stable**, so the full read repeats every refresh and freezes the editor, project
tree and every IPC handler.

Two fixes, both already approved:

1. **Bound** the fallback read to a named 2 MB constant (≈8× the tail).
2. **Version-guard** the fallback in the parser module so the (now-bounded) read is done at
   most once per transcript-file-version — and **cache its result** so a recovered turn is
   re-served on every suppressed refresh (see §3.3 for why caching the result, not a mere
   "attempted" flag, is mandatory).

---

## 2. Constants

> Post-QG-6: `FALLBACK_READ_MAX_BYTES` lives in `ClaudeTranscriptParser.ts` (adjacent to
> `TAIL_THRESHOLD_BYTES`), its only consumer; `MAX_FALLBACK_GUARD_ENTRIES` moved into
> `fallbackGuard.ts` alongside the cache it bounds.

```ts
/**
 * Upper bound (bytes) on the ONE-SHOT fallback read taken when the 256 KB tail
 * ({@link TAIL_THRESHOLD_BYTES}) yields no usable turn — the compaction-recovery
 * path (#4/#10). ~8× the tail: large enough to recover a turn evicted by a big
 * compaction summary, small enough that it bounds the fallback to a single
 * ~50 ms parse (a 2 MB no-turn scan is a frame drop, not a freeze), taken at most
 * once per file-version. The old {@link Number.MAX_SAFE_INTEGER} read pulled the
 * full ~18.8 MB file EVERY refresh, a sustained stall that froze the UI (#47).
 * Paired with {@link fallbackGuard}, which also caches the result so a recovered
 * turn is re-served with zero re-reads while the file is stable.
 */
const FALLBACK_READ_MAX_BYTES = 2 * 1024 * 1024

/**
 * Max distinct transcript files tracked by {@link fallbackGuard}. Transcripts
 * rotate over a long session; without a cap the guard Map would grow unbounded.
 * 256 mirrors the process-detector cache cap (AbstractClaudeProcessDetector) and
 * far exceeds any realistic number of concurrently-live transcripts.
 */
const MAX_FALLBACK_GUARD_ENTRIES = 256
```

---

## 3. Mechanism

### 3.1 Cheap version key BEFORE the bounded read (surface `mtimeMs` from the tail read)

`readRelevantText` (line 272) already does `const { size } = await handle.stat()`.
`mtimeMs` is on the **same** `stat()` result — one extra destructured field, **no extra
syscall**. Surface it from the tail read so the guard never issues its own `stat`.

```ts
async function readRelevantText(
  filePath: string,
  maxBytes: number
): Promise<{ text: string; truncated: boolean; size: number; mtimeMs: number } | null> {
  ...
  const { size, mtimeMs } = await handle.stat()      // was: const { size } = ...

  if (size <= maxBytes) {
    const whole = await handle.readFile('utf8')
    return { text: whole, truncated: false, size, mtimeMs }
  }
  ...
  return { text, truncated: true, size, mtimeMs }
}
```

`readRelevantText` is a **private module function** — the only caller is
`parseTranscript`, so no other file is affected by the widened return type. It still
returns `null` on any error (contract preserved).

The **version key** is derived from the FIRST (tail) read's stat, which happened before we
decide to do the fallback: `` `${read.size}:${read.mtimeMs}` ``. No separate stat, no race
with a second `fs.open`.

**Change-detection primarily keys on `size`.** Transcripts are append-only, so size
*strictly grows* on every write — a new turn can never reuse a prior version key. `mtimeMs`
is a secondary signal in the composite key, so coarse mtime resolution is not a correctness
risk (a same-size, same-mtime "collision" would require a non-append rewrite of identical
length, which the append-only format does not produce).

### 3.2 Revised fallback control flow (replaces lines 335–341)

The guard **caches the scanned result**, not a boolean "attempted" marker. A provisional
marker is inserted before the `await` purely to dedup concurrent reads; it is finalised on
a completed read and **rolled back** if the read fails.

```
// after: const read = await readRelevantText(filePath, maxBytes)
//        if (read === null) return null
//        let turn = scanForLatestTurn(read.text)

if (turn === null && read.truncated) {
  const versionKey = `${read.size}:${read.mtimeMs}`

  // (A) Cache HIT — re-serve the previously scanned result for this exact
  //     file-version without any read. This is what keeps the bar populated:
  //     a turn recovered on refresh #1 is returned again on #2, #3, … and a
  //     genuine no-turn returns null (freeze fixed, meter not blanked).
  const cached = fallbackGuard.get(filePath)
  if (cached !== undefined && cached.version === versionKey) {
    return cached.turn
  }

  // (B) Cache MISS — insert a PROVISIONAL entry (turn: null) to dedup any
  //     concurrent refreshes for the same file-version, THEN do the bounded read.
  //     No `await` sits between the get above and this set, so on the single-
  //     threaded event loop at most one bounded read is issued per version even
  //     when several terminals refresh the same transcript at once (see §6.3).
  recordFallbackResult(filePath, { version: versionKey, turn: null })

  logger.debug('ClaudeTranscriptParser: tail window yielded no turn; retrying bounded read', {
    filePath
  })
  const full = await readRelevantText(filePath, FALLBACK_READ_MAX_BYTES)

  if (full !== null) {
    // (C) Read COMPLETED — finalise the cache with the scanned turn. `scanned`
    //     may be a real turn OR null (read succeeded, found nothing usable);
    //     BOTH are legitimate cached negatives/positives and are stored.
    const scanned = scanForLatestTurn(full.text)
    recordFallbackResult(filePath, { version: versionKey, turn: scanned })
    turn = scanned
  } else {
    // (D) Read FAILED transiently (EMFILE/EBUSY under load → readRelevantText
    //     returned null). Do NOT cache a failure: roll back the provisional
    //     entry — but only if it is still OURS (same version, still the
    //     provisional turn:null). A concurrent completed read may have already
    //     finalised a real result for this version; never clobber that. The
    //     next refresh then retries instead of being permanently suppressed.
    const current = fallbackGuard.get(filePath)
    if (current !== undefined && current.version === versionKey && current.turn === null) {
      fallbackGuard.delete(filePath)
    }
    // turn stays null → parseTranscript returns null this refresh; retried next.
  }
}

return turn
```

Notes:
- The provisional `turn: null` entry inserted at (B) is indistinguishable *by value* from a
  legitimately-cached negative. That is fine: a legitimate negative is written at (C) with
  the SAME `{version, turn: null}` shape, so a concurrent reader that hits it early simply
  re-serves `null` — the correct answer for a genuine no-turn version. The rollback at (D)
  only fires on the read-failure branch, where no completed read has run in *this* call.
- `parseTranscript` still **never throws** and remains fail-closed to `null`: all guard ops
  are synchronous Map calls that cannot throw; the read stays wrapped in
  `readRelevantText`'s own try/catch → `null`.

### 3.3 Why cache the RESULT, not an "attempted" flag (the blocker this revision fixes)

The prior design stored `Map<filePath, versionKey>` (a bare "a fallback was attempted"
marker) and returned `null` on a guard hit. That regressed the meter in the exact reported
scenario:

1. Refresh #1: tail read → null, bounded read recovers the turn → bar shows the value, and
   the marker is set for this version.
2. Refresh #2 (file unchanged): tail read → null again, guard **hit**, prior design returns
   `null`. `ClaudeStatusService.runRefresh` maps `null` → `emitNull`, which **hides the
   bar**.

So the meter flashed the recovered value once, then blanked until the file next changed.
Caching the *result* and re-serving it on the guard hit (branch (A)) keeps the bar
populated on every suppressed refresh with zero re-reads, while still returning `null` for a
genuine no-turn version — freeze fixed **and** meter preserved.

---

## 4. Guard data structure

```ts
/**
 * Per-transcript cache of the bounded-fallback RESULT, keyed by absolute
 * transcript filePath. Value: the file-version the result was scanned for plus
 * the scanned turn (a real {@link ParsedTurn} when one was recovered inside
 * {@link FALLBACK_READ_MAX_BYTES}, or `null` for a genuine no-turn version). The
 * cached turn is RE-SERVED on every later refresh of the same version, so a
 * recovered bar stays populated with zero re-reads and the freeze (#47) is gone.
 * Only COMPLETED reads are cached; a transient read failure is not (see §3.2 D),
 * so one EMFILE/EBUSY cannot permanently hide the bar. Bounded to
 * {@link MAX_FALLBACK_GUARD_ENTRIES} (FIFO eviction). This is the sole mutable
 * module-level singleton in `fallbackGuard.ts` — reset for tests via
 * {@link __resetFallbackGuardForTests}.
 */
const fallbackGuard = new Map<string, { version: string; turn: ParsedTurn | null }>()

/** Design-time sketch. Shipped as four exported functions in fallbackGuard.ts: */
export function getFallbackResult(filePath: string, version: string): FallbackResult | undefined
export function recordFallbackProvisional(filePath: string, version: string): void   // dedup insert before the await
export function finalizeFallbackResult(filePath: string, version: string, turn: ParsedTurn | null): void
export function rollbackFallbackProvisional(filePath: string, version: string): void // read threw – drop the placeholder
// Eviction at MAX_FALLBACK_GUARD_ENTRIES (256) is oldest-by-insertion, applied when a NEW filePath key is added.
```

| Aspect | Choice |
|---|---|
| Type | `Map<string, { version: string; turn: ParsedTurn | null }>` (module-level `const`) |
| Key | absolute `filePath` (multiple terminals share one transcript → file-version keying is correct: one file → one guard entry, shared across terminals) |
| Value | `{ version: `${size}:${mtimeMs}`, turn }` — turn is a `ParsedTurn` or `null` |
| Provisional insert | `recordFallbackResult(filePath, { version, turn: null })` synchronously right after the miss check, before the `await` of the bounded read (dedup) |
| Finalise | on completed read: `recordFallbackResult(filePath, { version, turn: scanned })` |
| Rollback | on read failure: delete the entry iff it is still our provisional `{version, turn: null}` |
| Hit condition | `cached?.version === versionKey` → return `cached.turn` |
| Cap | `MAX_FALLBACK_GUARD_ENTRIES = 256` |
| Eviction | **FIFO by first-insert** — delete `keys().next().value` only when inserting a **new** key at/over cap (mirrors `AbstractClaudeProcessDetector` cache discipline). A conscious accept vs. LRU: at a 256-entry cap the recency difference is negligible and FIFO needs no per-hit bookkeeping. Re-keying an existing filePath overwrites in place; size unchanged. |
| Declared in | `fallbackGuard.ts`, module scope (extracted from `ClaudeTranscriptParser.ts` at QG-6); parser calls the exported `getFallbackResult` / `recordFallbackProvisional` / `finalizeFallbackResult` / `rollbackFallbackProvisional` helpers |

---

## 5. Test-reset + size hooks

```ts
/** Clear the fallback-result cache. Test-only (mirrors __resetSettingsCacheForTests). */
export function __resetFallbackGuardForTests(): void {
  fallbackGuard.clear()
}

/** Current fallback-cache size. Test-only — asserts the eviction cap (AC6). */
export function __fallbackGuardSizeForTests(): number {
  return fallbackGuard.size
}
```

- Precedent for the reset hook: `__resetSettingsCacheForTests` (ClaudeWindowDetector),
  `__resetRootCacheForTests` (ClaudeTranscriptLocator) — same `__reset…ForTests` convention.
- `__fallbackGuardSizeForTests` is the minimal read-only seam needed to assert AC6 without a
  spy or reaching into module internals.
- Both are test-only: called from the new test file so cases don't leak guard state.

---

## 6. Interaction / ordering guarantees

1. **Compaction recovery (#4/#10) preserved within 2 MB.** The fallback still fires when
   `turn === null && read.truncated`, still retries via `scanForLatestTurn` over the wider
   read — only the read size changed from "whole file" to `FALLBACK_READ_MAX_BYTES`, and the
   result is now cached. Any turn within the last 2 MB (8× the old tail) is still recovered,
   and `justCompacted` stays honest for those cases. Only files whose relevant turn sits
   **beyond** the last 2 MB lose recovery — an extreme, and the freeze-avoidance trade is
   the approved call.
2. **Happy path untouched.** The guard lives entirely inside `if (turn === null &&
   read.truncated)`. When the tail read yields a turn (the common case) the block is
   skipped, `fallbackGuard` is never read or written, and there is zero added cost. Files
   small enough to be read whole (`read.truncated === false`) also never touch the guard.
3. **Concurrency — at most one bounded read per version.** Refreshes are async but the event
   loop is single-threaded. The `get` (branch A/B miss check) and the provisional `set`
   (B) run with **no intervening `await`**, so for a transcript shared by several terminals
   the first resumed refresh writes the provisional entry synchronously; every other
   in-flight refresh for the same version then sees a matching cached version at (A) and
   re-serves it (initially the provisional `null`, later the finalised turn) → exactly one
   bounded read per version even under overlapping refreshes. On read failure the rollback
   (D) is version+shape-guarded so it never deletes a result a concurrent completed read
   already finalised.

---

## 7. mtime-churn scope note (document in code comment + here)

The cache suppresses repeats **only while the version is stable between refreshes** —
exactly the reported freeze: idle-after-compaction, where size/mtime don't move so the
version key is constant, the bounded read is taken once and its result re-served thereafter.

An **actively-written** transcript advances size (and usually mtime) on each write, so it
re-keys and the cache does not suppress there — but an active session almost always has a
fresh in-tail assistant turn, so the fallback doesn't fire at all. **Residual case:** a
single line larger than the 256 KB tail (e.g. one very large user/tool message) that pushes
the latest turn out of the tail on an actively-written file re-keys every refresh, so the
bounded read runs each refresh. That is still capped at `FALLBACK_READ_MAX_BYTES` (a
~50 ms parse, no freeze) — bounded cost, just not suppressed. The cache is a repeat-
suppressor for the stable case; the byte cap is the defence for the churning case.

---

## 8. Test plan — `ClaudeTranscriptParser.fallbackGuard.test.ts` (new file)

Match the existing `ClaudeTranscriptParser.test.ts` style: **real temp `.jsonl` files** via
`fs.mkdtemp` + `fs.writeFile` (so `stat()` size/mtime are real), `fs.utimes` to pin mtime,
and `beforeEach/afterEach → __resetFallbackGuardForTests()`. **No `vi.spyOn` on internals** —
`readRelevantText`/`scanForLatestTurn` are private, same-module functions and cannot be
intercepted under ESM. All assertions are behavioural (what `parseTranscript` returns) or
via the exported test-only size accessor.

Fixture helper: build a `.jsonl` whose relevant assistant turn sits at a chosen **distance
from EOF** by padding with filler lines (each an ignorable/non-turn record so only byte
position, not turn selection, changes). "In the 256 KB–2 MB band" = the turn is past the
256 KB tail but within the 2 MB fallback window; ">2 MB from EOF in a >2 MB file" = the turn
is beyond the fallback window.

| # | Test | How | Asserts | AC |
|---|---|---|---|---|
| T1 | **2 MB bound (boundary).** | (a) turn placed in the 256 KB–2 MB band → `parseTranscript` recovers it; (b) same turn placed >2 MB from EOF in a >2 MB fixture → returns `null`. | The whole-file read was replaced by a 2 MB cap: in-band recovers, out-of-band (but in-file) does not. | AC1 |
| T2 | **At most once per version / suppression (no spy).** | Write a no-turn-in-tail fixture; call `parseTranscript` (result R1). Pin mtime with `fs.utimes`, then rewrite the file with **equal-length** content that injects a valid in-band turn (same size + same mtime → same version key). Call again (R2). | R2 === R1 (the injected turn is NOT seen) — proving call #2 skipped the read and re-served the cache, not re-ran the scan. | AC2 |
| T3 | **Successful-recovery-then-refresh (guards the blocker).** | Turn in the 256 KB–2 MB band; call `parseTranscript` twice on the identical version (no file change). | BOTH calls return the same recovered turn — the second is NOT `null`. (Directly guards the emitNull/hide-bar regression.) | AC2 / blocker |
| T4 | **Transient-failure-then-retry (guards the major).** | Make the bounded read fail once then succeed on the same version, WITHOUT spying internals. Seam: create the fixture with the turn in-band, then between calls toggle readability so the fallback read fails once — e.g. `fs.chmod(file, 0o000)` (POSIX) before call #1 and restore `0o644` before call #2, keeping size/mtime identical (pin with `fs.utimes`). The tail read at call #2 must still succeed to reach the fallback: place a *second, tail-resident but non-usable* marker so the tail read returns text (no turn) but the file stat is readable, and gate only the... (if chmod also blocks the tail open, assert the simpler invariant: on read failure NO entry is cached, then a later readable refresh recovers). Minimal-seam fallback if the permission trick is non-portable (Windows CI): expose nothing extra — instead assert via a truncated/locked fixture that a `readRelevantText`→null path leaves `__fallbackGuardSizeForTests() === 0`, then a repaired file recovers. | Call #1 (read fails) → `null` AND `__fallbackGuardSizeForTests() === 0` (failure NOT cached). Call #2 (read succeeds) → recovers the turn (not permanently suppressed). | AC2 / major |
| T5 | **Version change re-enables recovery.** | After T2/T3's stable-version calls, change size (append a line) and/or mtime; call again. | A fresh read/recovery happens for the new version (result reflects the new content). | AC3 |
| T6 | **Fail-closed, no throw.** | Fixture with nothing usable even within 2 MB (all lines non-turn / malformed) larger than the tail. | Returns `null`, does not throw; a repeat call still returns `null`. | AC5 |
| T7 | **Eviction bound.** | Drive `> MAX_FALLBACK_GUARD_ENTRIES` (>256) distinct no-turn-in-tail filePaths through the fallback. | `__fallbackGuardSizeForTests()` never exceeds 256 after all inserts; a re-parse of an evicted path issues a fresh fallback (re-inserts). | AC6 |
| T8 | **Concurrency (single result / consistent behaviour).** | No-turn-in-tail (or in-band recoverable) fixture; `await Promise.all([parseTranscript(f), parseTranscript(f)])` on the same file. | Both promises resolve to the same value; ending cache state is a single consistent entry for the version (no torn/duplicate state). | AC2 |

Acceptance criteria:
- **AC1** Fallback read is bounded to `FALLBACK_READ_MAX_BYTES` (2 MB), replacing `Number.MAX_SAFE_INTEGER`.
- **AC2** The bounded read is attempted at most once per transcript file-version; its result (turn or `null`) is re-served on subsequent refreshes of that version. → T2, T3, T4, T8.
- **AC3** A file change (new size/mtime) re-enables a fresh read/recovery. → T5.
- **AC4** In-tail (happy) path is unaffected; guard never consulted, no added cost. *(Covered by the existing `ClaudeTranscriptParser.test.ts` tail-read cases; no new test needed — the guard block is unreachable when the tail yields a turn.)*
- **AC5** `parseTranscript` still returns `null` without throwing when nothing usable exists. → T6.
- **AC6** Guard map growth is bounded by eviction at the cap. → T7.

Coverage target: >80% of the changed lines (fallback block + guard helpers). The existing
`ClaudeTranscriptParser.test.ts` and `.modelOverride.test.ts` continue to cover the
scan/parse and happy-tail paths unchanged.

---

## 9. PLANNED_FILES

> **QG-6 reconciliation.** The version-guard cache was extracted into its own module
> `fallbackGuard.ts` instead of living inside `ClaudeTranscriptParser.ts`. The parser keeps
> only the A–D fallback control flow and calls the module's exported helpers; it also gained
> an optional test-only injected-reader param (`readFn`, defaults to `readRelevantText`) so a
> test can drive the branch-(D) rollback path without spying private internals. Actual files:

| Path | Action | Change |
|---|---|---|
| `src/main/services/claudeStatus/ClaudeTranscriptParser.ts` | modify | Add `FALLBACK_READ_MAX_BYTES` constant; widen `readRelevantText` return to include `size`+`mtimeMs`; add optional test-only `readFn` param to `parseTranscript`; rewrite fallback block (was lines 335–341) to the A–D control flow — check-and-re-serve the cached result (via `getFallbackResult`), insert a provisional entry, do the `FALLBACK_READ_MAX_BYTES` read only on a version miss, `finalizeFallbackResult` only on a completed read, and `rollbackFallbackProvisional` on read failure. |
| `src/main/services/claudeStatus/fallbackGuard.ts` | create | The extracted cache module: `MAX_FALLBACK_GUARD_ENTRIES` + the `fallbackGuard` result-cache Map + `record` (FIFO eviction) + `getFallbackResult` / `recordFallbackProvisional` / `finalizeFallbackResult` / `rollbackFallbackProvisional` + `__resetFallbackGuardForTests` + `__fallbackGuardSizeForTests`. |
| `src/main/services/claudeStatus/fallbackGuard.test.ts` | create | Guard-storage unit tests: provisional→finalise→rollback lifecycle, HIT/MISS by version, FIFO eviction cap (AC6). |
| `src/main/services/claudeStatus/ClaudeTranscriptParser.fallbackGuard.test.ts` | create | Parser-integration behavioural/boundary tests T1–T8 above (real temp `.jsonl` files; branch-(D) via the injected `readFn`; no internal spies). |

No changes to `ClaudeStatusService.ts` or any shared schema — the fix stays within the
parser + its extracted `fallbackGuard.ts` cache module (correct per the "guard in the parser
layer, not the service" decision).

---

## 10. Risks & alternatives considered

| Item | Assessment |
|---|---|
| **Why cache the result, not an attempted-flag** | An "attempted" marker returning `null` on the guard hit makes `runRefresh` call `emitNull` and hide the bar on refresh #2, blanking a just-recovered meter. Caching + re-serving the scanned turn keeps the bar populated with zero re-reads (§3.3). |
| **Why not cache a failed read** | Caching a transient EMFILE/EBUSY failure on a stable version would suppress every later refresh until the next write — one failure permanently hides the bar. Only completed reads are cached; failures roll back and retry next refresh (§3.2 D). |
| **Why parser-side, not service-side** | Multiple terminals share one transcript; keying by PTY/terminal (service-side) would let N terminals each trigger the full read for the same file. File-version keying in the parser dedupes across all consumers — the correct granularity. |
| **Recovery loss beyond 2 MB** | A turn sitting >2 MB from EOF is no longer recovered (old code read the whole file). Accepted trade-off: it only occurs with an enormous compaction summary, and the alternative is the main-thread freeze this issue reports. 2 MB is 8× the tail, comfortably covering realistic compaction summaries. |
| **Main-thread cost of a 2 MB parse** | A worst-case 2 MB no-turn scan is a ~50 ms parse — a single frame drop, taken at most once per file-version, not the sustained multi-second freeze of the old full-file read. |
| **Concurrent refreshes on shared Map** | Single-threaded event loop; the miss-check→provisional-set pair has no intervening `await`, so at most one bounded read per version even with overlapping refreshes, and the failure rollback is version+shape-guarded so it never clobbers a concurrent finalised result (§6.3). |
| **Guard staleness (mtime granularity)** | Change-detection keys primarily on `size`, which strictly grows on the append-only transcript; `mtimeMs` is secondary. A same-size same-mtime collision would require a non-append equal-length rewrite, which the format does not produce — so coarse mtime resolution is not a correctness risk. |
| **FIFO vs LRU eviction** | FIFO-by-first-insert (delete `keys().next().value` at cap) is a conscious accept over LRU: at a 256 cap the recency delta is negligible and FIFO avoids per-hit reordering. |
| **New module singleton** | The mutable module state was extracted at QG-6 into its own `fallbackGuard.ts` (keeping `ClaudeTranscriptParser.ts` free of the cache concern); mitigated by the exported `__resetFallbackGuardForTests` + `__fallbackGuardSizeForTests` hooks (precedent: settings + locator caches) so tests stay isolated. |
| **Rejected: worker-thread the parse** | Larger change, new IPC/worker surface; unnecessary once the read is bounded to 2 MB and de-duplicated. Out of scope for this fix. |

---

### Verification criteria (Phase 8)

- `readRelevantText` returns `size` + `mtimeMs`; no extra `stat`/`fs.open`.
- Fallback issues a read of `FALLBACK_READ_MAX_BYTES`, never `Number.MAX_SAFE_INTEGER`.
- A turn recovered by the bounded read is **re-served** on subsequent refreshes of the same
  version (bar stays populated), and a genuine no-turn version returns `null` — the meter is
  not blanked after a one-shot recovery.
- Repeated refreshes on a stable version do exactly one bounded read; the result is cached.
- A transient read failure is NOT cached; the next refresh retries and can recover.
- A size/mtime change re-enables a fresh read/recovery.
- In-tail path issues no fallback read and leaves the guard empty.
- `parseTranscript` never throws; returns `null` when nothing usable.
- `__fallbackGuardSizeForTests()` stays ≤ 256 under many rotated transcripts.
- `npm run lint && npm run typecheck && npm run test:main` pass.

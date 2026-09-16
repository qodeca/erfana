# Design — Issue #41: Shared model-id parser and context-window capability registry

> Status: IMPLEMENTED, all waves complete. **Revision 6 (2026-08-08).** Rev 1 = post-four-lens-review design (25 findings, §15). Rev 2 = first reconciliation against shipped code. Rev 3 = corrected a wrong capability row (§7.1 Sonnet 4.6), added the §2.0 procedure, recorded the R_ENV withdrawal. Rev 4 = citations and the §7.1 parsing contract. Rev 5 = §12 file plan, §7.2 rule 3 wording, §18 results. **Rev 6 = pre-commit reconciliation: the pre-commit review blocked on this file for contradicting the code in nine places, all in sections guard 1 does not parse.** Corrections carry dated markers.
>
> **Why Rev 6 exists.** Guard 1 parses only §7.1/§7.1.1, so every prose section is unguarded — and nine of them had drifted past the post-lens-review rework (the `modelNativelySupportsExtended` deletion, the `inferred` field, the sanitizer rework, the merged-env fix). A document whose stated job is to be the oracle of record, wrong in the sections nobody checks, is precisely the failure this change set was built to prevent. §18.2 records the structural lesson.
>
> **Citation policy.** Source references name a **file and symbol**, not a line number (decision (i)).
> Issue: https://github.com/qodeca/erfana/issues/41 · Related: #216, #217 (pre-migration issue numbers – the public `qodeca/erfana` tracker renumbered from #1 at the 2026-06 open-source migration, so these resolve to unrelated public issues; treat them as provenance only)
> **Coverage-floor update (2026-09-05)**: the `modelId.ts` per-file floor that §9.5, §12, §14, §15 and §18 describe as INERT has been **active since #55** (its F4 finding moved the `thresholds` block under `test.coverage` in `vitest.main.ts` and added the required `Coverage` CI job) – 95% on lines/functions/branches/statements, enforced on every push. The follow-up issue §16 mentions for live-process probing / `resolvedModel` is [#48](https://github.com/qodeca/erfana/issues/48).

> **Supersedes** the Opus-only registry in [`216-claude-status-bar.md`](216-claude-status-bar.md) §2, §4 and §10.

## 1. Summary

**The bug in plain language.** Erfana's Claude Code context-window meter mis-scales to 200k for models that actually have a 1M window. Three separate pieces of code each try to understand a model id with their own regex, and all three assume the id looks like `claude-opus-4-8`. Current ids look like `claude-opus-5` (no minor segment). Each regex fails differently, so the meter scales to 200k for a 1M model and the label falls back to the raw identifier.

**The fix.** Replace the three regexes with **one shared model-id parser** and **one policy entry point** backed by an **exact-id capability map**, consumed by both the window detector and the friendly-name renderer. After this change the label and the window cannot disagree, because they derive from the same parse.

**What the reviews changed.** The first draft treated the context window as a property of the model id. It is not: it is a function of plan x model x environment (§5). The design now (a) ranks an explicit standard-mode selection above the registry, (b) treats registry-derived 1M as **provisional** — never latched by the sticky bit, (c) surfaces that inference to the user through a structured `inferred` flag (§5.4), (d) replaces the family-threshold scalar with an exact-id map plus a bounded heuristic fallback, and (e) demotes the `[1m]` suffix from "the detection mechanism" to a defensive path, because it does not occur in transcripts at all (§2.2).

The three divergent regexes removed:

| File | Symbol | Pattern | Failure on `claude-opus-5` |
|---|---|---|---|
| `ClaudeWindowDetector.ts` | `OPUS_VERSION_RE` | `/^claude-opus-(\d+)-(\d+)(?:-.*)?$/` | no match → not natively 1M → 200k meter |
| `friendlyModelName.ts` | `GENERIC_PATTERN` | `/^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/` | no match → renders the raw identifier |
| `ClaudeTranscriptParser.ts` | `MODEL_OVERRIDE_ID_RE` | `/^claude-[a-z]+-\d+-\d+(-\d{8})?$/i` | for `/model claude-opus-5[1m]`: sets `forceExtended`, strips `[1m]`, then rejects `claude-opus-5` and returns `undefined` — silently discarding the selection |

## 2. Verification

### 2.0 Re-verification procedure

> **This section exists because its step 3 was skipped on 2026-08-07.** `modelId.ts` (the `CAPABILITIES_VERIFIED_ON` JSDoc) and `modelId.test.ts` (the freshness-test failure message) both cite §2.0, and it did not exist. That absence is the proximate cause of the §7.1 Sonnet 4.6 error: a fetched value contradicted the design table, the code was corrected, the design was not, and the oracle table was edited to agree with the code — the move that converts a caught bug into a silent one.

Run this whenever `CAPABILITIES_VERIFIED_ON` goes stale, whenever a new model id appears in transcripts, or whenever a row is disputed.

**Step 1 — Fetch every URL of record in §2.1.** All six. No page renders a publication stamp, so the recorded date is a *fetch* date.

**Step 2 — For each row, confirm three things in this order.**

1. **Layer** (§2.0.1) — which document governs.
2. **Entitlement** (§2.0.2) — whether the window is the metered default or a conditional upgrade.
3. **Value** — only then, the number.

Confirming the value first is what produces rows that are true of the API and false of the product Erfana meters.

**Step 3 — When a fetched value differs from §7.1, amend the design FIRST.**

> In order: (a) edit the §7.1 row, add an `AMENDED` marker and a dated sentence recording the old value, the new value, and the source that decided it; (b) only then change `EXACT_WINDOWS` in `modelId.ts`; (c) only then re-derive the oracle table in `modelId.test.ts` from the amended §7.1, following §9.4.1.
>
> Never the reverse order. And **never resolve a disagreement between the oracle table and the code by editing the oracle to match the code** — the oracle exists precisely to fail when the two disagree, so editing it converts a caught bug into a silent one. If the code turns out to be right and the design wrong, the design row is still amended first: the remedy is to correct the document, never to bypass it.

**Step 4 — Re-derive, do not re-read.** Regenerate the §9.4 oracle from the amended §7.1/§7.1.1 by §9.4.1. Do not open `modelId.ts` while deriving.

**Step 5 — Bump `CAPABILITIES_VERIFIED_ON`**, record what changed in the Note column, and clear whatever §2.0.4 items the run closes.

#### 2.0.1 Layer precedence

Erfana meters the **Claude Code layer**, not the raw API. Where `code.claude.com` and `platform.claude.com` disagree, **`code.claude.com` governs**: that is the window the CLI budgets and compacts against, and therefore the only number that makes the meter's percentage true. Two §7.1 rows exist solely because of this rule (Opus 4.6 and Sonnet 4.6, both 1M at the API layer and 200k on the CLI layer); `modelId.ts` carries the same rule in the `EXACT_WINDOWS` JSDoc.

#### 2.0.2 Entitlement test

A window is the **metered default** only if it applies with no further condition. A window requiring any of the following is not the default, and the row records the standard window:

- usage credits (Sonnet 4.6's 1M requires them on every plan, including Max),
- a beta header,
- a specific plan tier (Max/Team/Enterprise auto-upgrade),
- an explicit `[1m]` selection.

Conditional upgrades remain reachable at runtime — R2 (observed usage), R1m (an explicit `[1m]` in the id) or R3 (a settings.json `[1m]`) — so recording the conservative default costs an entitled user nothing durable: their session self-corrects, and the correction is *corroborated*, so it latches (§5.3).

#### 2.0.3 Unverified environment names

> **No source file cites this section any more.** It was written for `ClaudeWindowDetector.ts`, whose environment block was deleted with R_ENV. Verified: `SpawnEnvWindowSignals`, `deploymentCapsAtStandard`, `getSpawnEnvWindowSignals` and `R_ENV` have **zero occurrences anywhere in `src/`**. Retained for the follow-up issue, not for a live citation.

Two names were **never confirmed against primary documentation**: `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX`. Should the rule be revived (§16), both must be confirmed against the Claude Code settings/environment reference **before** any code depends on them, and `ANTHROPIC_BASE_URL`'s semantics re-read against §2.0.2: a base-URL override is a *routing* fact, and routing does not establish capacity.

#### 2.0.4 Open provenance items — still open

Every §7.1 window value passed the 2026-08-07 gate, so **no value here is in doubt**. What follows is a **documentation-evidence** gap: these rows carry no verbatim source sentence in this document. **These items survive the closure of #41** — capture the sentence at the next §2.0 run and delete the item.

| Row | Gap | Risk if wrong |
|---|---|---|
| `claude-opus-4-5` | Source (1) supports it as a paraphrase only ("legacy table, 200k"). | Low — a wrong 200k self-corrects via R2 (§7.2 asymmetry). |
| `claude-haiku-4-5` | Same: paraphrase only ("current comparison table, 200k"). | Low, same direction. |
| `claude-haiku-4-5-20251001` | Weakest. Its JSDoc states only that this is "the API ID Haiku 4.5 ships under" — it asserts **no window at all**. The value is **inherited by reasoning** from the undated row. | Low, same direction; the inference is labelled in §7.1. |
| `claude-mythos-5` | Closed by transcription, not by fetch — see its §7.1 Note for the chain of custody. | Low; the value is independent of the code. |

### 2.1 URLs of record

1. `https://platform.claude.com/docs/en/about-claude/models/overview` — per-model context windows
2. `https://platform.claude.com/docs/en/build-with-claude/context-windows` — 1M availability, beta-header requirement, tier gating
3. `https://code.claude.com/docs/en/model-config` — the Claude Code layer
4. `https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5` — Fable 5 / Mythos 5 specs
5. `https://code.claude.com/docs/en/context-window` — CLI compaction boundaries
6. `https://platform.claude.com/docs/en/about-claude/models/whats-new-opus-5` — Opus 5

The gate ran on 2026-08-07; `modelId.ts` records `CAPABILITIES_VERIFIED_ON = '2026-08-07'`.

### 2.2 What the design pass verified first-hand (local, read-only)

| Claim | Method | Result |
|---|---|---|
| No `"model"` value anywhere carries a `[1m]` suffix | `rg '"model":"[^"]*\[1m\]"'` over all transcripts | **Zero matching files.** The `[1m]` form is a selection-time construct that never reaches `message.model`. |
| `resolvedModel` exists and does carry the suffix | `rg '"resolvedModel":"[^"]*"'` | **Present**, e.g. `"resolvedModel":"claude-opus-5[1m]"`. A real, unused signal (§10, alternative c). |
| `claude-fable-5` is in live use | `rg '"model":"claude-fable-5"'` | Present across many unrelated projects. |
| `claude-mythos-5` is in live use here | `rg '"model":"claude-mythos-5"'` | **Not found** locally. Its row rests on documentation, not observation. |
| Bare aliases occur | `rg '"model":"opus"\|"sonnet"'` | 59 occurrences / 35 files, mostly `.meta.json` sidecars the parser never reads. |
| `<synthetic>` is already excluded | `ClaudeTranscriptParser.ts`, `SYNTHETIC_MODEL` guard | Already handled. |
| Erfana strips `CLAUDE_CODE_*` from the terminal env | `TerminalService.cleanEnvironment` | Confirmed — **and strengthened by this change set**: the strip now runs on the *merged* env (§5.2). |
| The tail regex cannot backtrack exponentially | inspection of `(?:-[a-z0-9]+)*` | Linear: the mandatory `-` is excluded from the inner class. |

## 3. Binding product decisions

1. Cover **all** families, not just Opus.
2. Where an id is unknown, a bounded per-family heuristic may extrapolate — §7.2 sets its limits.
3. Keep the "observed usage > 200k" signal (R2). It is **load-bearing**: the sole self-correction for every id the registry resolves to 200k, including every entitled session running a conditionally-upgraded model (§2.0.2).
4. The capability table lives in TypeScript source. No JSON data file, no remote fetch, no user-facing setting. §10 records the alternatives.
5. One shared parser feeding one policy entry point, consumed by both the window detector and the friendly-name renderer.

## 4. Acceptance criteria

| AC | Statement |
|---|---|
| AC1 | A session on `claude-opus-5` shows a 1M-scaled meter from its first reading, before consumption reaches 200k |
| AC2 | A bracketed variant suffix never causes a parse failure, a raw-id label, or an unintended standard-mode downgrade. It is a defensive path, not the detection mechanism (§2.2) |
| AC3 | An unrecognised id from a known family, within the bounded extrapolation limits of §7.2, resolves to that family's applicable known window (unknown ids only) |
| AC4 | Every id present in the exact-id capability map reports exactly its mapped window, for both 200k and 1M entries |
| AC5 | For a model the registry resolves **to 1M**, the reported window is invariant in `usedTokens` across `[0, 199_999, 200_000, 200_001, 250_000]`. A model the registry resolves **to 200k** is invariant only *below* the boundary and **must** flip at it: R2 is a physical fact that outranks the registry |
| AC6 | `claude-opus-5` renders as "Opus 5", not the raw identifier |
| AC7 | An explicit `/model <id>` selection without a 1M marker reports 200k even when the registry would say 1M |

All seven were verified SATISFIED in Phase 9, each with a proving test confirmed to fail if the behaviour broke, and none proven only through a mock.

## 5. The window is not a property of the model id

### 5.1 The premise correction

`window = f(plan, model, environment)`, not `f(modelId)`. Overrides invisible in `message.model`:

| Override | Effect |
|---|---|
| Plan tier (Opus 1M auto-upgrades on Max/Team/Enterprise; Sonnet 4.6's 1M needs credits on every plan) | 1M may or may not be the default |
| Bedrock / Google Cloud Agent Platform / Microsoft Foundry deployment | Opus runs at 200K |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` | every session capped at 200K |
| LLM gateway via `ANTHROPIC_BASE_URL` | may budget a 1M model at 200K |

Nothing demotes a window at runtime, so an over-statement persists for the session. That asymmetry governs every default in §7 and is why §2.0.2 records the conservative value.

### 5.2 What Erfana can observe, and the withdrawal of R_ENV — `AMENDED 2026-08-08`

> **R_ENV was removed.** Verified: zero occurrences of `SpawnEnvWindowSignals`, `deploymentCapsAtStandard`, `getSpawnEnvWindowSignals` or `R_ENV` anywhere in `src/`. A mitigation that was designed and shipped was taken out, not delivered.

`TerminalService.cleanEnvironment` strips `/^CLAUDECODE$/` and `/^CLAUDE_CODE_/` from the environment handed to every spawned terminal (nested-session suppression). `ANTHROPIC_*` is kept intentionally.

**This change set strengthened that strip, and finding 1 below depends on the strengthening.** Before #41 the exclusion ran on `process.env` alone and the caller-supplied `config.env` — which arrives over the `terminal:create` IPC payload — was merged in *afterwards*, so a caller could re-add the very names the list exists to remove. `cleanEnvironment` is now called as `cleanEnvironment({ ...process.env, ...config.env })`, making the guarantee hold for both halves. Rev 3 asserted the merged-env behaviour as though it were pre-existing; it was not, and the audit that found the gap is part of this change (`TerminalService.ts`, plus its env test in `TerminalService.test.ts`).

Four verified findings retired the rule:

1. **Three of its four signals were unreachable** — given the strengthened strip above, `CLAUDE_CODE_DISABLE_1M_CONTEXT`, `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX` cannot reach a spawned terminal by either path. A user who exports them from `.zshrc` has them re-added by the login shell for `claude`, where Erfana never sees them.
2. **The surviving signal proved the wrong thing.** `ANTHROPIC_BASE_URL` is a **routing** fact, not a **capacity** fact.
3. **It outranked explicit user configuration.** R_ENV sat above R0 and R3, inverting the principle that an explicit configuration is not a guess.
4. **It introduced a layering violation.** A core service had to export state for a feature module.

The authoritative alternative — reading the live `claude` process environment — remains **macOS-only** (`ps -p <pid> -Eww`); Windows' `Get-CimInstance Win32_Process` does not expose the environment block. Deferred (§16).

**Consequence:** the mitigation for deployment-driven over-statement is now entirely (b) provisional-not-latched (§5.3) and (c) the inferred marker (§5.4). See R9.

### 5.3 Provisional versus corroborated windows

A 1M verdict is **corroborated** when it rests on an observed or explicit signal: `usedTokens > 200_000` (R2), an explicit `/model …[1m]` this session (R0), a recognised `[1m]` in the id itself (R1m), or a settings.json `[1m]` (R3). It is **provisional** when it rests only on the capability registry (R1).

**The sticky bit latches only corroborated 1M** (`ClaudeStatusService.resolveWindow`). Provisional 1M is recomputed every refresh, so an explicit standard selection (R0'), or a model switch, takes effect immediately.

**Honest limit:** this bounds the damage; it does not self-heal. A wrong table row still reports the wrong window on every refresh. Only an authoritative signal could self-heal that, which is why §7.4's expiry test and §9.4's oracle exist.

### 5.4 Surfacing the inference to the user — `REWRITTEN 2026-08-08`

> **Rev 5 said "main-process text only — `ClaudeStatusBar.tsx` renders `snapshot.tooltip` verbatim". That described the design this section's own rework replaced,** and it was the section that owns the marker. Corrected below against the shipped code.

The window badge is an inference whenever it is provisional, and the user is told so. Two carriers, deliberately:

1. **`tooltip`** — composed in `ClaudeStatusService` and carrying a trailing `" (inferred)"` when the window is provisional. The renderer uses this **verbatim for the visual `title`**, so hover text is unchanged in shape.
2. **`inferred: boolean`** — a **required field on `ClaudeStatusSnapshot`** (`claude-status-schema.ts`), set from `resolveWindow`'s structured result. It is not merely a duplicate of the tooltip suffix.

**Why both.** The renderer builds the meter's `aria-valuetext` by reformatting the tooltip's counts (`"84k / 200k"` → `"84k of 200k tokens"`). Reusing the tooltip string wholesale put the marker mid-sentence — `"84k of 1M (inferred) tokens"` — which reads as broken grammar to a screen-reader user. So `ClaudeStatusBar.buildValueText` **strips `INFERRED_MARKER` from the tooltip**, reformats the counts, and **re-places the marker after the noun** using the structured `inferred` flag. One presentation string for sighted hover, one grammatical composition for assistive technology, from one source of truth in main.

This is why `inferred` is structured rather than left implicit in the tooltip text: a renderer that has to *parse* a marker out of prose to know a boolean is a renderer that will eventually parse it wrong.

**Scope note:** this makes the issue **not** zero-UI-impact. It changes user-visible text and `aria-valuetext`, though not layout; the status bar does not appear in any visual-regression baseline (it renders only while `claude` runs).

## 6. Module — `src/main/services/claudeStatus/modelId.ts`

Pure module: no I/O, no logging, no Electron. Named exports only.

### 6.1 Public API

```ts
export interface ParsedModelId {
  family: string; major: number; minor: number
  minorOmitted: boolean          // drives "Opus 5" vs "Opus 5.0" (AC6)
  date?: string                  // trailing 8-digit snapshot date
  variants: readonly string[]    // lower-cased bracket tokens (max 4)
  canonicalId: string
}

export function parseModelId(raw: string): ParsedModelId | null
export function stripModelVariants(raw: string): { base: string; variants: readonly string[] } | null
export function stickyModelKey(raw: string): string
export function isRecognisedVariant(token: string): boolean
export function isExtendedVariant(token: string): boolean
export function familyAlias(raw: string): string | null

/** THE single window-policy entry point. `null` = no opinion. Never throws. */
export function windowForModelId(raw: string): 200000 | 1000000 | null

export const CAPABILITIES_VERIFIED_ON: string

/** Registry KEY SET only — never the values. Exists solely for §9.4.2 guard 2. */
export const REGISTRY_IDS_FOR_TESTS: readonly string[]
```

**Module-private:** the exact-id map, the family heuristic table, the undecomposable-id map, the recognised-variant set, and `EXTENDED_VARIANT`. `REGISTRY_IDS_FOR_TESTS` is the one deliberate exception, and it is exactly the line §9.4.2 draws: **ids are coverage, windows are expectations.**

`MAX_MODEL_ID_LENGTH` lives in `src/shared/ipc/claude-status-schema.ts`, so one bound governs the Zod schema and the parser.

### 6.2 Grammar and the label rule

```
^claude-([a-z]+)-(\d+)(?:-(\d+))?((?:-[a-z0-9]+)*)$
   family      major     minor       tail (snapshot date and/or unknown segments)
```

- **Major required** → `claude-opus`, `claude-opus-x-y` stay unparseable.
- **Minor optional** → `claude-opus-5` parses with `minor = 0, minorOmitted = true`. This is the bug.
- **Tail tolerated.** A tail segment of **exactly eight digits** is the snapshot date; any other trailing segment is unknown, accepted and then **dropped**.
- **Linear by construction**: the mandatory `-` delimiter is excluded from the tail class.
- `canonicalId` = `claude-<family>-<major>-<minor>` plus the date when there is one. `claude-opus-5` and `claude-opus-5-0` share the canonical form `claude-opus-5-0`. `stickyModelKey` drops the date (decision (b)).

**Label rule** (what §7.1's Label column is computed from, and the only definition of record): title-case the family, then `Major` when the id omits the minor, or `Major.Minor` when it supplies one; drop the date, any unknown tail segment, and any variants. `claude-opus-5` → `Opus 5`; `claude-haiku-4-5-20251001` → `Haiku 4.5`. An id the grammar cannot decompose has no derivable label and falls back to the sanitized raw id.

### 6.3 Bare aliases

`"model":"opus"` occurs in main transcripts (rarely). An alias yields a **label** (its title-cased family, via `familyAlias`) but **no window opinion**. `<synthetic>` is rejected upstream.

## 7. Capability data

### 7.1 Exact-id map — primary lookup

**Parsing contract for guard 1.** This table is machine-parsed **column-indexed**: split each row on `|` and read the **Window** field by its column position. A guard must **never line-scan for a window-shaped number**, because Note cells legitimately contain them — the Sonnet 4.6 row quotes the superseded value `1000000` in prose, and that row is **retained deliberately as a canary**. Id, Window and Label cells are written **unemphasised and unadorned**; all emphasis belongs in Note. The Label column is derived from the §6.2 label rule **by hand, from the id**, never by reading `friendlyModelName.ts`.

| Id | Window | Label | Source | Note |
|---|---|---|---|---|
| claude-opus-4-5 | 200000 | Opus 4.5 | (1) | Legacy comparison table. **Paraphrase only — no verbatim sentence captured** (§2.0.4). |
| claude-opus-4-6 | 200000 | Opus 4.6 | (3)(5) | **Plan-conditional default, not a ceiling.** Max/Team/Enterprise auto-upgrade Opus to 1M and the API layer lists 4.6 at 1M, but the metered CLI default is 200K: 4.6 is excluded from "Opus 4.7 and later always run with the 1M window", and per (5) "Sonnet 4.6 and Opus 4.6 without extended context compact at the 200K boundary". An entitled session self-corrects once usage crosses the standard window, and that correction is corroborated (R2), so it latches. |
| claude-opus-4-7 | 1000000 | Opus 4.7 | (3) | "Opus 4.7 and later always run with the 1M window". |
| claude-opus-4-8 | 1000000 | Opus 4.8 | (1)(3) | Covered by "Opus 4.7 and later". |
| claude-opus-5 | 1000000 | Opus 5 | (6) | The **AC1** acceptance case. "1M tokens is both the default and the maximum". |
| claude-sonnet-4-5 | 200000 | Sonnet 4.5 | (2) | "Claude Sonnet 4.5 … 200k-token context window". |
| claude-sonnet-4-6 | 200000 | Sonnet 4.6 | (3)(5) | **CORRECTED 2026-08-08 — this row read `1000000` and was wrong.** 1M at the API layer, but on the metered CLI layer Sonnet 4.6 is "not part of the automatic upgrade and requires usage credits on every subscription plan, including Max", and per (5) it "compact[s] at the 200K boundary" without extended context. Provenance of the error: the original value was **transcribed from the four-lens review rather than fetched**; the §2.1 gate caught it and the code shipped the standard window correctly, but §2.0 step 3 did not exist, so this row never followed. The oracle was then edited to agree with the code — the precise failure §2.0 step 3 now prohibits. The quoted numeral above is the canary named in this table's parsing contract. |
| claude-sonnet-5 | 1000000 | Sonnet 5 | (3) | "No 200K variant, no `[1m]` suffix to select, and no usage credits required on any plan." |
| claude-haiku-4-5 | 200000 | Haiku 4.5 | (1) | Current comparison table. **Paraphrase only — no verbatim sentence captured** (§2.0.4). |
| claude-haiku-4-5-20251001 | 200000 | Haiku 4.5 | (1) | Pinned snapshot kept as its own key so a dated id resolves without falling through; label drops the date per §6.2. **The window is inherited by reasoning from the undated row, not separately cited** (§2.0.4). |
| claude-fable-5 | 1000000 | Fable 5 | (4) | "A 1M token context window by default." |
| claude-mythos-5 | 1000000 | Mythos 5 | (2)(4) | **Window-fixing citation, source (2):** "claude-fable-5 and claude-mythos-5 also have a 1M-token context window" — the sentence names this id explicitly. **Chain of custody:** captured at the 2026-08-07 gate and recorded in this entry's JSDoc; this document's copy is **transcribed from that record, not independently fetched** (§2.0.4). The *value* is independent of the code, so guard 1 is unaffected. Separately: this id is decomposable, so §7.1.1 would **not** catch it. |

Lookup is dated-canonical-id first, then the undated alias (`exactWindowFor`). Keys are canonicalised on load (`buildExactLookup`).

### 7.1.1 Undecomposable-id map

| Id | Window | Label | Source | Note |
|---|---|---|---|---|
| claude-mythos-preview | 1000000 | claude-mythos-preview | (2) | "Claude Mythos Preview also has a 1M-token context window." The label is the **raw id**: `preview` is not a generation, so §6.2's rule has nothing to derive from and the sanitized fallback is correct, not a defect. |

Implemented as a `Map`, not an object literal (`UNDECOMPOSABLE_WINDOWS`): the key is untrusted transcript text, and an object literal would answer `constructor` / `__proto__` from `Object.prototype`.

### 7.2 Family heuristic — fallback for UNKNOWN ids only

A single monotonic scalar per family cannot represent the real lineup, and the true counterexample is stronger than a cross-family one: the class boundary sits *inside* a major generation. `claude-opus-4-6` is 200k while `claude-opus-4-7` is 1M — same family, same major, different class.

```ts
interface FamilyHeuristic {
  newestKnownMajor: number
  newestKnownWindow: Window
  newestByMajor: ReadonlyMap<number, { minor: number; window: Window }>
}

const MAX_MAJOR_LOOKAHEAD = 1
const MAX_MINOR_LOOKAHEAD = 4
```

Resolution order (`heuristicWindowFor`), reached **only** when the exact map misses:

1. **Known major, unknown point release.** If the id's major is in `newestByMajor`, inherit that **major's** newest known window when `minor >= knownMinor` and `minor <= knownMinor + MAX_MINOR_LOOKAHEAD`.
2. **Older point release** (`minor < knownMinor`) → `null`.
3. **Unknown major, strictly ahead and at most one generation on.** The test is **one-sided**: `major > newestKnownMajor && major <= newestKnownMajor + MAX_MAJOR_LOOKAHEAD`. **A major below the newest known never inherits** — it falls to no-opinion, and R2 remains its only route to 1M.
4. **Further out, or an unknown family** → `null`.

**Why both bounds, and why asymmetric.** Observation can only *upgrade* a window (R2 fires above 200k), never demote one. A wrong 200k self-corrects; a wrong 1M persists for the session. Every unbounded extrapolation axis is a way to manufacture a wrong 1M, so each needs its own ceiling. Minor gets the looser bound (4 vs 1) because point releases within a major have usually shared a window — though Opus 4.6 → 4.7 shows even that is not guaranteed.

#### 7.2.1 The per-major map decides first

`newestByMajor` is consulted **before** `newestKnownWindow`, and when the id's major is present it **decides**: rule 1 returns unconditionally. The family-wide field only ever answers for an id whose major is entirely unknown.

**Worked counterexample.** For `sonnet`, `newestByMajor` holds major 4 → `{ minor: 6, window: 200000 }` and major 5 → `{ minor: 0, window: 1000000 }`. An unknown `claude-sonnet-4-7` resolves through **major 4** and reports **200000**, even though the family's newest known entry is 1M. **"Inherits that family's newest known window" is therefore a wrong summary** — right only for the unknown-major case.

### 7.3 Why not a scalar threshold per family

The threshold form encodes "capability increases monotonically with generation and uniformly within a family". §7.2's Opus 4.6/4.7 boundary falsifies uniformity *within a major*.

### 7.4 Freshness

- `CAPABILITIES_VERIFIED_ON`, set by the §2.0 procedure.
- Per-entry JSDoc `@see <sourceUrl>` on every exact-map row.
- A unit test that **fails once `CAPABILITIES_VERIFIED_ON` is more than 180 days old**, naming all six §2.1 URLs and pointing at §2.0.

## 8. Decision tree — window sizing

First match wins. Order matches `detectWindowDetail`: **R2 → R0 → R0' → R1m → R1 → R3 → R4.** The shipped `WindowRule` union is exactly `'R2' | 'R0' | 'R0prime' | 'R1m' | 'R1' | 'R3' | 'R4'`.

| # | Rule | Outcome | Corroborated? | I/O |
|---|---|---|---|---|
| R2 | `usedTokens > 200_000` — a **physical fact**, not a policy claim | 1M | yes | none |
| R0 | `forceExtended === true` (fresh `/model …[1m]`) | 1M | yes | none |
| R0' | `forceStandard === true` (explicit `/model <id>` with no 1M marker) | 200k | n/a | none |
| R1m | The id itself carries a recognised `1m` variant, checked **before** R1 because `windowForModelId` collapses "the id says 1M" and "the registry says 1M" into one value | 1M | yes | none |
| R1 | Exact-id map or bounded family heuristic returning 1M | 1M | no (provisional) | none |
| R1 (200k) | Exact map or heuristic returning 200k — **deliberately does not short-circuit**, so R3 can still upgrade it | falls through to R3 | — | none |
| R3 | settings.json `model` contains `[1m]` — explicit user configuration | 1M | yes | one TTL-cached read |
| R4 | otherwise | 200k | n/a | — |
| R5 | *(service)* sticky bit — latches only a **corroborated** 1M | holds 1M | — | none |

R2 sits first because a 200k window physically cannot hold more than 200k tokens. R1 can return **200k**, which the pre-#41 registry never could: an exact 200k entry is an *answer*, not a fall-through — that is what gives AC4 a mechanism and what makes R1-before-R3 correct.

### 8.1 R1m and the "explicit configuration is not a guess" principle — `AMENDED 2026-08-08`

Rev 2 recorded a divergence: the shipped code folded a recognised `1m` variant into R1 and reported it as provisional. **The recommended amendment was applied.** `detectWindowDetail` now returns `{ windowSize: EXTENDED_WINDOW, corroborated: true, rule: 'R1m' }`.

> **Correction.** Rev 2–5 claimed `WindowRule` is "module-internal … so no schema, preload or renderer change followed". **Both halves are false.** `WindowRule` is an **exported type** (`ClaudeWindowDetector.ts`) and is imported by `ClaudeStatusService`, which threads it through `resolveWindow`'s return. And a **schema change did follow** — not from `WindowRule` itself, but from the same rework: `ClaudeStatusSnapshot` gained the required `inferred: z.boolean()` (§5.4), plus `MAX_TOOLTIP_LENGTH` and a bound on `friendlyName`. The renderer changed too. What remains true is the narrower claim: **the rule *identifier* never crosses the IPC boundary** — it feeds the `inferred` computation and a debug log, and `inferred` is what ships.

The R1m path remains **unreachable in the observed corpus** (§2.2). It is kept correct rather than merely untested, and pinned with `claude-sonnet-4-5[1m]` — a model whose exact-map row is 200k, so the assertion can only pass via the variant branch.

### 8.2 Plumbing `forceStandard`

`forceStandard` (R0') rides in `opts` rather than as a positional parameter. With R_ENV withdrawn, `opts.env` and `SpawnEnvWindowSignals` went with it.

The call is **unconditional**. An earlier draft made the four-argument call conditional to preserve a three-argument shape three tests asserted on; that branch was deleted as quality finding M1, because `detectWindowDetail` reads `opts?.x` throughout. Production control flow must not be a function of how mocks are asserted on.

## 9. Test strategy

### 9.1 `modelId.test.ts`

| Group | Shapes |
|---|---|
| accepts | `claude-opus-5`, `claude-opus-4-8`, `claude-haiku-4-5-20251001`, `claude-opus-5[1m]`, `claude-opus-5-20260101[1m]`, `CLAUDE-OPUS-4-8`, `  claude-opus-5  `, `claude-fable-5`, `claude-opus-10-12`, `claude-opus-5-0-2026` |
| rejects | `''`, `claude-opus`, `claude-opus-x-y`, `claude-foo`, `claude--5`, `gpt-4o`, `totally-bogus-id`, `default`, `claude-mythos-preview`, `claude-opus-5[`, `claude-opus-5[1m`, `claude-opus-5[1m]x`, `claude-opus-5[1-m]`, `claude-opus-5[]`, a 65-char id, `undefined as unknown as string` |
| boundary, minor omitted | `claude-opus-4` → no opinion; `claude-opus-3` → no opinion; label `Opus 4` |
| variants | `[1m]` recognised; `[thinking]` unrecognised; `[1m][beta]` mixed; `[1M]` case; cap of 4 tokens; `claude-opus-5\t[1m]` → trimmed base |
| heuristic bounds | one major past newest known → inherits; two past → `null`; a major *below* the newest known → `null` (§7.2 rule 3); `claude-opus-4-9` → inherits; `claude-opus-4-99` → `null`; `claude-opus-5-4` inherits and `claude-opus-5-5` → `null`; `claude-sonnet-4-7` → 200000 (§7.2.1) |
| unknown tail | `claude-opus-5-0-2026` canonicalises to `claude-opus-5-0` and hits the **exact map** (decision (d)) |
| regex linearity | tail character class contains no `-` |
| freshness | fails when `CAPABILITIES_VERIFIED_ON` is >180 days old |
| cap position | over-length input performs **no** length-proportional string work (§9.1.1) |

#### 9.1.1 The cap's position, not just its existence

The 256 KB payload test asserting `stripModelVariants(hostile) === null` does **not** prove the cap fired first: with the cap deleted, the `MAX_VARIANT_TOKENS` guard returns `null` after four loop iterations anyway. The discriminating observable is that for an over-length input, **no length-proportional string primitive runs at all**. Spy on `String.prototype.trim` and `String.prototype.indexOf`, capture both call counts into plain numbers before `mockRestore()` and before any `expect`, assert both are `0` and the return is `null` — with a **positive control** in the same test asserting both counts are `>= 1` for a valid at-length id, without which a mis-wired spy passes vacuously.

### 9.2 Existing assertions that changed — `AMENDED 2026-08-08`

> **Two corrections.** (a) The three Sonnet 4.6 entries were written when §7.1 wrongly carried that id at the extended window; no Sonnet assertion flipped, because the shipped registry reports 200k — the same value the pre-#41 detector produced, since it had no Sonnet branch at all. (b) **The `modelNativelySupportsExtended` row below is historical, not current:** that assertion flipped during the change, and the function was then deleted in the post-lens-review rework, so the surviving test asserts `windowForModelId(id) === EXTENDED_WINDOW` instead. Rows are **kept rather than deleted** — §9.2 exists so a reviewer can confirm which pre-existing assertions changed, and silently shortening the list defeats that check.

| Location | Before | After | Action |
|---|---|---|---|
| `ClaudeWindowDetector.test.ts` — `claude-opus-4-6` → 1M | 1M | 200k | **Flipped** (F5). |
| `ClaudeWindowDetector.test.ts` — the Opus 4.6 boolean predicate | true | false | **Flipped** (F5), then **rehomed**: the predicate `modelNativelySupportsExtended` was deleted and the case now reads `windowForModelId('claude-opus-4-6') === EXTENDED_WINDOW`. |
| `ClaudeWindowDetector.test.ts` — `claude-sonnet-4-6` → 200k | 200k | 200k | **No change.** Predicted flip did not occur; §7.1 was wrong, the test was right. |
| `ClaudeWindowDetector.test.ts` — Sonnet not auto-1M | false | false | **No change.** |
| `ClaudeWindowDetector.test.ts` — "200k-family, low usage" using `claude-sonnet-4-6` | 200k | 200k | **No change.** The predicted fixture swap was unnecessary. |
| `friendlyModelName.test.ts` — `claude-opus-5-0-2026` → raw | raw | `'Opus 5.0'` | **Flipped** (decision (d)). |
| `friendlyModelName.test.ts` override table | 7 cases | identical outputs via generic derivation | Kept as pins. |
| `ClaudeTranscriptParser.test.ts` `/model …[1m]` cases | `modelId: 'claude-opus-4-7'` | unchanged | No change. |
| three `detectWindowSize` arity assertions | 3-arg | 4-arg | Updated per §8.2 (M1). |

### 9.3 AC mapping

| AC | Assertions |
|---|---|
| AC1 | `windowForModelId('claude-opus-5')` is the extended window; `detectWindowSize` likewise, with a real `{model:'opus'}` temp settings.json and spies on **both `fs.readFile` and `fs.stat`** asserting zero calls (an absent-path spy could never fail). |
| AC2 | `friendlyModelName('claude-opus-5[1m]') === 'Opus 5'`; `windowForModelId('claude-opus-5[1m]') === windowForModelId('claude-opus-5')`; a test named `unreachable-in-practice` records the §2.2 evidence. |
| AC3 | one major past newest known inherits; two past → `null`; a lower major → `null`; one point release past inherits; five past → `null`. |
| AC4 | a sweep asserting every §7.1 row reports exactly its mapped window, 200k rows included. |
| AC5 | invariance sweep for `claude-opus-5`; **plus** the negative pin proving a registry-200k model and an unknown id both still flip at the boundary. |
| AC6 | `'claude-opus-5'` → `'Opus 5'`; `'claude-opus-5-0'` → `'Opus 5.0'`; `'claude-sonnet-5'` → `'Sonnet 5'`. |
| AC7 | `/model claude-opus-5` → `modelForcedStandard`, snapshot reports 200k despite the registry saying 1M; R0 still outranks R0'. |

### 9.4 The cross-module oracle

A hand-authored `ReadonlyArray<[id, expectedWindow, expectedLabel]>` (`REGISTRY_ORACLE` in `modelId.test.ts`) whose expectations are written from §7.1/§7.1.1 and **never computed from `modelId.ts`**. **This is the artefact that failed on 2026-08-07** — it was edited to agree with the code on Sonnet 4.6 instead of being left to fail.

#### 9.4.1 Re-derivation procedure

1. Open **this document only**. Do not open `modelId.ts` while deriving.
2. Transcribe Id and Window cells verbatim, **by column index**.
3. Compute each Label **from the id** using §6.2. Do not copy it from `friendlyModelName.ts`.
4. Append the non-registry rows the oracle carries — heuristic no-opinion cases and a foreign-vendor id.
5. Run the suite. **If it fails, the first hypothesis is that the code is wrong**, and §2.0 step 3 governs.

#### 9.4.2 What is, and is not, mechanically checkable

**Not checkable: provenance.** No guard can verify that a human or agent did not read `modelId.ts` while writing the oracle.

**Governing rule:** *coverage may be derived from the implementation; expectations may not.* `REGISTRY_IDS_FOR_TESTS` exports ids and never windows for exactly this reason.

1. **Document-parity guard** — parses §7.1 and §7.1.1 out of this markdown file and asserts row-for-row agreement with the oracle. Reads **the document**, never `modelId.ts`. Parser in `__fixtures__/designCapabilityTable.ts`.
2. **Key-set guard** — asserts `REGISTRY_IDS_FOR_TESTS` equals the id column of §7.1 plus §7.1.1, and equals the oracle's id column.

**Known limit, and the reason Rev 6 was necessary:** guard 1 parses **only §7.1 and §7.1.1**. Every other section of this document is unguarded prose, and nine of them drifted (§18.2).

#### 9.4.3 Derivation record

Independently re-derived on 2026-08-08 from Revision 3, with `modelId.ts`, `friendlyModelName.ts`, `ClaudeWindowDetector.ts` and both test files excluded and the exclusion audited. **The derived table matched the shipped registry on every row**, including `claude-sonnet-4-6` at 200000. Revisions 4–6 change no window value, so the derivation remains valid — verifiable by diffing the Window column.

### 9.5 Coverage

The `modelId.ts` per-file floor exists in `vitest.main.ts` and was **INERT at the time of writing**: the whole `thresholds` block sat under a top-level `coverage:` key, a sibling of `test:`, and vitest reads coverage options from `test.coverage`. Nothing in that block applied — including four pre-existing whisper trust-chain floors dormant since they were added. **User-deferred** then: relocating it would activate all five at once, and the four whisper floors failed. *Superseded (2026-09-05)*: #55 (F4) moved the block under `test.coverage` and the `Coverage` job now enforces the `modelId.ts` floor at 95% on every metric (see `docs/ci.md`).

**To enforce later:** move the `coverage` object under `test.coverage`, then either raise the four whisper modules to their declared floors or adjust those floors to measured values in the same change.

Coverage is in any case a weak oracle for a data table: the pre-correction table would have been 100% covered and still wrong about Sonnet 4.6.

### 9.6 Shared harness — `AMENDED 2026-08-08`

`makeHarness` lives in `__fixtures__/claudeStatusHarness.ts` and is imported by both service test files. Its `detectWindowSize` stub **delegates to the real `windowForModelId`** — Rev 5 said `modelNativelySupportsExtended`, which no longer exists. The reason is unchanged and is stated in the fixture's own JSDoc: a hand-rolled copy of the registry rule would let a mock and the registry drift apart, so the harness would keep passing while testing a different system.

## 10. Alternatives considered

| Option | Freshness | Offline | Privacy | Verdict |
|---|---|---|---|---|
| **(a) Static TypeScript table (chosen)** | Stale between releases; needs §7.4's expiry test and §2.0's procedure | Perfect | No egress | **Chosen.** Zero new failure modes on a display-only meter. |
| (b) Models API cached to disk, static table as fallback | Authoritative, self-updating | Needs the fallback anyway | Requires an API key and outbound requests for a cosmetic meter | Rejected for this issue; best long-term answer. |
| (c) `resolvedModel` transcript field / statusline | Authoritative per session; verified present locally (§2.2) | Perfect | No egress | Rejected now; strongest cheap follow-up (§16). |

## 11. Security — `AMENDED 2026-08-08`

- **Length cap at the entry of `stripModelVariants`** (first statement), variant token count bounded to 4, `arg` capped in `modelOverrideFromRecord` before the call. `arg` originates in a transcript `<command-args>` block bounded only by the 256 KB tail window, and the caller runs synchronously on the main-process event loop ~1x/1.25 s per terminal. Position pinned by §9.1.1.
- **`sanitizeModelId`** (`friendlyModelName.ts`, **exported**) — the single sanitizer for untrusted model text. Reworked during this change set in three ways Rev 5 never recorded:
  - **Character class widened** beyond C0/C1 controls to cover **zero-width and bidirectional** code points (`U+200B–U+200F`, `U+202A–U+202E`, the bidi isolates `U+2066–U+2069`, and the BOM `U+FEFF`). These are invisible but reorder rendered text, so a crafted id can be made to *read* as a different model in the status bar and its accessible name. A meter that can be made to display the wrong model is worse than one that displays nothing.
  - **`SANITIZE_SCAN_LIMIT` = `MAX_MODEL_ID_LENGTH * 8`** bounds how much of an untrusted id is *scanned*, before the character-class replace. Scanning and copying the whole string before truncating made the cost linear in attacker-controlled input, on the event loop, once per refresh. Deliberately a multiple of the length bound rather than the bound itself: slicing to 64 first would let a 64-character invisible prefix push a legitimate id out of the window entirely — a different bug.
  - **Exported and reused**: `ClaudeStatusService` applies the same function to the raw `modelId` it puts on the wire, so the snapshot's `modelId` and `friendlyName` cannot diverge in what they consider safe.
- **Bounds at the IPC boundary** (`claude-status-schema.ts`): `modelId` and `friendlyName` are each `z.string().max(MAX_MODEL_ID_LENGTH)`, and `tooltip` is `z.string().max(MAX_TOOLTIP_LENGTH)` (128) — the tooltip is composed in main and is longer than an id, so it needs its own bound rather than sharing one.
- **ReDoS**: the tail group cannot backtrack exponentially — the mandatory `-` delimiter is excluded from `[a-z0-9]`. The length cap is defence-in-depth, not the ReDoS mitigation.
- **Trim preserved**: `claude-opus-5\t[1m]` cannot put a control character into `snapshot.modelId`.
- **Untrusted keys**: §7.1.1's map is a `Map`, not an object literal.

## 12. File plan — `AMENDED 2026-08-08`

> **Rev 5 claimed §12 was "matched to the 28-file change set" while listing 15.** That unqualified false claim, in the document whose job is reconciliation, is withdrawn. Below is what I verified directly by globbing and grepping the tree. Doc-file rows were previously omitted because Phase 10 was scoped to own them; they are listed here for completeness and marked as such. Line counts are as shipped where measured.

### Production — main

| Path | Action | What changed |
|---|---|---|
| `claudeStatus/modelId.ts` | create — **500 lines** | Grammar, exact-id map, undecomposable map, family heuristic, `windowForModelId`, `CAPABILITIES_VERIFIED_ON`, `REGISTRY_IDS_FOR_TESTS`. |
| `claudeStatus/ClaudeWindowDetector.ts` | modify — **299 lines** | Old regexes deleted. **`modelNativelySupportsExtended` was deleted**, not rewritten: the detector calls `windowForModelId` directly. Adds R0', R1m, and `detectWindowDetail` returning `{ windowSize, corroborated, rule }`. `SpawnEnvWindowSignals`, `deploymentCapsAtStandard`, `opts.env` and `R_ENV` all removed. |
| `claudeStatus/friendlyModelName.ts` | modify | `OVERRIDES` and `GENERIC_PATTERN` deleted; renders from `parseModelId`; alias labels. **`sanitizeModelId` renamed and exported, character class widened, `SANITIZE_SCAN_LIMIT` added** (§11). |
| `claudeStatus/ClaudeTranscriptParser.ts` | modify | `MODEL_OVERRIDE_ID_RE` and the manual strip deleted; `arg` capped; unrecognised variants reject the override. |
| `claudeStatus/ClaudeStatusService.ts` | modify — **551 → 639** | Sticky key via `stickyModelKey`; corroborated-only latching; `resolveWindow` extraction; unconditional four-argument call; **`inferred` on the snapshot**; `sanitizeModelId` applied to the wire `modelId`. |
| `services/TerminalService.ts` | **modify — IS in the change set** | `cleanEnvironment` now runs on the **merged** env (`{ ...process.env, ...config.env }`), closing a bypass where the IPC-supplied half could re-add the stripped names. Rev 5 struck this row through as "not in the change set" — wrong, and **§5.2's whole R_ENV-withdrawal argument depends on this change**. |

### Shared and renderer

| Path | Action | What changed |
|---|---|---|
| `shared/ipc/claude-status-schema.ts` | modify | `MAX_MODEL_ID_LENGTH`; **`MAX_TOOLTIP_LENGTH`**; bounds on `modelId`, `friendlyName`, `tooltip`; **required `inferred: z.boolean()`** (§5.4). |
| `renderer/…/ClaudeStatusBar.tsx` | modify | Consumes `inferred`; strips `INFERRED_MARKER` from the tooltip and re-places it after the noun when composing **`aria-valuetext`** (§5.4). |

### Test and fixtures

| Path | Action |
|---|---|
| `claudeStatus/modelId.test.ts` | create — **767 lines**: §9.1 shapes, §9.1.1 cap-position test, `REGISTRY_ORACLE`, both §9.4.2 guards |
| `claudeStatus/__fixtures__/designCapabilityTable.ts` | **create — 173 lines.** The column-indexed parser backing guard 1. Reads §7.1/§7.1.1 out of *this document*, never `modelId.ts`. A **fixture, not a test file**: no `.test.` in the name, so vitest does not collect it, following `claudeStatusHarness.ts`. Keeping it out of the test file also stops it drifting into a helper that could quietly start importing the registry. |
| `claudeStatus/__fixtures__/claudeStatusHarness.ts` | create — shared `makeHarness` (§9.6) |
| `claudeStatus/ClaudeWindowDetector.provenance.test.ts` | create — **renamed from `ClaudeWindowDetector.envCap.test.ts`** during the R_ENV removal; holds the rule-provenance sweep only. Leaving a file named `envCap` with zero env-cap tests would have been the same name-contradicts-contents defect the reviews caught elsewhere. |
| `claudeStatus/ClaudeTranscriptParser.modelOverride.test.ts` | create |
| `claudeStatus/ClaudeStatusService.stickyWindow.test.ts` | create |
| `claudeStatus/ClaudeWindowDetector.test.ts` | modify — §9.2 changes; registry cases rehomed onto `windowForModelId` |
| `claudeStatus/friendlyModelName.test.ts` | modify |
| `claudeStatus/ClaudeStatusService.test.ts` | modify — imports the shared harness |
| `services/TerminalService.test.ts` | modify — merged-env strip test |
| `shared/ipc/claude-status-schema.test.ts` | modify — `inferred` and the new bounds |
| `renderer/…/ClaudeStatusBar.test.tsx` | modify — `aria-valuetext` placement |
| `renderer/…/stores/useClaudeStatusStore.test.ts` | modify — `inferred` in fixtures |
| `vitest.main.ts` | modify — coverage floor (§9.5; inert when written, active since #55) |

### Documentation (Phase 10 scope)

`docs/designs/41-model-capability-registry.md` (create), `docs/designs/216-claude-status-bar.md` (modify), `CLAUDE.md` (modify), `docs/terminal/README.md` (modify), `docs/CHANGELOG.md` (modify).

**Count.** The rows above are 27 paths I verified directly plus the doc set. I have not independently confirmed the exact total against the commit, so this document no longer asserts one — if a 28th path exists it is most likely `ClaudeTranscriptParser.test.ts`. **An honest partial list beats a false claim of completeness**, which is the same principle §2.0.4 applies to citations.

## 13. Explicit decisions

**(a) The shared parser lowercases.** Required on the window side; `friendlyModelName` becomes case-insensitive as a consequence, which removes a label/window disagreement. The unparseable fallback returns the sanitized original casing.

**(b) `parsed.modelId` stays raw until the wire boundary, where `sanitizeModelId` applies; only the sticky key is canonical.** `stickyModelKey` **drops the date** so `claude-haiku-4-5` and `claude-haiku-4-5-20251001` are one model for latching; `canonicalId` **retains** it for capability lookup.

**(c) `modelNativelySupportsExtended` was DELETED** (`CORRECTED 2026-08-08`). Rev 2 decided to keep the name, because `ClaudeStatusService.test.ts` imported it into its own `detectWindowSize` mock and renaming would have broken an unrelated test file. **That reasoning expired when F23 extracted the shared harness:** the harness's stub delegates to `windowForModelId` directly (§9.6), so the boolean wrapper lost its last caller and was removed rather than left as a synonym for `windowForModelId(id) === EXTENDED_WINDOW`. Rev 2–5 kept asserting the wrapper was "kept, not renamed" long after it was gone — one of the nine §18.2 drifts.

**(d) `claude-opus-5-0-2026` renders as "Opus 5.0" and resolves through the EXACT MAP, not the heuristic.** `2026` is four digits, so §6.2 does not treat it as a snapshot date; it is an unknown tail segment, accepted and dropped. The id canonicalises to `claude-opus-5-0`, exactly the form the `claude-opus-5` key is stored under (`buildExactLookup`), so `exactWindowFor` **hits**.

**(e) Unrecognised bracket variants ignore the `/model` override entirely.** Otherwise `/model claude-opus-4-7[thinking]` would set `modelForcedStandard` and clear the sticky 1M bit — a user-visible downgrade from an unrelated suffix. For display an unrecognised variant is ignored rather than rejected: a label is not an action.

**(f) An alias yields a label but no window opinion** (§6.3).

**(g) R2 outranks every configured signal** — a physical fact beats a configuration claim.

**(h) R_ENV is withdrawn.** Three of its four signals were unreachable; the survivor is a routing fact, not a capacity fact; it outranked explicit user configuration; and it made a core service export state for a feature module. A rule that cannot fire, and would infer the wrong thing if it did, is worse than no rule.

**(i) Source citations name symbols, not line numbers.** Three consecutive revisions shipped stale line references; a citation that rots on every refactor trains readers to ignore citations.

**(j) The inference is surfaced through a structured field, not parsed back out of prose** (§5.4).

## 14. Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | A renamed or deleted detector export breaks an unrelated test file | n/a | medium | **`modelNativelySupportsExtended` was ultimately deleted**, safely, because F23's shared harness had already removed its last caller (decision (c)). Rev 2–5 recorded this row as "name and signature kept" — stale. |
| R2 | Reordering breaks the sanitize-first remediation | low | high | Order fixed; the pin uses an interior control char that `trim` cannot repair. |
| R3 | Grammar change silently flips strictness pins | medium | medium | Major required. All changes enumerated in §9.2. |
| R4 | Canonical keying resets the sticky bit each refresh | low | medium | Deterministic and total. |
| R5 | Registry work adds I/O before the settings read | low | medium | `modelId.ts` has no I/O; zero-read assertions retained. |
| R6 | Lowercasing changes label behaviour | certain | low | Deliberate; fallback preserves casing. |
| R7 | Undecomposable-id hatch lost | low | medium | §7.1.1 map checked before parsing. |
| **R8** | Capability values drift, or design and code disagree | **materialised, then closed** | high | §2.0 procedure; §7.4 expiry test; §9.4 oracle, independently re-derived; §9.4.2 guards, both observed failing. **Residual: four rows lack a verbatim quotation (§2.0.4).** |
| **R9** | Window over-statement from plan, deployment or gateway | medium | high | **Mitigation reduced.** R_ENV withdrawn, leaving provisional-not-latched (§5.3), the inferred marker surfaced in both tooltip and `aria-valuetext` (§5.4), and the conservative defaults §2.0.2 mandates. |
| R10 | Single parser backs both label and window | low | high | §9.4 oracle plus the §9.4.2 guards. |
| R11 | ReDoS | very low | medium | Linear by construction; entry cap is defence-in-depth. |
| R12 | New `.ts` files fail the `license` check | low | low | SPDX headers present; markdown is exempt. |
| **R13** | Doc/code drift | **materialised four times** | high | Rev 2 structural, Rev 3 semantic, Rev 5 file-plan and citation rot, **Rev 6 nine prose contradictions in unguarded sections**. §18.2 records why the existing controls did not catch it and what would. |
| R14 | Injected `/model …[1m]` line stays effective longer under canonical keying | low | medium | The backward scan accepts only the newest pre-turn override; latching requires corroboration. |
| R15 | Scope growth destabilises a bug fix | materialised, contained | medium | R_ENV's withdrawal reversed part of it; §12 reconciled and its false completeness claim withdrawn. |
| R16 | The `modelId.ts` coverage floor reads as enforced but is inert | certain | low | Documented in §9.5, §18 and in `vitest.main.ts`; user-deferred. *Closed by #55* – the floor is active. |
| R17 | Guards trusted without evidence | **closed** | high | All three injected faults executed and their failures observed (§18 criterion 12). |
| R18 | Guard 1 line-scans and binds a number out of a Note cell | **closed** | high | §7.1's parsing contract plus the synthetic-decoy fault. |
| **R19** | **Guard coverage is mistaken for document correctness** | **materialised** | **high** | Guard 1 parses §7.1/§7.1.1 only; every other section is unguarded prose, and nine drifted. Recorded at §9.4.2 and §18.2 so no future reader infers "the guards pass" means "the document is right". |

## 15. Review findings and resolutions

| # | Finding | Resolution |
|---|---|---|
| F1 | `sonnet: null` wrong | **Partially upheld.** Sonnet 5, Fable 5, Mythos 5 are 1M rows. **Sonnet 4.6 is 200k on the metered CLI layer.** Net effect was rows *added* — no pin flipped, no fixture swapped. |
| F2 | `fable: null` wrong; mythos family missing | **Resolved.** |
| F3 | Window is plan x model x environment | **Partially resolved, (a) leg withdrawn.** R_ENV shipped then removed; (b) and (c) stand; §2.0.2 bakes the entitlement distinction into the data. |
| F4 | `[1m]` branch unreachable | **Resolved and verified.** Kept defensively, promoted to corroborated at R1m. |
| F5 | Opus threshold off by one for the metered layer | **Resolved.** The only pin flips in the change set. |
| F6 | No `modelForcedStandard` rule | **Resolved.** R0'; AC7 pinned. |
| F7 | Scalar threshold cannot represent capability | **Resolved, argument corrected.** Heuristic capped on both axes; per-major precedence at §7.2.1. |
| F8 | Models API foreclosed silently | **Resolved.** §10. |
| F9 | AC5 false as written | **Resolved twice.** Narrowed to registry-resolved **1M**. |
| F10 | Length cap behind an unbounded parser | **Resolved in code**; position pinned by §9.1.1. |
| F11 | AC1 spy is vacuous | **Resolved.** |
| F12 | Consistency test is a false biconditional | **Resolved in form, failed in practice, then independently confirmed** (§9.4.3). |
| F13 | Undeclared non-`1m` variant flip | **Resolved.** Decision (e). |
| F14 | No minor-omitted case below threshold | **Resolved.** |
| F15 | Haiku framed as a product decision | **Resolved as a cited fact**; citation is a paraphrase, tracked at §2.0.4. |
| F16 | Bare aliases | **Resolved.** |
| F17 | Policy not consolidated | **Resolved.** Single `windowForModelId`; the boolean wrapper was later deleted outright (decision (c)). |
| F18 | whisper-assets precedent inverted | **Resolved.** |
| F19 | ReDoS premise wrong | **Resolved.** |
| F20 | Cap not applied at IPC | **Resolved, and extended**: `friendlyName` and `tooltip` gained bounds too (§11). |
| F21 | Dropped trim leaks a control char | **Resolved, and extended**: the sanitizer's class now covers zero-width and bidi code points (§11). |
| F22 | Sanitize pin cannot fail | **Resolved.** |
| F23 | Harness duplication tests a different system | **Resolved** — and it is what made decision (c)'s deletion safe. |
| F24 | Manual coverage target | **Partially resolved** at the time; floor declared but inert; user-deferred. *Resolved by #55* – the floor is active. |
| F25 | Canonical keying widens injected-override effect | **Resolved as documented risk R14.** |

## 16. What got bigger, what shrank, and what is out of scope

**Net change.** The first draft touched 5 source files; the final set spans main, shared, renderer, tests, fixtures, config and docs (§12). `modelId.ts` landed at 500 lines against a ~200 estimate, mostly the per-row provenance JSDoc the honesty controls require. `ClaudeStatusService.ts` grew +88 against a +11 budget. The post-lens-review rework then added the `inferred` field, the sanitizer hardening and the merged-env fix — none of which were in any estimate, and all of which came from review findings rather than scope drift.

**Out of scope, with reasons.**

- **Live-process environment probing.** The authoritative replacement for the withdrawn R_ENV; macOS-only with the current architecture. **Follow-up issue: [#48](https://github.com/qodeca/erfana/issues/48)** (open) — it must also settle §2.0.3's unverified names first.
- **The Models API route.** Rejected by binding decision 4.
- **Reading `resolvedModel`.** Verified present carrying the `[1m]` suffix (§2.2), the strongest cheap follow-up — but undocumented, and the registry fix satisfies AC1 without it. **Follow-up issue: [#48](https://github.com/qodeca/erfana/issues/48).**
- **Activating the coverage thresholds.** User-deferred (§9.5).
- **Extending guard 1 beyond §7.1/§7.1.1** (§18.2). The nine Rev 6 corrections were caught by human review, not by a control.
- **Reducing `ClaudeStatusService.ts` below 500 lines.** Pre-existing, now worse.
- **Capturing verbatim citations for the four §2.0.4 rows.** Requires network access.
- Removing R2 — decision 3, load-bearing.

## 17. Implementation sequence

0. **§2.0 verification gate.** Fetch all six §2.1 URLs; confirm layer, then entitlement, then value; amend §7.1 first on any difference.
1. Create `modelId.ts` (grammar first, then data). Cap at `stripModelVariants` entry.
2. Create `modelId.test.ts`: the oracle re-derived per §9.4.1, both §9.4.2 guards, the §9.1.1 cap-position test.
3. Move `MAX_MODEL_ID_LENGTH` to the shared schema; add the `.max()` bounds.
4. **Point the detector at `windowForModelId` and delete `modelNativelySupportsExtended`** once the shared harness (step 9) has removed its last caller; confirm detector-suite failures are exactly the §9.2 set.
5. Apply the §9.2 changes; add AC1/AC3/AC4/AC5 tests.
6. Add `opts.forceStandard` (R0') and R1m.
7. Rewrite `friendlyModelName.ts` per §6.2; rework `sanitizeModelId` per §11; apply its one flip.
8. Rewrite `modelOverrideFromRecord` with decision (e); create the override test file.
9. Extract the shared harness; update `ClaudeStatusService.test.ts`.
10. Service changes: corroborated-only latching, sticky key, unconditional four-argument call, **`inferred` on the snapshot**, wire-`modelId` sanitization.
11. Schema `inferred` + bounds; renderer `aria-valuetext` composition (§5.4).
12. `TerminalService.cleanEnvironment` on the merged env (§5.2), plus its test.
13. `vitest.main.ts` floor (inert when written; active since #55); docs.
14. Gates: `npm run lint && npm run typecheck && npm run test && npm run check:headers && npx electron-vite build`.
15. Manual UAT on a live `claude` session.

## 18. Verification criteria and results

1. §2.0 run; `CAPABILITIES_VERIFIED_ON` set; every §7.1 row carries a source and either a verbatim quotation or a §2.0.4 entry saying why not.
2. `npm run lint`, `npm run typecheck` clean; `npx electron-vite build` succeeds.
3. `npm run test` green — **9038 tests**.
4. `npm run check:headers` passes.
5. Coverage floor for `modelId.ts` is **declared but not enforced** (§9.5); met by reading `npm run test:cov` output.
6. The §9.4 oracle passes with no expectation computed from `modelId.ts`.
7. AC7 test proves `/model claude-opus-5` reports 200k.
8. AC5 invariance sweep passes **and** its negative pin still flips a registry-200k model at the boundary.
9. §9.1.1 cap-position test present with its positive control.
10. **Document-parity guard** present, column-indexed per the §7.1 parsing contract.
11. **Key-set guard** present; no registry value ever exported.
12. **All three injected faults executed and their failures observed** — `RESULTS RECORDED 2026-08-08`:
    - Flipping the design's Sonnet 4.6 Window cell to the extended window → **guard 1 fails**, reproducing the 2026-08-07 defect as a build failure.
    - Adding a bogus registry row → **guard 2 fails on both assertions**.
    - Line-scanner check → **it initially proved nothing** (§18.1). Guard 1 was strengthened with an injectable synthetic document containing a decoy row whose Window cell is non-numeric while a window-shaped number sits in its Note: a column-indexed parser throws, any line-scanner returns cleanly.
13. `rg 'claude-\[a-z\]' src/main --glob '!*.test.ts'` matches only `modelId.ts`.
14. Manual UAT on a live `claude` session.

### 18.1 Lesson — a fault a wrong implementation survives by coincidence proves nothing

The first line-scanner fault, run against the real §7.1, **passed under a first-match line-scanner**, because the Window column happens to sit before the Note numeral in reading order. Output comparison alone could not distinguish a correct column-indexed parser from a lucky one.

**The rule:** when validating a guard by injecting a fault, construct the fault so that **no wrong implementation can survive it** — not merely so that the wrong implementation you happened to imagine fails. If a plausible wrong implementation passes, the fault is the defect, not the evidence.

### 18.2 Lesson — a guard's coverage is not the document's correctness

The pre-commit review blocked this file for contradicting the code in **nine** places: §5.4's tooltip claim, §8.1's two-part `WindowRule`/schema claim, §9.2's deleted-predicate row, §9.6's harness delegate, §12's `modelNativelySupportsExtended` and `TerminalService` rows, §13(c), §14 R1, and §17 step 4 — plus three whole features the document never mentioned (`inferred`, the `MAX_TOOLTIP_LENGTH`/`friendlyName` bounds, and the `sanitizeModelId` rework with `aria-valuetext`).

**Every one of them sits outside §7.1/§7.1.1, so guard 1 was green throughout.** The guards did exactly what they were built to do; the mistake was treating "the guards pass" as "the document is correct". A control that covers one table does not confer trustworthiness on eleven sections of prose around it.

**The rule:** state a guard's *coverage boundary* wherever its result is cited, so a passing guard cannot be read as a broader warrant than it is (§9.4.2 now does this, and R19 records it). Extending guard 1 to prose is not attempted here — prose is not mechanically checkable in the way a table is — which means **this document's prose remains dependent on human review at each change**, and should be read with that in mind.

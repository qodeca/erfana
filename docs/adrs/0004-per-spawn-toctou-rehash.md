# ADR 0004: Per-spawn re-hash for TOCTOU close (5-tuple spawn log)

- **Status**: accepted
- **Date**: 2026-04-23
- **Deciders**: Marcin Obel, Claude Code (performance + security trade-off audited by 3 reviewers)
- **Related**: [ADR 0001](0001-self-host-whisper-binaries.md) · [`src/main/services/LocalWhisperService.ts`](../../src/main/services/LocalWhisperService.ts) · [`docs/windows/deferred-work.md`](../windows/deferred-work.md) § D9

## Context

Local Whisper binaries (`whisper-cli` + 4 sidecar DLLs on Windows) live in `{userData}/whisper/bin/`, a user-writable directory. An attacker with local write access to that directory (local malware running as the user, IT-managed deployment gone wrong, anything with read/write on `$HOME`) can swap the binary between **install time** (when `ensureBinary()` verified SHAs) and **spawn time** (when `LocalWhisperService.transcribe()` execs it). This is a classic **TOCTOU** (Time-Of-Check To Time-Of-Use) race.

The install-time SHA verify + the source-pin in `whisper-assets.ts` give us strong guarantees about what we **put on disk**, but nothing about what we **spawn from disk** at the moment of spawn.

The plan's spawn-log commitment was a 7-tuple at INFO: `{url, expectedSha, computedSha, signatureValid, manifestRevision, spawnedPath, binaryVersion}` on every spawn. Implementation surfaced a split: some keys are install-time facts (`url`, `expectedSha`), some are spawn-time facts (`computedSha`, `spawnedPath`, `binaryVersion`). Logging both on every spawn duplicates immutable install-time data for every chunk of a chunked transcription.

## Decision

**Re-hash every pinned file (main binary + all sidecars) before every `spawn()` call**, including once per chunk in a chunked transcription. Cost: ~2.3 MB total on Windows (main + 4 DLLs), measured <50 ms on modern hardware. Streaming SHA-256 via `createReadStream().pipe(createHash())` — no full-buffer load into RSS.

Implemented as `WhisperModelManager.verifyInstalledBinary()` returning `VerifiedBinary` (`{spec, mainSha, revisionIndex}`). Called by `LocalWhisperService.runWhisper()` immediately before `spawn()`. Throws `WHISPER_BINARY_TAMPERED` on any file mismatch.

**Spawn log is a 5-tuple**, not the plan's literal 7-tuple:

- `spawnedPath` — absolute path being exec'd
- `computedSha` — fresh SHA just computed
- `signatureValid: true` — implicit (wouldn't have reached spawn if sig was invalid at install)
- `manifestRevision` — from the `.last-seen-revision` sentinel for release correlation
- `binaryVersion` — pinned filename (proxy; see Alternatives)

The install-time keys `url` and `expectedSha` are logged once by `WhisperModelManager.ensureBinary()` at install-complete time. Future work: correlation-ID grouping the two events — tracked as [D9 in `docs/windows/deferred-work.md`](../windows/deferred-work.md).

## Consequences

**Defended threat**

- Swap-at-rest attacks against `{userData}/whisper/bin/` are caught at the next spawn. Attacker needs to win a < 50 ms race between `verifyInstalledBinary()` returning and `spawn()` creating the child — infeasible without kernel-level access.

**Accepted costs**

- **~50 ms extra latency per transcription**, amortised over multi-second inference. Imperceptible for interactive use.
- **~50 ms × N for chunked transcriptions**, where N = ceil(duration / 480s). A 1-hour recording = 8 chunks = 400 ms total overhead. Still imperceptible relative to inference time.
- **Re-reads ~2.3 MB from disk every chunk.** On an SSD, inside the OS file cache for sure. On a cold first read or a slow spinning disk, could add 200-300 ms. Still acceptable vs the TOCTOU close.

**Not defended**

- **Kernel-level privilege escalation.** An attacker who can swap the binary in the microsecond window between fstat and execve (kernel-level primitive) still wins. We're defending against user-space malware, not kernel rootkits.
- **Install-time attacks.** If the install itself was compromised and wrote a pre-tampered binary, we'd verify against the wrong pin and not catch it — but that's caught by [ADR 0001](0001-self-host-whisper-binaries.md)'s source-pin + signed-manifest chain.

## Alternatives considered

### Verify once at service init, cache the result

- **Pros**: amortises cost to once per process lifetime.
- **Cons**: re-opens the TOCTOU window between init and spawn. If `LocalWhisperService` is a singleton living for the app session, the window is "session lifetime" — potentially hours.
- **Verdict**: rejected. Reduces cost by ~N but reopens the vulnerability. The whole point is to collapse the window.

### Verify once per top-level `transcribe()` call (not per chunk)

- **Pros**: reduces cost on chunked transcriptions.
- **Cons**: attacker could swap the binary between chunk 1 and chunk 2 of a long-running transcription.
- **Verdict**: rejected. The cost of per-chunk verification (<400 ms for a 1-hour file) is negligible compared to attacker-agility benefit.

### Verify by file mtime/inode, not content hash

- **Pros**: much faster (O(1) vs O(file size)).
- **Cons**: attacker preserves mtime trivially (`touch -r`) and inode doesn't change when content is overwritten in place. Both defeatable.
- **Verdict**: rejected. Useless as a security signal.

### Use macOS `csops` / Windows `AuthenticodeVerify` instead of SHA pin

- **Pros**: OS-level signature verification.
- **Cons**: only works when signed (Windows 0.9.4 ships unsigned); platform-specific code; doesn't catch substitution with a validly-signed-by-someone-else binary (e.g. a different Microsoft-signed whisper build).
- **Verdict**: rejected for the SHA-pin path. Augment in Phase 5 when Windows is signed.

### Log 7-tuple verbatim on every spawn

- **Pros**: exact plan compliance.
- **Cons**: `url` + `expectedSha` are immutable install-time facts; echoing them on every chunk is log noise. Grouping by correlation ID (future work — see [D9 in `deferred-work-phase4.md`](../windows/deferred-work-phase4.md#d9--forensic-logging-tuple-expansion-beyond-spawn-5-tuple)) is the right answer.
- **Verdict**: rejected for per-spawn log; install-time keys live in the `ensureBinary()` log instead.

### Real `whisper-cli --version` instead of pinned filename as `binaryVersion`

- **Pros**: more forensic detail.
- **Cons**: requires spawning the binary just to get version info BEFORE the real spawn — doubles spawn count; breaks the TOCTOU guarantee (version spawn would itself need verification).
- **Verdict**: rejected. Pinned filename is SHA-locked to a single release; filename is sufficient attribution.

### PATH manipulation (`process.env.PATH = binDir + ';' + process.env.PATH`) instead of `cwd: binDir` for DLL sideload mitigation

- **Pros**: looks "cleaner" — a single env mutation at service init.
- **Cons**: **mutates process-wide state across ALL child processes**, not just whisper. Any subsequent child process (git workers, ffmpeg, OS file-picker helpers) would see the modified PATH. Easy to forget to restore; even harder to restore safely under concurrent spawns.
- **Cons**: doesn't actually defeat DLL sideloading the way it looks. Windows `LoadLibrary` search order puts the **application directory** and **current directory** ahead of PATH entries. Setting PATH first still leaves local-directory hijacks as an attack vector.
- **Verdict**: rejected. `cwd: binDir` on Windows directly controls the DLL search directory for this specific child — scoped to the one spawn, zero process-global state mutation, and hits the earlier slot in Windows' search order.

## Why this decision is load-bearing

A performance-minded contributor will eventually ask "why re-hash 2.3 MB on every chunk?" and propose caching. This ADR is the answer. The TOCTOU window reopening is the reason; performance cost is real but small.

## References

- `src/main/services/LocalWhisperService.ts:738-768` — the `verifyInstalledBinary()` call and spawn log
- `src/main/services/WhisperModelManager.ts:478-486` — `verifyInstalledBinary()` implementation returning `VerifiedBinary`
- `src/main/services/WhisperModelManager.ts:601-629` — streaming SHA verify via `createReadStream.pipe(createHash)`
- `docs/windows/deferred-work.md` §D9 — correlation-ID grouping as future work
- `docs/CHANGELOG.md` §0.9.4 — user-facing summary of the trust chain

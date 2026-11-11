# Current implementation review

Review date: **2026-11-12 (Asia/Manila)**. Scope: the current working tree, including the existing uncommitted implementation. This is a focused source review with isolated local reproductions, not a comprehensive security certification or a production penetration test.

**All findings below remain open. No application code, configuration, or tracked tests were changed to fix them.** No production requests, deployments, migrations, or real provider accounts were used during this review. Suggested directions are for later review, not instructions to implement fixes during unrelated tasks.

Priority: **P1** needs prompt attention, or resolution before enabling the affected integration. **P2** is a confirmed functional, privacy, or development-workflow defect to schedule. Conditional impact and verification limits are stated per finding. An implemented feature can still be incorrect in the cases below.

## IMP-01

**P1 — Pending room approval bypasses a newer block.** Requirements: FR-04, FR-07, BE-01.

A visitor requests shared-room access; either the host or visitor then blocks the other. A fresh join correctly returns 403, but approving the old pending request grants membership. The blocked visitor can subsequently read third-party room messages and send messages.

Cause: [join approval](../celld/durable-objects/room.ts#L790) promotes the requester without rechecking the block. [Subsequent authorization](../celld/durable-objects/room.ts#L251) checks pair blocks only for private conversation types. The [normal join path](../celld/durable-objects/room.ts#L334) does reject the block; removed-member checks also remain enforced.

**Evidence:** isolated HTTP/SQLite tests covered both block directions: fresh join 403, old-request approval 200, history 200, send 201. Direction to review: revalidate current requester eligibility at approval and define consistent ongoing access rules. Do not remove protection for legitimate pending applicants.

## IMP-02

**P1, conditional on video — Provider call termination has the wrong grant.** Requirements: FR-09, BE-03, BE-06.

[endCall](../celld/features/providers/livekit.ts#L36) signs its LiveKit `DeleteRoom` request with `roomAdmin` but no `roomCreate`. [LiveKit's API contract](https://docs.livekit.io/reference/other/roomservice-api/#deleteroom) requires `roomCreate`; [upstream authorization](https://github.com/livekit/livekit/blob/master/pkg/service/auth.go#L188) checks that grant.

**Evidence:** a local provider substitute verified the actual JWT signature and enforced the documented grant. Repeated delivery attempts returned 401; the app recorded `ENDED` while `media_terminated` stayed false and the `call.end` outbox item remained. No real LiveKit server was contacted. Consequently server-enforced media termination cannot be relied on when video is enabled. Normal clients may disconnect themselves, and the app correctly denies new tokens after ending; those protections do not repair provider-side termination.

Direction to review: use the documented management permission and test actual management-token grants, not only mocked HTTP statuses.

## IMP-03

**P2 — Join-status discloses a private room title to an unrelated user.** Requirements: FR-04, FR-07, BE-01.

An authenticated outsider who knows a shared room's UUID can call [the join-status route](../celld/features/rooms/routes.ts#L156) without membership, an invitation, or a prior request. [The NONE branch](../celld/durable-objects/room.ts#L463) returns its private title.

**Evidence:** isolated HTTP requests returned 404 for the ordinary room snapshot but 200, `NONE`, and the title for join-status. Knowledge of the UUID is a prerequisite; this does not establish enumerable IDs or message access. Direction to review: return only justified status information to authorized members or actual applicants, with a minimal response for unrelated callers.

## IMP-04

**P2 — Purged rooms keep expired guest creators stored.** Requirements: FR-10, BE-02.

[The projection upsert](../celld/durable-objects/room.ts#L1454) omits `creator_id` from conflict updates. Purging scrubs the Room and projected JSON, but the indexed creator column retains the old ID. [Guest cleanup](../celld/durable-objects/app.ts#L1074) treats this stale column as a live reference and skips deleting the expired creator and associated profile data.

**Evidence:** after close, purge, guest expiry, and cleanup in an isolated SQLite fixture, authoritative/JSON creator fields were scrubbed, the indexed column remained, the creator remained, and an unrelated expired control guest was deleted. Direction to review: align the tombstone projection with cleanup/reference rules while preserving version ordering.

## IMP-05

**P2 — A delayed room open overrides newer navigation.** Requirements: FR-11.

[openRoom](../src/App.tsx#L368) waits for room metadata/history and then sets active state without checking whether the user selected another room in the meantime.

**Evidence:** in a browser fixture, delay Room A's history, select Room B, then release A's response. The displayed active room changes from B back to A. Direction to review: bind each room-open result to the current navigation intent and ignore stale results, including when navigation leaves chat.

## IMP-06

**P2 — Delayed pagination mixes messages between rooms.** Requirements: FR-05, FR-11.

[Earlier messages](../src/App.tsx#L2374) prepends its asynchronous response into the current message array without checking that the active room still matches the request.

**Evidence:** start pagination in A, navigate Back then into B, release the old response: A's messages appear under B's heading. This is client-side display contamination for the authenticated user's authorized data, not evidence of a backend permission bypass. Direction to review: scope pagination data/cursors to a room and reject stale responses.

## IMP-07

**P2 — Routine refresh discards loaded history pages.** Requirements: FR-05, FR-11.

[refreshChat](../src/App.tsx#L393) replaces the entire displayed history and cursor with the newest page. This also runs for ordinary message/reaction updates.

**Evidence:** load an older page, react to a current message, and observe the older messages disappear and the Earlier messages button return. Backend history is not deleted; loaded UI history is lost. Direction to review: reconcile authoritative updates without discarding the loaded pagination window or its cursor.

## IMP-08

**P2 — One failed presence heartbeat pins a healthy connection offline.** Requirements: AD-02, AD-03, FR-11.

[The interval's error handler](../src/App.tsx#L617) sets `connected=false`. [Later heartbeat success](../src/App.tsx#L413) updates presence but does not restore the flag; restoration depends on a new socket-open event. Meanwhile [fallback polling](../src/App.tsx#L640) remains enabled.

**Evidence:** a browser fixture with an open socket and virtual clock returned 503 once, then 200 for presence. No socket closed; the UI stayed Reconnecting and message reads grew from 1 to 6. Direction to review: separate presence-request health from transport health and define how the fallback exits after recovery.

## IMP-09

**P2, local development — Backend port overrides in the env file are ignored.** Requirement: AD-04.

[The native wrapper](../celld/scripts/dev.ts#L23) calculates its port using `process.env` alone, although it already loaded merged file/process settings. [Vite](../vite.config.ts) calculates its proxy target from the merged environment. Setting `CELLD_PORT` only in `.env` can therefore start the backend on one port while the frontend proxies another.

**Evidence:** an isolated working directory and fake Celld executable recorded the actual wrapper arguments. The file-configured port differed from the emitted `--port`. No real backend was launched. Direction to review: resolve the runtime port and proxy target from the same precedence rules.

## IMP-10

**P2, local development — Reusing a healthy port silently skips configuration updates.** Requirement: AD-04.

[Startup reuse](../celld/scripts/dev.ts#L50) accepts any successful health response and exits before [writing current bindings](../celld/scripts/dev.ts#L64). It does not verify origin/config compatibility or even a Celld-specific response identity.

**Evidence:** a synthetic local health server returned 200. The wrapper reported reuse and left an intentionally stale fixture `.dev.vars` unchanged. A surviving backend can retain an old origin/provider configuration, and an unrelated healthy service can be mistaken for it. Direction to review: detect incompatible instances and provide reliable restart/reload behavior without silently treating stale configuration as applied.

## IMP-11

**P2, previously observed local workerd gap — Automatic development migration fails.** Requirements: BE-07, AD-04.

[Development schema initialization](../celld/shared/migrations.ts#L38) passes multiline migration SQL to `D1.exec()`. The earlier workerd smoke failed on the quick-chat archive table definition in migration 0004. Explicit Wrangler migration application and the pre-migrated production path passed.

This finding predates the present audit and was **not rerun here**. It does not establish a failure in the deployed, already-migrated production database. Direction to review: use a migration execution path compatible with real D1/workerd and test a clean development start.

## GAP-01

**Deferred feature, not a runtime defect — Reconnect is not implemented.** Requirement: FR-06.

The [creation](../celld/durable-objects/app.ts#L435) and [acceptance](../celld/durable-objects/app.ts#L505) branches deliberately return 402 because checkout is unavailable. The [browser button](../src/App.tsx#L2023) is deliberately disabled. A valid archive and the current zero price do not enable a free path.

**Evidence:** an isolated fixture with a valid archive and verified accounts received the expected hard-coded 402. The SRS previously overstated this as working relationship functionality. Mark it NOT IMPLEMENTED; paid/free checkout rules need an explicit product decision before implementation. Do not treat the intentional disabled button as an accidental regression.

## Verification and review limits

- Baseline `pnpm check`: typechecking and all **72 existing tests passed**. Passing tests do not cover the cases above.
- Security reproductions: `pnpm exec vitest run --config .context/audit-security.config.ts` — three checks across two files, asserting the observed block-approval and provider-grant defects.
- Backend reproductions: `pnpm exec vitest run --config .context/audit-backend.config.ts` — three checks for title disclosure, creator retention, and deliberately disabled reconnect.
- UI reproductions: local Vite on an unused test port plus `pnpm exec tsx .context/audit-ui-races.ts` — four browser cases using synthetic APIs, socket behavior and a virtual clock. No production data was used.
- Development wrapper reproductions: `node .context/audit-implementation/dev-runtime-repro.mjs` — two checks with isolated environment files, a fake runtime, and a temporary local health server.
- These reproduction checks intentionally assert the **currently incorrect behavior**, not a fixed implementation. They are audit artifacts, not newly added product regression tests.
- All fixture scripts/results live in gitignored `.context/audit-*`; they do not automatically follow new workspaces. The triggers, source evidence and conclusions above are tracked so future agents can recreate tests without depending on local artifacts.
- Source hashes cover application/configuration/tests to check that this review left implementation files unchanged. Local test services were stopped by their owners.
- No real Google, Resend, scanner, or LiveKit account was exercised. The provider finding is a documented protocol mismatch validated by a local signature-checking substitute.
- A suspected cross-Durable-Object lock cycle was not reproduced in four natural workerd match/logout races and is **not classified as a confirmed defect**. This review does not prove the absence of other concurrency or security issues.

Do not interpret REST instead of GraphQL, or WebSockets instead of SSE, as bugs. The actionable problems here concern authorization, retention, provider compatibility, state management and configuration consistency.

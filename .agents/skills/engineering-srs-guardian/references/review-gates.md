# SRS-based implementation review and release gates

Use this for code reviews, PR readiness checks, debugging, architecture drift audits and end-to-end signoff.

## 1. Establish verifiable baseline
- Confirm **which repository, branch, commit, PR head and environment** the user means. Check actual files and diffs, not memory of older reviews.
- Read `PROJECT_SRS.md`, ADRs, implementation matrix, and latest handoff. List relevant FR/NFR/INV IDs.
- Inspect frontend event handlers/state, API routes, service/domain logic, database migrations/queries, jobs/queues, shared types, flags, config and existing tests. Follow full call paths; do not infer backend correctness from a successful UI mock.
- If code/tool access is unavailable, separate a conceptual review from a repository-backed verdict. Do not invent paths, line numbers, test results or PR state.

## 2. Ask questions that catch real defects
**Product logic:** Can a user bypass a UI constraint via a raw API call? Is the business condition checked at the same transaction boundary as the write? Are monetary/status/state changes atomic where needed? What happens under retries, competing updates and stale UI?

**Backend:** Are permissions tenant- and resource-scoped? Is the operation idempotent? Are timestamps, cursors, ordering, pagination, validation and error contracts coherent? Does a synchronous handler hide a slow external call? Can queue workers safely retry? Can jobs get stuck or flood providers?

**Database:** Are index/access paths realistic? Are unique constraints and foreign keys appropriate? Does migration work with existing rows and old clients? What gets deleted, retained, archived and restored? What is the source of truth? Can read replicas or cache staleness change business outcomes?

**Realtime:** Are reconnect, missed-event replay, ordering, duplicate delivery, auth revocation, load balancing, fan-out and backpressure addressed? Could polling create excessive database traffic? Are live-presence events accidentally persisted indefinitely?

**Frontend:** Does the UI handle loading/empty/error/offline/slow states? Does optimistic UI reconcile rejected writes? Does a queued action survive app restart? Are long lists efficient and accessible? Are animations non-blocking and reduced-motion aware?

**Security/ops:** Are secrets and sensitive payloads excluded from logs? Is server-side auth enforced for subscriptions as well as commands? What alert or trace would identify a failed booking/message/payment? Is a rollback path viable?

## 3. Grade with clear evidence
| Verdict | Meaning |
|---|---|
| PASS | Inspected paths match requirement and stated test/verification level; include actual evidence |
| PARTIAL | Some flows meet intent; material gaps remain |
| FAIL | Requirement is violated, with a reproducible or grounded path |
| UNKNOWN | Access or verification is insufficient to judge |
| N/A | Not included in scoped milestone, with rationale |

Prioritize by consequences:
- **BLOCKER:** Security/privacy exposure, data loss, financial/accounting errors, invariant violation, or core feature unavailable.
- **HIGH:** Broken main journey, likely duplication, uncontrolled retry behavior, severe availability/reliability issue.
- **MEDIUM:** Edge-case correctness, performance or accessibility gap that should be scheduled.
- **LOW:** Minor polish or localized maintainability improvement.

For each finding provide: impacted requirement, actual vs expected, exact evidence (file:line / test/log/PR), confidence and missing verification, user impact, smallest safe fix and regression test. Distinguish functional bugs from legitimate product tradeoffs or unstated preferences.

## 4. Execution and release evidence
Collect as appropriate:
1. Static review, typecheck, lint and formatting result.
2. Domain tests for invariant and counterexamples.
3. Integration tests for database, auth, API event/queue flows and schema contracts.
4. Frontend E2E including background/foreground, disconnected mode, reconnect, stale updates and failures.
5. Concurrency, duplicates, cross-tenant access, rate-limit/load and provider outages for risky flows.
6. Migration rehearsal, feature flag/rollback and observable smoke tests for the target environment.

If a check wasn't executed, mark **NOT RUN**. A passing CI pipeline is evidence only for the tests it actually includes. Verify new code against the exact commit intended to ship and note environment parity gaps.

## 5. Deliver a decision, not a vague review
Output:
- **Scope reviewed:** repo / SHA / PR / environment / SRS IDs.
- **Verdict:** ready, conditional, or not ready, with unknowns.
- **Findings ranked by severity:** direct evidence and fix.
- **Traceability changes:** what passes, fails, or remains unknown.
- **Minimal fix plan:** coherent PR(s), sequencing, safe rollback.
- **Exact end-to-end test plan:** account roles, starting state, actions, expected UI + persisted results, failure injection.

Do not merge, deploy, rewrite approval history or directly push to protected branches without an authorized workflow. After an approved change, refresh `IMPLEMENTATION_MATRIX.md` and `CONTEXT_HANDOFF.md` with genuine evidence.

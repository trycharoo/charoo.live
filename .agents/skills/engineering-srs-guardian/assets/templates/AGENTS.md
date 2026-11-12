# Engineering Standard for AI Coding Agents

Applies to all work in this repository. Be a pragmatic staff software engineer, not only a code generator. Optimize for correct business behavior, coherent architecture, safe deployment, and a testable end-to-end product.

## Required first action for each substantive task
1. Read `docs/engineering/PROJECT_SRS.md`, `ARCHITECTURE_DECISIONS.md`, `IMPLEMENTATION_MATRIX.md` and `CONTEXT_HANDOFF.md` if they exist.
2. Re-check the current code, branch, changes, tests and deployment target. Documentation is intent/history, not proof of present behavior.
3. Identify the relevant `FR-*`, `INV-*` and `NFR-*` requirement IDs. If docs are absent, create a minimum viable SRS from the product request before implementing major features.
4. Explain assumptions, business invariants, and failure scenarios. Challenge a proposed architecture if a simpler or more reliable choice exists; compare alternatives and document why.
5. Trace the work across UI, backend/domain enforcement, data schema/consistency, API/event contracts, security, observability and tests. Do not implement a UI-only interpretation of a server-side rule.

## Design and implementation rules
- Specify expected behavior and negative/concurrent tests before changes. Never silently change product intent to make the existing implementation seem correct.
- Prefer clear module boundaries and the existing stack. Avoid microservices, background jobs, caches, premature abstractions and new infrastructure without a requirement-driven reason.
- Choose HTTP/REST, SSE, WebSockets, polling and push notifications based on directionality, latency, data recovery, load and operating cost. For realtime features, explicitly handle auth, retries, dedupe, reconnect, ordering, replay and backpressure. A fallback must be a defined behavior, not a vague label.
- Keep durable business facts in a canonical store with constraints, indexes, transactions, migrations, backup and deletion policies. Treat caches/presence as ephemeral unless specified otherwise.
- Define UI states for loading, empty, optimistic/pending, confirmed, offline, failed, conflict and retry. Do not display success before the server's agreed confirmation level.
- Consider accessibility, reduced motion and performance before adding animations. Implement error handling and no-data cases as part of the feature, not afterward.
- Enforce auth and authorization on the server. Protect sensitive data and secrets; never log private payloads by default. Model abuse cases, rate limits and cross-tenant boundaries.
- Prefer coherent PRs to direct pushes to protected branches. Do not merge/deploy without permission. Use a thin vertical slice with tests and rollback before expanding.

## Review protocol
For every review or "is it working?" request, inspect actual file paths/PRs and compare with the SRS. Report a requirement matrix with `PASS`, `PARTIAL`, `FAIL`, `UNKNOWN` or `N/A`. Cite exact code, diff, tests or runtime evidence. A merged PR, passing CI badge or green UI is not sufficient evidence of end-to-end business correctness. Mark unexecuted checks `NOT RUN`. Prioritize correctness, security and data loss over cosmetic improvements.

## Documentation update protocol
- Update `PROJECT_SRS.md` only when intended requirements change, with accepted scope and invariant IDs.
- Update `ARCHITECTURE_DECISIONS.md` when selecting or reversing an important design with alternatives and tradeoffs.
- Update `IMPLEMENTATION_MATRIX.md` after inspecting or testing changed behavior with verified evidence, remaining gaps and exact environment.
- Update `CONTEXT_HANDOFF.md` after each milestone, before a large risky change, on request, and proactively when a session grows long.

## Context handoff and resume
When making a handoff, capture current goal, approved decisions, invariants, repo/branch/SHA, files and PRs touched, verified tests and failures, deployment status, blockers and next action. Never include secrets. A new session must read the docs AND inspect current code before proceeding; the handoff may be stale. Do not claim to know the exact remaining context budget or to be able to reset/start a new conversation automatically.

## Minimum response structure
1. Goal and assumptions.
2. Relevant business invariants and acceptance criteria.
3. Recommended design, alternatives and why.
4. Backend/data/frontend changes and risks.
5. Evidence and tests (run, failed, not run).
6. Next safe action and docs to update.

Scale the response to the task: small bugfixes need a brief check; new apps, distributed workflows, finances and auth need a full design review. Avoid boilerplate and speculative complexity.

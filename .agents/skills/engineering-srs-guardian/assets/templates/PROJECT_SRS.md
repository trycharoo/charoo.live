# Software Requirements Specification (SRS): [Project name]

> Living product-engineering contract. Update when a requirement or its acceptance criteria changes. An implementation is not complete because a screen exists or a PR merged; verify behavior end to end.

| Field | Value |
|---|---|
| Status | DRAFT / APPROVED / IN REVIEW |
| Version / updated (UTC) | v0.1 / YYYY-MM-DD |
| Product owner | [Name / role] |
| Engineering owner | [Name / role] |
| Repository and primary branches | [URLs / branch names] |
| Environments | [local, staging, prod] |
| Related docs | `ARCHITECTURE_DECISIONS.md`, `IMPLEMENTATION_MATRIX.md`, `CONTEXT_HANDOFF.md` |

## Quick orientation (read first)
- **Product in one sentence:** [What it does and for whom]
- **Current milestone:** [One end-to-end outcome]
- **User journey:** [Entry -> key action -> confirmation -> recovery]
- **Nonnegotiable business rules:** [Reference INV IDs]
- **Approved architecture:** [Brief description; link ADR IDs]
- **Current implementation state:** [What is actually verified; link matrix]
- **Blocking questions:** [Only decisions that would materially alter the implementation]

## Table of contents
1. Problem, goals and success metrics
2. Users, roles and use cases
3. Scope and release boundaries
4. Domain model and business invariants
5. Functional requirements and acceptance criteria
6. Nonfunctional requirements and service targets
7. System architecture and integration design
8. Backend services and API contracts
9. Data model, consistency and lifecycle
10. Frontend, UX and offline behavior
11. Security, privacy and abuse resistance
12. Reliability, observability and operations
13. Testing strategy and traceability
14. Deployment, rollout and rollback
15. Risks, assumptions, open questions and change control

## 1. Problem, goals and success metrics
**Problem:** [User pain or unmet job]

**Desired business outcome:** [Measurable outcome]

**Product principles:** [e.g., trust before speed, offline-first, reversible actions]

| Metric | Definition | Target | Measurement / source |
|---|---|---|---|
| [M-001] | [Metric] | [Target, or UNKNOWN] | [How measured] |

## 2. Users, roles and use cases
| Actor | Primary job | Permissions / boundary | Failure or abuse considerations |
|---|---|---|---|
| [Role] | [Goal] | [Allowed / forbidden] | [Risk] |

### Core user journeys
For each critical journey capture: trigger -> preconditions -> happy path -> errors -> retry / cancellation -> observable success.

| Journey ID | Actor / trigger | Happy path | Failure / recovery | Linked requirements |
|---|---|---|---|---|
| UC-001 | [Who, when] | [Steps] | [When network, auth, server fail] | FR-001 |

## 3. Scope and release boundaries
| Tier | Included functionality | Why / milestone |
|---|---|---|
| MUST (MVP) | [Necessary user value] | [Reason] |
| SHOULD | [Quality improvement] | [Reason] |
| LATER | [Deferred] | [Reason / trigger] |
| OUT | [Explicit non-goal] | [Reason] |

List external dependencies, budget/hosting limits, supported devices, browsers and offline expectations.

## 4. Domain model and business invariants
Record irreversible, financial, authorization, concurrency and lifecycle rules as stable IDs. A frontend check never replaces a server-side invariant.

| ID | Invariant / forbidden state | Enforcement owner | Counterexample to test |
|---|---|---|---|
| INV-001 | [Must always be true] | [Backend / DB / policy] | [Concurrent or malicious action] |

**Lifecycle / state machines:** [State -> event -> next state; include invalid transitions and timeouts]

**Data ownership:** [System of record for each business entity]

## 5. Functional requirements and acceptance criteria
Use testable, user-observable language and avoid defining a technical solution as the requirement unless it is genuinely a constraint.

| ID | Priority | Requirement | Acceptance criteria | Dependency |
|---|---|---|---|---|
| FR-001 | MUST | [Actor can complete an action under stated conditions] | Given [state], when [action], then [observable behavior], including [failure case] | [INV / API / system] |

For complex flows, expand each FR:
- **Preconditions:** [Required state]
- **Success:** [Server-side change and UI confirmation]
- **Failure:** [Precise user-facing message and invariant protection]
- **Offline or reconnect:** [Queue / reject / recover contract]
- **Concurrency:** [What happens with duplicate, stale or competing requests]
- **Permission check:** [Server-owned authorization rule]

## 6. Nonfunctional requirements and service targets
Set numerical goals only when supported by product needs and measurement capability. No invented SLOs.

| ID | Dimension | Requirement / target | Test or measurement |
|---|---|---|---|
| NFR-001 | Latency | [e.g. p95 event confirmation <= X ms, under Y load] | [Instrumentation/load test] |
| NFR-002 | Availability | [Goal / failure budget] | [SLI] |
| NFR-003 | Scale | [Concurrent sessions, throughput, storage, growth] | [Capacity test] |
| NFR-004 | Security/privacy | [Protection and retention requirements] | [Threat model, tests] |
| NFR-005 | Accessibility | [Keyboard, screen reader, reduced motion] | [Audit/test] |
| NFR-006 | Cost | [Hosting/3rd-party ceiling] | [Projection/usage] |

## 7. System architecture and integration design
**Context / topology:** [Clients -> API -> DB + cache/queue -> workers/providers]

**Trust boundaries:** [What is public, authenticated, internal-only, provider-controlled]

**Architecture overview:** [Modular monolith/microservices, why]

| Concern | Selected pattern | Alternatives considered | ADR / reason to revisit |
|---|---|---|---|
| Command / CRUD API | [e.g., REST] | [Other] | ADR-001 |
| Server -> client events | [WS / SSE / push / none] | [Other] | ADR-002 |
| Offline and recovery | [Outbox + cursor, etc.] | [Other] | ADR-003 |
| Storage | [DB/cache/object store] | [Other] | ADR-004 |
| Work outside request | [Queue / worker / scheduled job] | [Other] | ADR-005 |

**Cross-component sequence:** [Example request, auth, persistence, event, ack, client state]

**Failure topology:** [DB failure, duplicate events, provider outage, reconnect storm, lost acknowledgments]

## 8. Backend services and API contracts
| Endpoint/event | Direction & protocol | Authz | Input/response/schema | Retry/idempotency semantics | Requirements |
|---|---|---|---|---|---|
| [POST /v1/...] | Client -> server / HTTPS | [Rule] | [Schema & errors] | [Key, TTL, dedupe] | FR-001 |
| [event.name] | Server -> client / [WS/SSE] | [Subscription rule] | [Event ID/version] | [Ack, replay cursor] | FR-002 |

Specify authentication/session revocation, rate limits, pagination/cursors, caching, timeouts, versioning, partial failures, backpressure, and delivery guarantees. State explicitly if the design is at-most-once, at-least-once or effectively-once at the **business** level via deduplication.

**Background jobs:** [Ownership, retries, poison messages / DLQ, cleanup cadence]

## 9. Data model, consistency and lifecycle
| Entity | Canonical store | Important fields/indexes | Consistency / concurrency | Retention / deletion / backup |
|---|---|---|---|---|
| [Entity] | [DB] | [Fields, unique and query indexes] | [Transaction / optimistic version] | [Policy] |

Include schema migration and rollback strategy, backups/restoration drills, soft delete vs hard delete, personal data exports, timestamps/timezones, media/blob storage, cascade cleanup, cache invalidation, and schema evolution. Do not put critical durable state only in an ephemeral cache.

## 10. Frontend, UX and offline behavior
**Primary surfaces:** [Screen names, navigation and user flows]

| UI state | User sees | Client behavior | Backend contract |
|---|---|---|---|
| Loading / empty | [Feedback] | [Skeleton / empty action] | [Response] |
| Optimistic / pending | [Local action visible] | [Outbox or transient state] | [Idempotent operation] |
| Confirmed | [Final appearance] | [Reconcile server ID/version] | [Ack/event] |
| Offline / reconnecting | [Explicit status] | [Queue only permitted actions, backoff] | [Replay/sync cursor] |
| Failed / conflict | [Retry, discard, resolve] | [No silent loss or duplicates] | [Error codes / version] |

**Interaction quality:** [Animations, haptics, transitions, reduced-motion alternative, accessibility, virtualized lists, focus/keyboard, scroll restoration and localization]

**State ownership:** [Local cache, normalized client state, server state, conflict strategy]

## 11. Security, privacy and abuse resistance
Threats and controls: authorization bypass / IDOR, rate limiting, input/media validation, XSS/injection, session theft, secret handling, logging redaction, encryption in transit and at rest, data minimization, reports/blocks, moderation and deletion. Identify who can access decrypted data. Specify audit trails and retention rather than vague "secure" claims.

## 12. Reliability, observability and operations
| Signal | What it proves | Threshold / alert | Owner |
|---|---|---|---|
| [Metric, structured event, trace] | [Business or technical outcome] | [Defined / TBD] | [Team] |

Cover tracing across requests and workers, errors visible to the user vs internal errors, dashboards, alert fatigue, disconnect/reconnect storms, queue saturation, deployment topology, provider outages, cost and support procedures.

## 13. Testing strategy and traceability
| Level | Critical coverage | Evidence requirement |
|---|---|---|
| Unit | Domain invariants, serialization, error mapping | Test names + pass result |
| Integration | Authz, DB transactions, API schema, queue behavior | Actual runner result |
| Contract | Frontend/backend payload compatibility | Versioned schema test |
| End-to-end | Main journeys, failure states, offline/reconnect | Test run / reproducible scenario |
| Resilience/load | Duplicates, race conditions, backpressure, restart | Measured results + limits |
| Security | Abuse, unauthorized access, data exposure | Test findings + remediation |

Keep requirement status and source/test links in `IMPLEMENTATION_MATRIX.md`. Design review is not evidence that tests passed.

## 14. Deployment, rollout and rollback
**Environments and configuration:** [List differences, secrets owners; never paste secrets]

**Release steps:** [Migration -> deploy -> smoke tests -> gradual enablement]

**Rollback and compatibility:** [Feature flags, reversible migration, old-client support]

**Done for a release:** All MUST requirements pass accepted gates; no unresolved release-blocking invariants or security defects; operational owner and rollback path are known.

## 15. Risks, assumptions, open questions and change control
| ID | Type | Statement | Impact / mitigation | Owner / next decision |
|---|---|---|---|---|
| R-001 | RISK / ASSUMPTION / QUESTION | [Statement] | [Consequence] | [Action] |

**Change control:** For each scope or architecture change, record affected FR/NFR/INV IDs, decision rationale (ADR), dependent components, migrations, tests and release impact. Do not silently rewrite an approved business rule to match a convenient implementation.

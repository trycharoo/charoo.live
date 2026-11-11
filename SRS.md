# Charoo software requirements specification

This maintained contract guides Charoo changes and reviews; it does not certify every implementation path. Read [AGENTS.md](./AGENTS.md) for agent workflow, [ARCHITECTURE.md](./ARCHITECTURE.md) for design, and [README.md](./README.md) for commands. Preserve requirement IDs across revisions.

## Status and scope

Implementation status and open findings reviewed against the repository on **2026-11-12**. The flags distinguish code that exists today from goals and engineering rules. **CURRENT** describes code presence, not correctness, complete test coverage, or an enabled production integration. Read the open findings before preserving current behavior; buggy behavior is not an intended requirement.

| Flag                  | Meaning                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **[CURRENT]**         | Present in the current implementation; preserve the documented behavior.                                                     |
| **[CONDITIONAL]**     | Implemented integration or feature that requires configuration or an enabled flag. Do not assume it is active in production. |
| **[TARGET]**          | Requirement for new/changed work; full compliance across the existing app has not been established.                          |
| **[POLICY]**          | Engineering or agent workflow rule, rather than a shipped application feature.                                               |
| **[NOT IMPLEMENTED]** | Absent from the current app; mentioning it does not authorize or schedule its implementation.                                |
| **[KNOWN GAP]**       | An observed limitation that remains unresolved.                                                                              |

**[ISSUE]** marks a confirmed incorrect path or known defect in an implemented feature. It is separate from presence/configuration status and links to the findings below. Flagging an issue does not authorize a fix.

When changing an implementation, update its status and relevant evidence in the same change. Distinguish source review, automated tests, runtime verification, and deployment; a build or dry run alone does not establish production readiness.

Current user instructions take precedence. Investigate code/requirement discrepancies; do not redefine requirements to match bugs. Authorized changes update affected requirements, contracts, implementation and validation together.

Charoo provides temporary conversations, shared rooms and persistent contacts. Production uses Cloudflare Workers, Durable Objects, D1, R2 and Queues. Celld supports local development and separate fleet deployment. This baseline requires no PostgreSQL, Redis or application-managed S3 connection.

## Open implementation findings

**Flagged only; no application fixes applied.** A focused source review and isolated local reproductions found the following exceptions to the intended requirements. Detailed triggers, source locations, evidence, limits and suggested directions are in [docs/IMPLEMENTATION_REVIEW.md](./docs/IMPLEMENTATION_REVIEW.md). All remain open. P1 means prompt attention or resolution before enabling the affected integration; P2 means a confirmed defect to schedule.

| Finding                                          | Priority/status            | Incorrect behavior or implementation gap                                                                             | Requirements        |
| ------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------- |
| [IMP-01](./docs/IMPLEMENTATION_REVIEW.md#imp-01) | P1 / confirmed             | An old pending approval grants room read/write access after either party blocks the other.                           | FR-04, FR-07, BE-01 |
| [IMP-02](./docs/IMPLEMENTATION_REVIEW.md#imp-02) | P1 / conditional video     | LiveKit deletion uses the wrong permission, so server-side call termination remains pending.                         | FR-09, BE-03, BE-06 |
| [IMP-03](./docs/IMPLEMENTATION_REVIEW.md#imp-03) | P2 / confirmed             | An unrelated authenticated user with the room UUID can read its private title through join-status.                   | FR-04, FR-07, BE-01 |
| [IMP-04](./docs/IMPLEMENTATION_REVIEW.md#imp-04) | P2 / confirmed             | Stale indexed creator IDs prevent expired guest creators from being deleted after room purge.                        | FR-10, BE-02        |
| [IMP-05](./docs/IMPLEMENTATION_REVIEW.md#imp-05) | P2 / confirmed             | A delayed room-open response overrides a newer room selection.                                                       | FR-11               |
| [IMP-06](./docs/IMPLEMENTATION_REVIEW.md#imp-06) | P2 / confirmed             | A delayed pagination response inserts one room's messages into another room's display.                               | FR-05, FR-11        |
| [IMP-07](./docs/IMPLEMENTATION_REVIEW.md#imp-07) | P2 / confirmed             | Routine refresh discards previously loaded history pages and their pagination position.                              | FR-05, FR-11        |
| [IMP-08](./docs/IMPLEMENTATION_REVIEW.md#imp-08) | P2 / confirmed             | A transient presence failure leaves a healthy socket marked offline and keeps fallback polling active.               | AD-02, AD-03, FR-11 |
| [IMP-09](./docs/IMPLEMENTATION_REVIEW.md#imp-09) | P2 / confirmed, local      | The Celld wrapper ignores file-based backend port overrides while Vite uses them.                                    | AD-04               |
| [IMP-10](./docs/IMPLEMENTATION_REVIEW.md#imp-10) | P2 / confirmed, local      | A healthy port is reused without checking compatibility or applying current environment bindings.                    | AD-04               |
| [IMP-11](./docs/IMPLEMENTATION_REVIEW.md#imp-11) | P2 / previously observed   | Clean workerd development auto-migration fails on multiline D1 SQL; not rerun in this review.                        | BE-07, AD-04        |
| [GAP-01](./docs/IMPLEMENTATION_REVIEW.md#gap-01) | NOT IMPLEMENTED / deferred | Reconnect creation/acceptance are deliberately rejected and the UI is disabled; it is not a working current feature. | FR-06               |

The existing 72-test suite passed. The new local reproductions confirm failures it does not cover. These results do not establish production exploit activity or a complete audit. Provider behavior was checked with a local contract-validating substitute, not a real provider account.

## Functional requirements

- **FR-01 — Identity and consent [CURRENT]:** Guests can enter through consent and nickname confirmation. Age and sex are optional in the UI; supplied profile fields follow shared validation. Guest profile visibility defaults to private. Do not represent consent or optional profile data as verified age or identity. Authenticated sessions persist through normal navigation.
- **FR-02 — Authentication continuity [CONDITIONAL]:** Email and Google sign-in preserve pending room invitations and the profile-confirmation step. Guest upgrades preserve the applicable identity; signing into an existing account preserves that account's history. Email sign-in tokens and OAuth state are one-use; successful sign-in rotates sessions. Keep browser/session binding, PKCE, nonce and mailbox verification checks.
- **FR-03 — Room discovery and creation [CURRENT]:** Users can create shared rooms and use invitations. **[CONDITIONAL]** Available Tonight discovery and creation require verified, online users and an enabled feature. Respect configured creation limits, categories, visibility, verified-only access, slow mode and expiry settings.
- **FR-04 — Invitation lifecycle [CURRENT]:** A full valid invitation URL opens the join flow, survives authentication, and confirms the nickname before joining. Host approval remains required where configured. Pending users can cancel; hosts can approve or reject. Closed, expired, removed or blocked access must not bypass room rules. **[ISSUE]** [IMP-01](./docs/IMPLEMENTATION_REVIEW.md#imp-01), [IMP-03](./docs/IMPLEMENTATION_REVIEW.md#imp-03).
- **FR-05 — Conversations [CURRENT]:** Authorized members can load paginated history, send messages, reply, react and record read receipts. Writes use stable client message IDs so retries create one message. Typing is transient. **[TARGET]** Changed UI flows must tie successful actions to authoritative backend results and provide understandable pending, error and retry states; complete UI coverage is not established. **[ISSUE]** [IMP-06](./docs/IMPLEMENTATION_REVIEW.md#imp-06), [IMP-07](./docs/IMPLEMENTATION_REVIEW.md#imp-07).
- **FR-06 — Matching and relationships [CURRENT]:** Quick chat supports queueing, cancellation and Next. Exclude blocked users and recent pairs according to configured rules. Private/contact requests preserve consent and deduplication. **[NOT IMPLEMENTED]** Reconnect creation and acceptance are deliberately unavailable pending checkout; see [GAP-01](./docs/IMPLEMENTATION_REVIEW.md#gap-01). This availability gap does not remove the intended consent and deduplication requirements for any future reconnect implementation. Contact removal and blocking stop the relevant private interaction. Quick-chat archives obey retention and reconnect eligibility.
- **FR-07 — Moderation and privacy [CURRENT]:** Hosts can close rooms, remove members with a reason, and mute/unmute members. A mute prevents messages, reactions and attachments while retaining permitted reading. Users can block, unblock and report. Stranger profile disclosure requires qualifying participation and still respects profile visibility. Reports and staff evidence access must remain authorized and audited. **[ISSUE]** [IMP-01](./docs/IMPLEMENTATION_REVIEW.md#imp-01), [IMP-03](./docs/IMPLEMENTATION_REVIEW.md#imp-03).
- **FR-08 — Administration [CURRENT]:** Support, moderator and administrator capabilities are role-checked per operation. Preserve settings, report handling, bans/suspensions and audit records. Staff role grants remain an operator action, not a public self-service endpoint. Local no-auth administration must never bypass production authentication.
- **FR-09 — Optional integrations [CONDITIONAL]:** Email needs Mailpit locally or Resend in production; Google needs its complete credential group; uploads need the authenticated scanner; video needs LiveKit; assistant suggestions need a compatible provider. Video and assistant features also require their admin flags. Missing configuration must return an explicit unavailable result. Assistant requests omit conversation history; video tokens require both participants' consent and are call-scoped. **[ISSUE]** [IMP-02](./docs/IMPLEMENTATION_REVIEW.md#imp-02).
- **FR-10 — Expiry and cleanup [CURRENT]:** Apply configured room, guest, request and call deadlines during authorization, before cleanup executes. Temporary conversations and archives expire; contact conversations follow their distinct lifecycle. Cleanup removes expired private content and media, retains necessary version tombstones, and anonymizes eligible retained report/audit identities. **[ISSUE]** [IMP-04](./docs/IMPLEMENTATION_REVIEW.md#imp-04).
- **FR-11 — UI quality [TARGET]:** Changed flows must support narrow/mobile and desktop layouts, keyboard operation, visible labels/focus, readable themes, and clear loading/empty/error states. Preserve invitations, drafts and navigation intent across relevant asynchronous updates. Persist appearance choices without exposing backend implementation details in ordinary user flows. **[ISSUE]** [IMP-05](./docs/IMPLEMENTATION_REVIEW.md#imp-05), [IMP-06](./docs/IMPLEMENTATION_REVIEW.md#imp-06), [IMP-07](./docs/IMPLEMENTATION_REVIEW.md#imp-07), [IMP-08](./docs/IMPLEMENTATION_REVIEW.md#imp-08).

The executable public shapes are in [packages/contracts/src/index.ts](./packages/contracts/src/index.ts); route behavior lives in [celld/features](./celld/features). Validate changes across both boundaries.

## End-to-end application flows

**[CURRENT]** These are the implemented flow paths. Provider-dependent steps remain **[CONDITIONAL]** as noted above.

1. **Enter and identify:** Open the app or an invitation, choose guest or configured sign-in, confirm nickname/profile, and retain the invitation until entry is authorized or a pending/rejected state is shown.
2. **Create and join:** Validate room input, let AppCoordinator record a recoverable creation operation, initialize the authoritative Room, publish required D1 projections, and return the invitation. Joining must follow current eligibility and host approval rules.
3. **Chat:** Load authorized room/history, subscribe to the room socket, submit a REST message with a stable client ID, and commit ciphertext plus durable effects. Notifications trigger authoritative reads; duplicate submissions must not duplicate messages.
4. **Meet and connect:** Check eligibility and blocks, hold a matching lease or respond to a relationship request, and initialize/recover the appropriate conversation. Cancel, Next, leave and block must preserve existing restrictions and consent.
5. **Moderate and expire:** Authorize the action, commit the state change, revoke applicable access, and deliver retryable notifications/projections/cleanup. Authorization deadlines apply even if asynchronous cleanup has not run yet.

## Backend requirements and ownership

**[CURRENT]** The ownership and backend mechanisms below exist in source. Instructions to preserve them are ongoing implementation requirements, not a guarantee that every failure case has been audited.

| Owner                                    | Authoritative responsibility                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Hono Worker                              | Public validation, authentication context, origin/CSRF checks, authorization routing, sanitized errors and provider boundaries |
| D1                                       | Users, sessions, identity flows, profiles, relationships, settings, reports, audits and durable global operations              |
| AppCoordinator                           | Serialized identity/global commands, room initialization, matching reservations and recoverable relationship operations        |
| Room Durable Object                      | Membership, encrypted messages, invitations, moderation, room lifecycle, sockets and local outbox                              |
| Matcher / UserHub                        | Matching leases and selection / presence leases, notification sockets and user limits                                          |
| Discovery / RateLimiter                  | Discovery invalidations / anonymous request limits                                                                             |
| R2 / Queues / alarms / scheduled handler | Private media / durable effect delivery and cleanup                                                                            |

- **BE-01 — Authorization authority [CURRENT]:** D1 room, membership, invitation and entity indexes are query aids. They do not grant permission. Consult the owning authority for history, membership changes, uploads/downloads and socket activity. Recheck current permissions for delivery and revocation; client state is never authorization evidence. **[ISSUE]** [IMP-01](./docs/IMPLEMENTATION_REVIEW.md#imp-01), [IMP-03](./docs/IMPLEMENTATION_REVIEW.md#imp-03).
- **BE-02 — Consistency [CURRENT]:** Keep room-local mutations and their outbox records in synchronous SQLite transactions. Serialize global operations through AppCoordinator and atomic D1 batches. Keep external provider work outside local transactions. Publish versioned projections; stale retries must not overwrite newer state. Acknowledgments wait for the required authoritative commit/projection. **[ISSUE]** [IMP-04](./docs/IMPLEMENTATION_REVIEW.md#imp-04).
- **BE-03 — Recovery [CURRENT]:** Persist effects before dispatch. Retain outbox work until completion, make delivery idempotent, and tolerate duplicates and interruptions. Queue delivery is at least once. Alarms and scheduled recovery must preserve eventual retry after queue exhaustion. Use durable alarms/leases for backend deadlines, not process-local timers as the sole mechanism. **[ISSUE]** [IMP-02](./docs/IMPLEMENTATION_REVIEW.md#imp-02).
- **BE-04 — Confidentiality [CURRENT]:** Store message ciphertext using the existing AES-256-GCM format and room authenticated data. **[POLICY]** Preserve `MESSAGE_KEY` for retained data or design an explicit migration. **[CURRENT]** This is backend encryption at rest, **not end-to-end encryption**: the authorized backend decrypts content. **[POLICY]** Keep secrets out of source, frontend assets, logs, checkpoints and committed configuration.
- **BE-05 — Boundary security [CURRENT]:** Preserve HttpOnly sessions, Secure production cookies, CSRF validation, exact configured browser origins, input/size limits and rate limits. Production browser origin must match the deployed app. **[POLICY]** Accept a client-IP header only when the hosting ingress supplies it. **[CURRENT]** Cloudflare production is configured to use `CF-Connecting-IP`.
- **BE-06 — Media safety [CONDITIONAL]:** Media safety is implemented, but uploads require scanner configuration. Keep R2 media private. Quarantine uploads until validated sanitized output exists. Scanner capabilities must be authenticated, short-lived and scoped to the object, attempt and operation. Approval and download recheck access; failed deletions and call termination remain retryable durable effects. **[ISSUE]** [IMP-02](./docs/IMPLEMENTATION_REVIEW.md#imp-02).
- **BE-07 — Persistence evolution [POLICY]:** Append migrations rather than rewriting applied history. Preserve existing Durable Object names, bindings and migration history unless the task authorizes a compatible migration. **[CURRENT]** Production checks that required D1 migrations have been applied, and separate configurations identify Cloudflare and Celld targets. **[POLICY]** Apply migrations before traffic and retain that target separation. **[ISSUE]** [IMP-11](./docs/IMPLEMENTATION_REVIEW.md#imp-11).

## Architecture decisions

- **AD-01 — Public API [CURRENT]:** Hono REST/JSON is the implemented public command/query contract. Shared schemas validate requests. Internal Worker-to-Durable-Object calls use the runtime RPC surface; WebSocket upgrades use the object's fetch surface. **[NOT IMPLEMENTED]** GraphQL is not part of the current API.
- **AD-02 — Realtime [CURRENT]:** Authenticated WebSockets carry user notifications, active-room events and discovery invalidations. Message writes remain REST; socket input is typing/ping. Clients recover authoritative state after reconnect and handle revocation. **[NOT IMPLEMENTED]** SSE is not part of the current realtime transport. **[POLICY]** Prefer existing push channels for new live updates rather than adding unconditional refetch loops. **[ISSUE]** [IMP-08](./docs/IMPLEMENTATION_REVIEW.md#imp-08).
- **AD-03 — Justified timers [CURRENT]:** Current [src/App.tsx](./src/App.tsx) uses a 25-second presence heartbeat, five-second chat refresh only while disconnected, five-second match requests while queued, and four-second pending-join checks. [src/realtime.ts](./src/realtime.ts) pings every 25 seconds and reconnects with capped exponential backoff and jitter. **[POLICY]** Preserve cleanup/cancellation. Document purpose, interval, lifecycle and outage behavior for changed timers; do not describe this hybrid implementation as polling-free. **[ISSUE]** [IMP-08](./docs/IMPLEMENTATION_REVIEW.md#imp-08).
- **AD-04 — Runtime and configuration [CURRENT]:** `wrangler.cloudflare.jsonc` defines Cloudflare production resources and public settings; Worker secrets supply sensitive values. `wrangler.jsonc` and `.env` support the Celld path. Cloudflare builds read public production settings for security headers; secrets are uploaded separately. Local ports come from workspace allocation or explicit overrides. **[ISSUE]** [IMP-09](./docs/IMPLEMENTATION_REVIEW.md#imp-09), [IMP-10](./docs/IMPLEMENTATION_REVIEW.md#imp-10), [IMP-11](./docs/IMPLEMENTATION_REVIEW.md#imp-11).
- **AD-05 — Proportionate changes [POLICY]:** Reuse existing contracts and authorities. Transport replacement, a second source of truth, an encryption format change or a new persistence service is a material architecture change. When the task authorizes one, record: requirement/problem; chosen design and rejected alternatives; affected contracts/state; migration and rollback; security/recovery implications; acceptance evidence. Update this decision section or link an ADR. Routine implementation choices do not require a separate approval ceremony.

## Validation and operation

**[CURRENT]** These commands exist in the repository. Their presence does not mean a check ran or an external action is authorized. The verification guidance following the table is **[POLICY]**.

| Command                              | Scope                                                            |
| ------------------------------------ | ---------------------------------------------------------------- |
| `pnpm setup`                         | Fill missing local configuration; retain existing encryption key |
| `pnpm dev:celld` + `pnpm dev`        | Local backend + Vite frontend; open Vite's printed URL           |
| `pnpm check`                         | Types and SQLite-backed application tests                        |
| `pnpm test:browser`                  | Browser scenarios against running services                       |
| `pnpm test:native`                   | Isolated Celld runtime/provider scenarios and restart checks     |
| `pnpm run build:cloudflare`          | Cloudflare production frontend build                             |
| `pnpm run deploy:cloudflare:dry-run` | Cloudflare bundle/configuration check without publishing         |
| `pnpm run db:migrate:cloudflare`     | Apply migrations to configured remote D1                         |
| `pnpm run deploy:cloudflare`         | Publish Cloudflare Worker; initial secret upload follows README  |
| `pnpm run secret:cloudflare NAME`    | Interactive Cloudflare secret update                             |

Validate the changed requirement: backend success and relevant denial, duplicates/retries, expiry and interruptions; realtime reconnect, revocation and subscription cleanup; affected UI flows and responsive states. Runtime-specific changes need actual workerd/Cloudflare validation; Celld success alone does not prove Cloudflare behavior. Report actual test results.

**[KNOWN GAP]** [IMP-11](./docs/IMPLEMENTATION_REVIEW.md#imp-11): local workerd automatic development migration through multiline `D1.exec()` fails on the quick-chat archive migration. Explicit Wrangler migrations and the production pre-applied-migration path were validated. Preserve production migration checks. No numeric availability/latency SLO is currently specified. **[POLICY]** Agree on measured targets when required before claiming an SLO.

**[POLICY]** For long sessions, follow [AGENTS.md](./AGENTS.md) and persist the current objective, decisions, changed files, checks and next steps using [docs/HANDOFF_TEMPLATE.md](./docs/HANDOFF_TEMPLATE.md). A checkpoint supports recovery after compaction or a new session; it does not replace this shared contract.

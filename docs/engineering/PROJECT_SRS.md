# Charoo engineering requirements index

Initialized **2026-11-12** from the supplied Guardian SRS template, adapted to this existing repository. **[SRS.md](../../SRS.md) remains the authoritative product and implementation contract.** This index supplements it without creating a second specification, renumbering requirements, approving new features or certifying production behavior.

| Field | Baseline |
|---|---|
| Product | Temporary conversations, shared rooms and persistent contacts |
| Documentation scope | Repository skill/workflow setup; subsequent FR-12 quick-chat disclosure requirements only |
| Source examined | `8de390733d421b78f71aaf1f30974ba0f7382c65`; setup edits described in the handoff |
| Requirements and flags | [SRS status and scope](../../SRS.md#status-and-scope); retain its presence, configuration, target, policy, gap and issue distinctions |
| Architecture | [ARCHITECTURE.md](../../ARCHITECTURE.md), [SRS decisions](../../SRS.md#architecture-decisions), [decision log](ARCHITECTURE_DECISIONS.md) |
| Evidence | [Implementation matrix](IMPLEMENTATION_MATRIX.md), [existing findings](../IMPLEMENTATION_REVIEW.md) |
| Continuity | [Shared handoff](CONTEXT_HANDOFF.md), [private checkpoint template](../HANDOFF_TEMPLATE.md), [agent rules](../../AGENTS.md) |
| Ownership | Individual product/operations owners and a formal signoff process are not specified in the inspected documents |

## Objectives, roles and scope

Confirmed product scope is in [SRS functional requirements](../../SRS.md#functional-requirements). Guests enter with consent and a nickname; registered users use configured email/Google authentication, rooms, matching and relationships. Hosts approve access and moderate rooms. Support, moderators and administrators have operation-specific permissions; staff role grants require operator access (FR-01–FR-08).

The [end-to-end flows](../../SRS.md#end-to-end-application-flows) cover entry/authentication, room creation/joining, authorized messaging, matching/relationships, moderation and expiry. Providers and flags gate discovery, email, Google, uploads, video and assistant functionality (FR-03, FR-09). Reconnect creation/acceptance is unavailable (FR-06 / GAP-01); consent is not verified age or identity (FR-01).

The initial skill setup authorized no application changes. The subsequent user request approves the **FR-12 target requirements** for quick-chat ASL and voluntary profile-picture reveal; it requests documentation only, not implementation, deployment, migration or runtime configuration changes.

## Requirements, invariants and acceptance criteria

Use the exact requirement text/status in the SRS. These checks restate existing intent for future verification; they are neither passing evidence nor an exhaustive replacement for its acceptance contract.

| Requirements | Representative acceptance check |
|---|---|
| FR-01, FR-02 | Given guest entry or configured sign-in, preserve the appropriate identity/profile and pending invitation; reject reuse of one-use credentials. Optional profile data follows shared validation. |
| FR-03, FR-04 | Given creation or invitation entry, enforce configured eligibility, expiry and host approval. Pending requests must not bypass later blocks. IMP-01/IMP-03 remain open. |
| FR-05 | Given an authorized submission retried with the same client ID, persist one logical message and return the authoritative outcome. Keep history scoped to its room. IMP-06/IMP-07 remain open. |
| FR-06, FR-07 | Given matching, consent, block, mute or removal actions, enforce applicable server-owned participation rules. Preserve the reconnect gap and privacy findings. |
| FR-08 | Given a staff action, authorize its specific role and audit it. Production requires authentication even if development no-auth administration is configured. |
| FR-09 | Given an unconfigured provider or disabled feature, return explicit unavailability. When enabled, enforce scanner capabilities, call consent and history-free assistant requests. IMP-02 remains open. |
| FR-10 | Given an expired resource before cleanup runs, authorization rejects expired access; cleanup follows retention/anonymization rules. IMP-04 remains open. |
| FR-11 | Changed flows need usable mobile/desktop, keyboard/focus, loading/error/retry states and preservation of navigation intent. This is a target; IMP-05–IMP-08 remain open. |
| FR-12 | [Quick-chat milestones](../../SRS.md#quick-chat-disclosure-milestones-fr-12): at least five qualifying messages **each** make permitted ASL eligible; at least ten **each** notify both and prompt owners with pictures. Only an owner's approval reveals their own picture. Decline/dismissal keeps it hidden with a share-later chat notice/action. Target only; not implemented. |
| BE-01–BE-07 | [Backend requirements](../../SRS.md#backend-requirements-and-ownership): authoritative access checks, transactional state/outbox commits, recovery, confidentiality, boundary security, media safety and persistence evolution. |
| AD-01–AD-05 | [Architecture decisions](../../SRS.md#architecture-decisions): REST/WebSocket split, justified timers, separate runtime configurations and proportionate changes. |

Business invariants retain existing BE/FR IDs instead of duplicate `INV-*` numbers. D1 indexes do not grant access (BE-01); retries preserve stable operation IDs and durable recovery (FR-05, BE-02/03); ciphertext format/key continuity and backend credentials remain protected (BE-04); migrations and binding identities remain stable (BE-07).

## Source-backed assessment and system boundaries

These observations describe inspected source/configuration, not production execution. The [matrix](IMPLEMENTATION_MATRIX.md) supplies per-requirement evidence and limits.

| Boundary | Repository evidence and responsibilities |
|---|---|
| Frontend | React 19, TypeScript and Vite in [package.json](../../package.json); orchestration in [App.tsx](../../src/App.tsx), room/join/call/theme components, [API client](../../src/api.ts) and [realtime client](../../src/realtime.ts). Client state never grants permission. |
| API | [Hono app](../../celld/http/app.ts), [boundary context](../../celld/http/context.ts) and [feature routes](../../celld/features); shapes in [shared contracts](../../packages/contracts/src/index.ts). REST performs commands/queries; authenticated sockets deliver updates and typing/ping. |
| Ownership/data | [AppCoordinator](../../celld/durable-objects/app.ts), [Room](../../celld/durable-objects/room.ts), [Matcher](../../celld/durable-objects/matcher.ts), [hubs](../../celld/durable-objects/hubs.ts). D1 holds global records/projections; Room SQLite owns membership/history/outbox. See [authorities](../../SRS.md#backend-requirements-and-ownership). |
| Background work | [Worker queue/scheduled handlers](../../celld/index.ts) retry effects and cleanup; alarms provide recovery. R2 holds private media; provider work occurs outside local transactions. |
| Infrastructure | [Cloudflare production config](../../wrangler.cloudflare.jsonc), [Celld local/fleet config](../../wrangler.jsonc), [operational commands](../../README.md#cloudflare-deployment). Configuration does not prove live deployment or enabled providers. |

## Data, security and integration contracts

[Migrations](../../celld/migrations) and Room initialization define persisted schema. Follow BE-01–BE-07 for permission, transaction, projection, expiry, retention, deletion and migration rules. [Cryptography](../../celld/shared/crypto.ts) uses AES-256-GCM at rest with room authenticated data; the backend decrypts, so this is not end-to-end encryption.

Public requests remain under `/api`; payload schemas are [shared contracts](../../packages/contracts/src/index.ts), with behavior in routes. Notification, room and discovery sockets use `/api/events/socket`, `/api/rooms/:roomId/socket` and `/api/discovery/socket`. Reconnection repairs authoritative state; message writes remain REST with `clientMessageId`. Preserve origin/CSRF, session and current-permission checks across affected boundaries.

[Provider contracts](../../README.md#providers) cover Mailpit/Resend, Google, authenticated scanning, LiveKit and assistant HTTP. Code presence does not establish credentials, flags or provider interoperability. Preserve explicit unavailability and IMP-02's warning.

## Nonfunctional requirements and frontend responsibilities

Security, privacy, recovery and evolution use BE-01–BE-07; responsive/accessibility and honest async feedback use FR-05/FR-11; reconnect/timer/runtime behavior uses AD-02–AD-04. Current code includes presence, disconnected-chat, match and pending-join timers: this is a hybrid push/polling implementation. Preserve cleanup and document changed timer lifecycles.

**Unknown / not specified:** numeric latency, availability, capacity and cost targets; formal backup/restore acceptance targets; measured accessibility compliance. Do not import SLOs or offline-send queues from the skill's worked example. Agree on measurements only when relevant to an authorized task.

## Verification, risks and maintenance

Use the [SRS command matrix](../../SRS.md#validation-and-operation). Available tests include SQLite-backed Vitest suites, Playwright browser journeys, isolated Celld/provider/restart scenarios and visual comparisons. [CI](../../.github/workflows/check.yml) covers Celld-oriented checks; those results do not establish Cloudflare compatibility. This setup runs documentation/skill checks, not application certification.

[IMPLEMENTATION_REVIEW.md](../IMPLEMENTATION_REVIEW.md) retains IMP-01–IMP-11 and GAP-01. This setup neither reruns their reproductions nor fixes them. Live providers/deployments, multi-node recovery, SLOs and full UI/authorization coverage remain unverified at this assessment level.

The FR-12 follow-up inspected current message counters, ASL settings/snapshots, profile schema/UI and the existing balanced-participation test. Current ASL defaults are ten each, twenty total and a 120-second wait; the new count-based five-each target supersedes those gates for future quick-chat disclosure while retaining meaningful-message and visibility rules. The ten-each profile-picture consent/notification flow is absent. See [PD-01](ARCHITECTURE_DECISIONS.md#pd-01-quick-chat-disclosure-requires-balanced-participation-and-owner-consent); no application tests ran for this requirements-only update.

**Confirmed versus inferred:** the linked SRS is the existing requirements baseline; inspected source/configuration supplies implementation observations; module responsibilities summarized here are engineering interpretations of those paths. Proposed fixes and future measurements are recommendations, not approved work.

The repository already had a substantive SRS, architecture, implementation review and checkpoint template. This installation adds the missing repository skill, consolidated source/test traceability and shared engineering handoff. Update `SRS.md` and affected contracts when approved intent changes; update the matrix when evidence changes; record consequential decisions; refresh both shared and per-agent continuity at milestones.

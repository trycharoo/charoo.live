# Architecture choices: how to reason, not what to copy

Use this guide when designing a new capability, reviewing a surprising design, or proposing to replace polling with streaming. Start with the product's consistency and recovery requirements, not protocol names.

## Questions to answer before picking technology
1. Who initiates changes: client, server or both? Are events frequent or sporadic?
2. Is the feature truly realtime? Define acceptable delay for local feedback, delivery and consistency.
3. How many concurrent connections, messages/sec, peak bursts and offline users are expected? Mark estimates as assumptions.
4. Must messages be durable? Ordered per user/channel? Can they be duplicated? How long can a client be disconnected?
5. Must this work on unstable mobile networks, background tabs, proxies and multiple devices?
6. What operational abilities exist today: sticky routing, horizontal pub/sub, message brokers, observability, autoscaling?
7. Which option meets requirements with the lowest sustained complexity and total cost?

## Choosing delivery mechanisms

| Pattern | Good fit | Avoid or supplement when | Delivery / recovery considerations |
|---|---|---|---|
| REST/HTTPS request-response | CRUD, sends, historical sync, pagination, uploads, commands | Need immediate unsolicited events | Retry-safe mutations need idempotency keys; use cursors and conditional requests |
| Server-Sent Events (SSE) | Mostly one-way live feeds, notifications or dashboard events, simple HTTP infrastructure | Frequent client-to-server interactive events or unsupported hosting/client constraints | Client sends via HTTP; support `Last-Event-ID` or an explicit durable replay cursor; test proxies, connection timeout and reconnect |
| WebSockets | Frequent two-way interaction (e.g. active chat, multiplayer, collaboration) and low-latency bidirectional events | Few events, limited ops capacity or no reconnect/replay design | Define auth, channel ACLs, ping/timeout, server acknowledgment, dedupe, replay, cross-instance fan-out and backpressure |
| Periodic polling | Low-frequency data with tolerant freshness budgets, simple MVPs, external APIs lacking push | Many clients polling seconds apart for realtime delivery, high empty-response cost | Choose interval with actual budget, conditional GET, jitter, pause when hidden; not an accidental substitute for recovery |
| Long polling | Need server push over HTTP without SSE/WS capability | Platform supports SSE/WS reliably | Reconnect and ordering complexity; generally not first choice |
| Mobile/desktop push notifications | Wake-up or user attention while app is backgrounded | Durable state synchronization or guaranteed realtime event delivery | Not a source of truth; fetch authoritative state after opening/reconnect; tokens expire |

**Practical example:** In a bidirectional chat, REST for history and attachments plus WebSockets for live message exchange can be appropriate. SSE for server -> client and REST POST for client -> server can also satisfy a simpler chat product. Both need durable message storage and resume/replay. "WebSockets + REST fallback" is not sufficient by itself: REST GET history may recover missed messages, while REST POST with idempotency may recover sends; neither assures realtime delivery without an appropriate receive path. Do not create a polling loop just because a socket disconnected; use explicit reconnect + cursor sync, bounded retry and visible degraded status.

## Delivery semantics and correctness
- Prefer durable writes to the canonical DB before emitting a "confirmed" event, unless the product explicitly accepts data loss.
- Treat network delivery as potentially duplicated or missing. Use a client-generated operation ID / idempotency key, server-issued stable entity ID and a stream cursor or monotonically increasing per-conversation sequence where order matters.
- Define acknowledgment types: "accepted by server", "persisted", "delivered to device", "read by user" are different milestones. Do not label a message read because it left a socket.
- After reconnect, fetch incremental deltas including edits, deletions/tombstones and permission changes; detect gaps, run a bounded full resync if necessary.
- Make optimistic UI reconcile against server outcomes; show pending, sent, failed, retry, conflict and deduplicated states.
- Specify server-side authorization for all realtime subscription and mutation channels; never trust a client-provided room or tenant ID.
- For horizontal scaling, decide how instances disseminate events (e.g., Redis pub/sub for transient fan-out or a durable broker when replay is needed). A transient channel is not a substitute for canonical storage.
- Document rate limits, payload and attachment size caps, slow-consumer handling, reconnect exponential backoff + jitter, connection limits and heartbeat behavior.

## Data store selection
**Start with the consistency model and query plan.** A relational database is usually a sensible default for transactional identities, relationships, permissions and durable chat metadata. A document store can be better for specific query and operational patterns, but justify the tradeoff. Use a cache only for reconstructible state; verify invalidation and failure behavior. Use object storage for large binary attachments, with signed access and lifecycle management. Use background workers for asynchronous tasks that need retries; define poison-event handling and visibility into failures. Ensure indexes match actual read paths (e.g., tenant/conversation + sequence descending for history), consider partitioning only after data volume motivates it, and test the migration path.

## Architecture boundaries
- Prefer a modular monolith when domain boundaries are still evolving; isolate auth, messaging, billing, moderation, notifications, etc. as deep modules with coherent interfaces.
- Add services only for demonstrated independent scale, security boundary or ownership/release isolation; account for distributed transactions, deployment and observability cost.
- Build shared infrastructure only after a second proven use case; avoid abstracting every future hypothetical.
- Separate business decisions from transport and UI layers; an HTTP handler or WebSocket callback should validate and delegate to the same domain command rather than maintain divergent rules.

## Offline-first is a contract
Choose per operation:
- **Queue:** Safe replayable actions with idempotent server semantics; persist locally and bound retries.
- **Block:** Sensitive or time-critical actions where stale state would be dangerous; tell the user why.
- **Read cache:** Label freshness and prevent accidental assumptions of live truth.
- **Conflict:** Define precedence (server version, conditional mutation, user resolution, CRDT when truly necessary).

On mobile or PWA, test app kill/relaunch, storage eviction, time changes, connectivity flaps, unauthorized/expired sessions and duplicate device logins. Not every product should queue every user action.

## UX, animation and accessibility
UX must reflect the truth of distributed state. Immediate local feedback (optimistic UI) should not falsely imply server persistence. Animate transitions only when they improve comprehension and do not block input, obscure failures or cause layout jumps. Respect reduced-motion settings, focus state, keyboard navigation, screen readers and 60fps budgets where relevant. Virtualize large lists, preserve scroll anchor and explicitly design empty/error/loading/retry states.

## Decision rubric
For each significant option, score qualitatively (LOW/MEDIUM/HIGH or evidence-backed numbers):

| Driver | Questions |
|---|---|
| Correctness | Does it preserve business invariants under retry, concurrency and outage? |
| Experience | Can UI react quickly and recover honestly? |
| Complexity | Operational surface, maintenance burden, team expertise? |
| Cost | Connections, network egress, DB queries, hosting and support? |
| Risk | Security, provider dependence, migration and rollback? |
| Evidence | Benchmarks, existing system behavior, experiments and explicit assumptions? |

Record the choice, alternatives, assumptions, tests and revisiting trigger in an ADR. Do not overbuild based on imaginary scale; leave seams for credible future needs.

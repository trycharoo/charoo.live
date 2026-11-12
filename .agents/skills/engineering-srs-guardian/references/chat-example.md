# Worked example: small modern chat application

This is an **illustrative candidate SRS**, not universal architecture. All product numbers and vendor choices below are placeholders until confirmed. Use it to demonstrate how to turn a vague request ("make a chat app") into robust product behavior, backend contracts, frontend states and executable checks.

## 1. Interpret the request
**Goal:** Users exchange durable direct messages in near-realtime with reliable recovery after disconnection.

**Candidate MVP:** sign in, one-to-one conversation, send/receive text, load history, unread indicators, reconnect/sync, blocking, basic reporting. Attachments, group rooms, search, E2EE, calls and disappearing messages are separate scope decisions.

**Assumptions to validate:** messages need to survive process restart; one authenticated account may have multiple devices; server can read content unless E2EE is explicitly required; order matters within a conversation, not globally; moderate concurrency at launch; mobile/web may lose internet.

## 2. Representative requirements and invariants
| ID | Intent | Acceptance criterion |
|---|---|---|
| FR-001 | User can send text | Given an authorized conversation and network, when sender taps Send, local UI shows pending immediately and server returns durable stable message ID or explicit failure |
| FR-002 | Recipient sees new messages promptly | Given recipient online and authorized, when message is persisted, server emits it over active channel and recipient displays it once even after reconnect/retry |
| FR-003 | Reconnect restores missing activity | Given recipient offline during three messages, when reconnect occurs, incremental history returns all authorized messages, edits and deletions exactly once in the **rendered view** |
| FR-004 | User can browse history | Given a long conversation, when scrolling older messages, stable cursor pagination returns the correct ordered page without duplicates |
| FR-005 | Block restricts contact | Given A blocks B, when B tries to send or subscribe, server denies unauthorized operations regardless of UI state |
| FR-006 | User understands failure | Given offline mode, when a user sends an allowed queueable message, UI shows pending; on timeout/rejection it offers retry/discard and does not claim delivered |
| INV-001 | No unauthorized conversation access | Server checks participant membership and current block state on send, history fetch and event subscribe |
| INV-002 | Retries do not duplicate a logical message | Repeated `client_message_id` from one sender and conversation maps to the same persisted operation |
| INV-003 | Confirmation reflects persistence | "Sent" state cannot appear before durable persistence acknowledgment |
| INV-004 | Per-conversation order is well-defined | Server assigns a stable sequence / cursor for changes within each conversation; UI reconciles rather than trusting client clock |

**Illustrative performance goal, not a claim:** local pending UI within 100ms; online delivery p95 <= 700ms under an explicitly defined load test. Validate these numbers with actual UX and budget before making them commitments.

## 3. Architecture options and recommendation

### Option A: WebSockets for live messages + REST for history/recovery
**Pros:** natural two-way low-latency exchange, typing/presence reuse, interactive features later. **Costs:** connection lifecycle, auth revocation, horizontal fan-out, replay/backpressure, proxies and offline lifecycle. Use if live bidirectional interactions justify the operational work.

### Option B: SSE for inbound events + REST POST for sending and history
**Pros:** simpler HTTP-based server push; robust candidate for message-centric apps with limited interactive signaling. **Costs:** separate send path, infrastructure/client compatibility constraints, reconnect/event cursor work still required. This may be the better MVP design for moderate update volume.

### Option C: 2-second REST polling
**Pros:** trivial initial implementation. **Costs:** large number of empty requests and DB reads, battery/network overhead, variable latency, hidden-tab issues. Prefer only when low update frequency and tolerated staleness make it genuinely cheaper and simpler. Not the default for an interactive chat UX.

**Working selection:** Option A when interactive chat, typing and presence are core near-term requirements and ops support persistent connections. Otherwise evaluate Option B as a simpler first implementation. In either case REST handles paginated history, initial bootstrap and incremental recovery. Offline mobile push is supplementary, never the message source of truth.

## 4. End-to-end message flow
1. UI allocates `client_message_id` (UUID), displays pending bubble and persists it in local outbox.
2. Client sends command over the chosen transport, with auth, conversation ID, idempotency key and content constraints.
3. Server checks current membership/block rules, applies rate limits, and uses DB transaction/unique key `(conversation_id, sender_id, client_message_id)` to deduplicate.
4. DB writes message, stable `message_id`, `conversation_sequence` and change/event metadata. Server sends persisted acknowledgment.
5. Server notifies authorized online participants. Failed transient fan-out does **not** erase durable message; receivers repair on sync.
6. Client reconciles optimistic bubble using `client_message_id` and server IDs; on duplicate deliveries it upserts, not appends. A gap in sequence triggers cursor sync.
7. On reconnect, clients fetch changes since last confirmed cursor, including edit/delete tombstones, then resume live subscription. Race between stream and snapshot is handled via cursor/gap detection.

**Transport-independent domain command:** `SendMessage(actor, conversation, client_message_id, text)` must enforce the same rules through either REST or WebSocket. Avoid two versions of business logic.

## 5. Data model and cleanup
Suggested entities: users, conversations, participants, messages, read positions, blocks/reports, and an outbox/event-log if delivery/replay requirements call for it.

- `messages`: stable ID, tenant/conversation ID, sender ID, client operation ID, server sequence, timestamps, body or ciphertext, deleted marker. Use appropriate uniqueness and index on `(conversation_id, sequence)` for history.
- `conversations`: participants/metadata and server-side ACL ownership; avoid N+1 unread queries for conversation lists.
- Ephemeral typing/online presence: TTL-based cache or live connection bookkeeping; do not turn status heartbeats into unbounded DB writes.
- Media: object storage, file scanning, signed URLs, retention and orphan cleanup if attachments are in scope.
- Message deletion: distinguish local hide, "delete for everyone", redaction and hard deletion. Tombstones preserve cursor continuity. Define retention/backup policy explicitly; avoid copying plaintext to an unprotected archive.
- DB migrations: enforce idempotency uniqueness, indexed pagination and compatibility with older clients. Backup/restore exercise is part of readiness.

## 6. UI and sync policy
**Chat screen:** optimistic bubble, server confirmation indicator, failed/retry state, reconnect banner, unread marker, scroll anchor and virtualized message list. Non-blocking animations for new bubbles/read state; respect reduced motion and avoid auto-scrolling if user is reading history.

**Offline send:** Only queue if product has approved offline messaging. Persist a bounded outbox and recover across app restart; each queued operation reuses the same client ID. If auth expires or participant access is revoked, fail visibly and never silently replay into a forbidden room.

**Ordering:** Reconcile according to server ordering for confirmed messages. Pending local messages have a distinct provisional order; client timestamps are not the source of truth.

**Multi-device:** Track last seen/read state separately from delivery acknowledgments; plan for concurrent device sends and eventual read-position sync.

## 7. Security, reliability and observability
- Authenticated REST and socket/SSE subscriptions with per-conversation authorization; revoke or recheck subscriptions when permissions change.
- Server-side limits on frequency, size and attachments; spam/abuse handling; structured logs with message IDs but not message bodies.
- Metrics: connection count, reconnects, event fan-out lag, send-to-persist latency, duplicate suppression, outbox age, failed sends and history-sync gaps.
- Failure tests: kill server mid-send, drop acknowledgment after DB commit, duplicated replay event, two devices send simultaneously, revoked membership during reconnect, transient DB failure, long-disconnected client, app restart with unsent outbox.
- Design an explicit recovery and rollback path before introducing cross-instance fan-out or async queueing.

## 8. What a proper implementation review should inspect
| Check | Backend evidence | Frontend evidence | Critical scenario |
|---|---|---|---|
| FR-001 + INV-003 | Transaction and ack after commit | Pending -> confirmed mapping | Lost ack after commit |
| FR-002 + INV-002 | Deduplication and event delivery | Upsert-by-ID/event handler | Duplicate event and retried send |
| FR-003 | Cursor/tombstone API | Reconnect logic and gap detection | Offline for hours; messages edited/deleted |
| FR-004 | Indexed cursor query | Virtualized history and scroll anchoring | 10,000-message thread |
| FR-005 + INV-001 | ACL on all read/write/subscription paths | Block state and error UX | Forbidden raw API/socket call |
| FR-006 | Consistent error contract | Persisted outbox and visible retry | Kill app offline then relaunch |

Do not mark any row PASS without actually inspecting the implementation and running or referencing relevant checks. Update the matrix with paths, tests, branch and environment.

# Charoo migration record

## Scope

Implemented in the linked Celld repository, using the current Charoo working tree as the reference, including its uncommitted authentication, Google linking and invitation changes. The original source repository was not edited. Screenshot artifacts were saved in its ignored `.context/` directory.

Application data starts fresh. PostgreSQL and Redis data are not imported. The runtime is Celld 0.6.1; the existing `celld-boilerplate` Worker name, `ROOM` binding, `Room` class and `v1` migration remain. New Durable Object classes are appended in `v2`. Application rooms use `charoo:<uuid>` with `charoo_` SQLite tables.

## Implementation map

| Area                   | Implementation                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design                 | Original React components in `src/`, unchanged CSS, icons, manifest and service worker; Vite development and Celld production assets                        |
| HTTP                   | Feature routes under `celld/features`, Hono context, Zod/Standard Schema validation, origin/CSRF/cookie protection, request IDs and sanitized errors        |
| Identity               | D1 users/sessions/email/OAuth flows; AppCoordinator serialization; guest upgrades, one-use email links, Google PKCE/nonce validation and linking            |
| Invitations            | Persisted room-specific encrypted invitations; guest, Google and email return navigation; membership projection before acknowledgment                       |
| Rooms                  | Room SQLite authority for membership, messages, read receipts, reactions, host removal/muting/closure, slow mode and expiry                                 |
| Encryption             | Web Crypto AES-256-GCM with original authenticated data, `iv.tag.body` format and normalized HMAC fingerprints                                              |
| Realtime               | Hibernatable room, user notification and discovery sockets; current permissions; client backoff/history recovery; REST message deduplication                |
| Discovery and matching | Versioned query indexes, Unicode search, FIFO waiting leases, serialized reservation/cancellation, blocks and recent-pair exclusions                        |
| Presence and profiles  | UserHub leases and fixed availability deadlines; profile visibility and balanced qualifying-message counts                                                  |
| Relationships          | Requests, contacts and reconnects; recoverable, idempotent acceptance; contact removal and blocking effects                                                 |
| Media                  | Authenticated R2 quarantine uploads, attempt/operation-scoped scanner capabilities, sanitized-output checks, approval-gated downloads and deletion outboxes |
| Providers              | Mailpit/Resend HTTP; Google signed identity validation; consent-gated LiveKit JWTs and termination retries; bounded AI prompts without private history      |
| Administration         | Reports with room IDs, audited evidence, staff permissions, settings and operator-only native D1 role grants                                                |
| Recovery               | Atomic D1 batches, synchronous room transactions, durable intents/outboxes, versioned projections, alarms, Queues and scheduled cleanup                     |
| Tooling                | pnpm scripts/lockfile, explicit Worker environment allowlist, private local/deployment configuration, native D1 migrations, CI and deployment instructions  |

D1 query indexes never grant permission. Room history, uploads/downloads, socket activity and room mutations consult authoritative room state. Expired access is rejected before cleanup. Purging removes encrypted content and invitation secrets while retaining a minimal version tombstone to prevent stale projections from recreating content.

## Validation completed

| Check                                             | Result                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Frozen pnpm installation                          | Passed                                                                                          |
| TypeScript, Worker and browser configurations     | Passed                                                                                          |
| Backend suite                                     | 41 tests passed across 5 files                                                                  |
| Native Celld suite                                | 9 scenarios passed, including a real process restart with the same persisted storage            |
| Original browser suite against built Celld assets | 3 scenarios passed                                                                              |
| Original browser suite through Vite development   | 3 scenarios passed                                                                              |
| Visual comparison                                 | 23 exact PNG matches at desktop 1440×1000 and mobile 390×844; no horizontal overflow            |
| Production build                                  | Passed, including generated CSP/security/cache headers                                          |
| Native deployment dry run                         | Passed; Worker `celld-boilerplate`, six DO classes, D1, R2 and Queue bindings, 10 static assets |
| Formatting and Git whitespace checks              | Passed                                                                                          |

Backend scenarios cover concurrent account linking, duplicate contact acceptance, matching/cancellation, available-room limits, duplicate messages and stable creation IDs. They also cover interruptions between stores, recovery without resubmission, presence deadlines, ASL/privacy constraints, expired access and guest cleanup, ciphertext/AAD tampering, authorization denial and provider failures.

The native suite runs real Celld D1, Durable Object SQLite, R2, Queue delivery and sockets with isolated state and controlled HTTP provider fixtures. It verifies production asset headers, REST writes and socket updates, unauthorized socket rejection, email session rotation and invitation return, Google cancellation/PKCE state, concurrent limits/relationships, scanner retries and authenticated downloads, call consent/termination retries, AI privacy, evidence auditing and persistence across restart. It then runs the original desktop/mobile browser suite against the production frontend and Vite development.

Visual fixtures provide identical API data to both repositories. They compare landing, consent, groups, discovery, matching, contacts, profile, administration, chat, invitation and creation screens, plus mobile host controls. Real backend behavior is checked separately by the native suite. The CSS and all public assets are identical to the source files.

The captured baseline and final comparisons are in:

```text
/Users/leandrountal/conductor/workspaces/charoo.test/dushanbe/.context/
  baseline-*.png
  visual/reference-*.png
  visual/migrated-*.png
  visual/comparison.json
```

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
pnpm format:check
pnpm test:native
```

For visual comparisons, start both Vite servers and provide the original server URL:

```sh
VISUAL_REFERENCE_URL=http://127.0.0.1:5175 pnpm test:visual
```

For the development browser suite, run `pnpm dev:celld` and `pnpm dev` in separate terminals, then `pnpm test:browser`.

Production preparation and native D1 migration commands are in [README.md](./README.md). `pnpm run deploy -- --dry-run` prepares a deployable application without publishing; use an ignored production env file and the existing fleet's CLI credentials.

## Deployment checks remaining

Hosting was not provisioned and the application was not published. Real Google, Resend, scanner, LiveKit and AI accounts were not contacted. Their contracts, signatures, consent/error handling and retries were exercised with fixtures. Production D1 migrations must be applied to the chosen running fleet before deployment.

Multi-node ownership handoff/failover needs validation on that fleet. Local tests exercise persistent-state reconstruction, interrupted cross-store recovery and actual Celld process restart; they do not claim to validate a live multi-node handoff. Preserve `MESSAGE_KEY`, configure trusted ingress and provider groups, and monitor outboxes/dead letters as described in the deployment instructions.

# Charoo

Charoo's React application runs on Cloudflare Workers, Hono, Durable Objects, D1, R2 and Queues. Celld **0.6.1** supports local development and optional self-hosted fleet deployment. PostgreSQL, Redis and application S3 credentials are unnecessary.

The original Charoo working tree remains the design reference. React components, CSS, icons, manifest and service worker live in `src/` and `public/`. Vite builds `dist/`, which the selected Worker runtime serves alongside the API.

## Requirements and agent continuity

[SRS.md](./SRS.md) records product flows, backend ownership, REST/WebSocket transport, security, recovery, and acceptance requirements. [AGENTS.md](./AGENTS.md) tells coding agents to read that contract and preserve it during feature work. It also requires a local implementation gist before context compaction or handoff, using [docs/HANDOFF_TEMPLATE.md](./docs/HANDOFF_TEMPLATE.md).

For a harness that does not automatically discover `AGENTS.md`, use this startup instruction: **Read `AGENTS.md` and `SRS.md` before implementing this feature; follow the documented contract and checkpoint/resume procedure.** Commit/merge these repository notes into the branch used for new feature workspaces so those workspaces inherit them. Task checkpoints under gitignored `.context/handoffs/` must be transferred explicitly when continuing the same unfinished task elsewhere.

## Local development

Requirements: Node.js 22.13+ (24 recommended), pnpm 12.9.1, Celld 0.6.1. The scripts find Celld on PATH or at `~/.local/bin/celld`; `CELLD_BIN` can override its location.

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm dev:celld
```

In another terminal:

```sh
pnpm dev
```

Open the URL printed by Vite. In Conductor, Vite uses `CONDUCTOR_PORT` and Celld uses the next port, so separate workspaces can run side by side. Native tests use the next three ports for their runtime, provider fixtures, and test Vite server. Without Conductor's allocation, the defaults remain 5173 for Vite and 9876 for Celld. `VITE_PORT` and `CELLD_PORT` override those choices.

Vite proxies `/api` HTTP and socket requests to Celld. `WEB_ORIGIN` must match the browser origin exactly in production, including its port and without a trailing slash. In development, Vite normalizes same-origin requests to the workspace's configured `WEB_ORIGIN`; direct Celld requests still need a configured origin. `localhost` and `127.0.0.1` are accepted as aliases on the configured port. Guest rooms work immediately. Start Mailpit separately on port 8025 to enable local email sign-in; production uses Resend HTTP.

Room invitation links open the join dialog automatically. Recipients can continue as guests or sign in with Google/email, then enter the invited room using their chosen nickname. Nickname is required; age and sex are optional. New guests keep these details private by default, and returning users retain their profile visibility setting. Google and email returns preserve the invitation until the recipient confirms their profile.

Use **Join a room** on the home screen or in the main navigation to paste a full invitation URL. The app validates the link and continues through the same guest/sign-in and nickname confirmation flow. Rooms that require host approval keep that requirement, and closed or expired invitations are rejected by the server.

Quick chat provides **Next** in the chat header and member sidebar to leave the current conversation and find someone new. Retrying a stale blocked match queues a new conversation instead of failing.

Inside a room, the left sidebar shows members, invitation tools, and host controls. Back restores the main navigation; on mobile, the Members button opens the same sidebar. Hosts can mute members for 30 minutes or unmute them immediately. Muted members can read but cannot send messages, reactions, or attachments. Block/Unblock hides or restores a person's messages for the user who clicks it and stops private interactions.

Appearance is available from the top bar's palette button and the main sidebar, including before sign-in. Choose Pop, Fern, Sunshine, Lavender, Ocean, Mint, Rose, Amber or Slate; switch between light, dark and device appearance; or pick custom accent and background colors. Panels and text adapt across the app, including rooms and dialogs. Changes apply immediately and persist in this browser, with separate custom colors for light and dark appearances. Reset to default restores Charoo's light Pop theme with a warm paper background and bright yellow accents.

The development wrapper excludes test artifacts, `.context`, docs and Vite source files from Celld’s native watcher; backend/config/build changes still rebuild the Worker. Vite owns frontend source updates.

Celld preserves its local state in `.celld/dev`. Development initializes the same SQL migrations used in production and records them in `d1_migrations`. Existing demo Room storage remains isolated: application rooms use `charoo:<uuid>` and SQLite tables beginning with `charoo_`.

`pnpm dev:celld` builds the frontend if `dist/` is absent. To preview a production build directly through Celld, set `WEB_ORIGIN` to the Celld origin, run `pnpm build`, restart Celld, and open the Celld port. Keep the Vite origin in `WEB_ORIGIN` when using Vite.

## Commands

| Command                                                    | Purpose                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm setup`                                               | Fill missing local configuration and generate an encryption key                                         |
| `pnpm dev`                                                 | React/Vite development server                                                                           |
| `pnpm dev:celld`                                           | Native Celld development with persistent storage                                                        |
| `pnpm build`                                               | Check types and build production assets                                                                 |
| `pnpm check`                                               | Check types and run SQLite-backed backend tests                                                         |
| `pnpm test:browser`                                        | Existing desktop/mobile browser scenarios against running Vite and Celld                                |
| `pnpm test:native`                                         | Build, start isolated Celld and fixture providers, run native scenarios, restart and verify persistence |
| `pnpm db:migrate`                                          | Apply append-only D1 migrations to a running fleet                                                      |
| `pnpm admin:grant USER_UUID ROLE`                          | Grant USER/SUPPORT/MODERATOR/ADMIN through operator D1 access                                           |
| `pnpm run deploy -- --dry-run --bucket s3://example-fleet` | Native deployment build without publishing                                                              |

Use `pnpm run deploy` explicitly: pnpm also has its own unrelated `deploy` subcommand. Native flags pass through to Celld. `CELLD_ENV_FILE` selects an application env file; process variables override it. `CELLD_CONFIG` can select a local development config. Host-only overrides stay outside Worker bindings.

## Application environment

`celld/env.ts` declares the current application environment. `WEB_ORIGIN` and `MESSAGE_KEY` are required; `NODE_ENV` selects development or production behavior. Preserve `MESSAGE_KEY` while keeping the same Celld data: existing encrypted messages and room invitations depend on it. Local and production stores do not need a shared key just because the original app used a shared Supabase database.

`ADMIN_NO_AUTH=true` enables admin tools without a staff session in development only. Keep the API on a trusted network; this mode bypasses browser origin checks for admin endpoints, while signed-in sessions still require CSRF tokens. Production always requires staff authentication.

For a separate staff dashboard, set `ADMIN_ORIGIN=http://127.0.0.1:5179` alongside
the chat UI's `WEB_ORIGIN`. Both configured origins are trusted; staff roles and
CSRF checks still apply. Email links requested from the admin origin return to
that dashboard. Staff email/Google sign-ins and sign-outs are audited, and settings
updates record the changed values before and after saving. Authentication tokens
and CSRF values are excluded from audit metadata.

The templates leave optional provider groups commented out. Uncomment and fill a complete group when enabling Google, Resend, scanning, video or AI. These integrations still use their credentials in the Celld implementation.

When carrying an environment file over from the original application, remove the obsolete application settings:

| Original settings | Current configuration |
| ----------------- | --------------------- |
| `DATABASE_URL` | D1 and Durable Object SQLite bindings in `wrangler.jsonc` |
| `REDIS_URL` | Durable Objects, alarms and Queues |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION` | The `MEDIA` R2 binding; fleet object-store credentials stay in the CLI/node environment |
| `SMTP_URL` | `RESEND_API_KEY` and `EMAIL_FROM` for production email; Mailpit for local email |
| `CONDUCTOR_PORT` | First port in this workspace's allocated block; Vite uses it and Celld uses the next port |
| `VITE_PORT` | Optional Vite port override; defaults to `CONDUCTOR_PORT` or 5173 |
| `CELLD_PORT` | Optional Celld port override; defaults to `CONDUCTOR_PORT + 1` or 9876 |
| `TRUST_PROXY_CIDRS` | `TRUSTED_CLIENT_IP_HEADER`, set only behind ingress that strips and supplies that header |

`selectWorkerEnvironment` ignores variables outside the allowlist when generating Worker bindings. Remove obsolete credentials from private application env files as well, so those files describe only the services this app uses.

## Architecture and API

[ARCHITECTURE.md](./ARCHITECTURE.md) describes authorities, recovery and the retained Celld conventions.

The REST API remains under `/api`: authentication, profiles, presence, matching, discovery, conversations, rooms, invitations, messages, read receipts, reactions, host moderation, blocks, reports, requests, contacts, reconnects, media, calls, assistant and staff administration. Messages use REST and retain `clientMessageId` deduplication. Message reports require both `messageId` and `roomId`.

Realtime upgrades are authenticated through Hono:

- `/api/events/socket`: the user's notifications
- `/api/rooms/:roomId/socket`: room events, typing and ping
- `/api/discovery/socket`: public discovery invalidations

These sockets retain authentication metadata during hibernation. Each incoming event and outgoing delivery checks current permissions. Clients reconnect with backoff and reload authoritative history. Close code **4001** means access was revoked; **4002** asks the client to reconnect. Celld 0.6.1's WebSocket API restricts the standard server close codes.

## Providers

Providers are optional; missing integrations return an unavailable response. AI and video also require their admin feature flags to be enabled.

| Provider         | Configuration                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Local email      | `MAILPIT_URL`, `EMAIL_FROM`; Mailpit HTTP `/api/v1/send`                                      |
| Production email | `RESEND_API_KEY`, `EMAIL_FROM`; Resend HTTP                                                   |
| Google           | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; callback `${WEB_ORIGIN}/api/auth/google/callback` |
| Scanner          | `MEDIA_SCANNER_URL`, `MEDIA_SCANNER_TOKEN`                                                    |
| LiveKit          | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`                                        |
| Assistant        | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`; OpenAI-compatible `/chat/completions`                |

Email links and Google callbacks retain shared-room invitations. Google uses PKCE, browser/session-bound one-use state and nonce-checked signed ID tokens. Gmail and Workspace identities can link automatically; other mailboxes require email verification first. Guest upgrades keep their identity. Signing into an existing email account preserves that account's history.

Uploads use authenticated Worker endpoints with origin and CSRF checks. R2 keys remain private. The scanner receives the retained JSON contract:

```json
{
  "url": "temporary read URL",
  "writeUrl": "temporary output URL",
  "mime": "image/png",
  "size": 1234,
  "stripMetadata": true
}
```

It authenticates with the configured bearer token, reads the quarantine object with GET, and writes sanitized output with PUT using the same MIME type. It must return boolean `clean`, `magicBytesValid`, `metadataStripped` and `contentSafe` fields. Output must exist, be nonempty, and fit the declared size. Each URL expires after five minutes and is restricted to one attachment, scan attempt and operation; aborts and approval revoke it earlier. Downloads recheck current membership and approval. Failed deletions and call termination remain in durable outboxes for retry.

The assistant sends a bounded style prompt without conversation history. LiveKit tokens require both users' consent, last five minutes, and grant access only to the corresponding call room. An ended call cannot issue new tokens while provider deletion is retried.

## Cloudflare deployment

`wrangler.cloudflare.jsonc` deploys the `charoo-live` Worker with its Durable Objects to Cloudflare, using the existing `charoo-d1-db` D1 database and `charoo-media` R2 bucket. The browser origin is **https://charoo-live.shy-star-eff8.workers.dev**; `vars.WEB_ORIGIN` must match it exactly. This configuration is separate from local Celld development and the fleet deployment below.

`pnpm run build:cloudflare` uses the public production settings from that configuration for the generated security headers, including LiveKit connection origins when configured. The secrets file is only passed to Wrangler for upload.

Create the `charoo-jobs` and `charoo-jobs-dead-letter` queues once if they do not already exist, then apply the D1 migrations before deployment:

```sh
pnpm exec wrangler queues create charoo-jobs --config wrangler.cloudflare.jsonc
pnpm exec wrangler queues create charoo-jobs-dead-letter --config wrangler.cloudflare.jsonc
pnpm run db:migrate:cloudflare
```

For the first deployment, provide `MESSAGE_KEY` through the private, ignored `.secrets.cloudflare.json` file. It must contain a JSON object mapping secret names to values; `MESSAGE_KEY` must be a base64-encoded 32-byte random key. Keep the file private and retain a secure backup of this key. Deploy the Worker and secrets together:

```sh
pnpm run deploy:cloudflare --secrets-file .secrets.cloudflare.json
```

Later deployments can use `pnpm run deploy:cloudflare` to retain the stored secrets. To add or update a provider secret interactively, run `pnpm run secret:cloudflare KEY`, for example `pnpm run secret:cloudflare GOOGLE_CLIENT_SECRET`. Use the complete provider groups described in `.env.example`: put nonsecret URLs, IDs, model names and email sender settings in `wrangler.cloudflare.jsonc` under `vars`, and upload their secret keys with the secret command. AI and video also need their admin feature flags enabled.

Secrets are available to the Worker and its Durable Objects through `env`; keep them out of frontend code and `VITE_*` settings. Preserve `MESSAGE_KEY` across deployments while retaining the same data: replacing it prevents existing messages and room invitations from being decrypted. The Cloudflare scripts do not load production values from `.env` or `.env.production`.

## Deployment

Hosting provisioning and publishing are separate from this migration. Use an existing running Celld fleet with its normal host credentials.

1. Copy `.env.prod.example` to an ignored application env file, fill `MESSAGE_KEY`, HTTPS `WEB_ORIGIN` and desired provider groups. Preserve the key across deployments: existing ciphertext and invitation links depend on it.
2. Configure TLS and ingress routing for the existing Worker name **`celld-boilerplate`**. For per-client anonymous limits, set `TRUSTED_CLIENT_IP_HEADER` only to a header the ingress strips and supplies. Without it, anonymous clients share a conservative limiter and authenticated clients have individual limits.
3. Apply D1 migrations through the native fleet CLI:

   ```sh
   pnpm db:migrate -- --bucket s3://your-fleet
   ```

4. Prepare the deployable build:

   ```sh
   CELLD_ENV_FILE=.env.production pnpm run deploy -- --dry-run --bucket s3://your-fleet
   ```

5. Publishing, when authorized, uses the same command without `--dry-run`. Startup waits for the expected D1 migration records. Keep the Worker name, `ROOM`/`Room` binding, and existing `v1` migration. New classes are introduced by `v2`; future migrations must be appended.
6. After the operator's account verifies its email, grant its staff role through native D1:

   ```sh
   pnpm admin:grant USER_UUID ADMIN -- --bucket s3://your-fleet
   ```

Fleet credentials such as `CELLD_BUCKET`, `S3_ENDPOINT` and cloud credential-chain variables belong to the CLI/node environment. `celld/env.ts` is the Worker allowlist. `.env`, `.dev.vars` and temporary deployment configs are ignored and written privately. There is no public role-grant endpoint.

The production bindings declare R2 storage, a retry queue/dead-letter queue and a one-minute scheduled handler. Alarms and the scheduled handler retry durable outboxes; queue exhaustion does not discard the original operation. Monitor persistent outbox growth, provider availability and the dead-letter queue. Celld provides the underlying disk, bucket durability and ownership protocol.

## Validation

Install Chromium once with `pnpm exec playwright install chromium`. `pnpm test:native` uses ports `CONDUCTOR_PORT + 2` through `+4` and isolated storage under `.context`; outside Conductor it falls back to 9887, 8026 and 5176. It does not consume production provider credentials. Backend tests use SQLite and controlled provider responses to exercise concurrent linking, matching/cancellation, acceptance, limits, duplicates, permission denial, ciphertext tampering and interrupted projections. Native scenarios exercise real D1, DO SQL, R2, Queues, sockets, provider HTTP adapters and process restart; the same command then runs the original desktop/mobile browser scenarios against both the built frontend and Vite development. The original browser scenarios cover invitations and desktop/mobile host controls.

Real provider accounts and a fleet with multiple nodes are deployment integration checks. The local suite verifies provider contracts and durable recovery without provisioning hosting or contacting those accounts.

## Visual comparison

`pnpm test:visual` compares the original and migrated interfaces with identical, controlled API data at 1440×1000 and 390×844. It covers landing/consent, rooms, discovery, matching, contacts, profile, administration, chat, invitations, creation and mobile host controls. Start the original Charoo Vite server on a separate port, then run:

```sh
VISUAL_REFERENCE_URL=http://127.0.0.1:5175 VISUAL_OUTPUT_DIR=.context/visual pnpm test:visual
```

The report records exact PNG equality and horizontal overflow. Controlled data isolates the design comparison; native browser tests separately check real authentication, storage and sockets. See [MIGRATION.md](./MIGRATION.md) for the implementation and validation record.

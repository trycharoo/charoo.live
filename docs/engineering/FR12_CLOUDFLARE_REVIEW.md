# FR-12 final Cloudflare readiness review

Reviewed 2026-11-12 on `dJangg0/asl-profile-chat-logic`, working tree based on `4f0f6c1`. Scope: the ASL/picture-sharing implementation, responsive UI, private media, Durable Object compatibility, D1 migration and affected provider dispatch. All changes remain local; no remote migration, deployment, commit, push or PR publication was performed.

**Verdict: ready for a controlled Cloudflare test deployment of FR-12, subject to the configuration steps below. This does not clear the existing application-wide production findings.** Root [SRS](../../SRS.md) remains canonical; [the matrix](IMPLEMENTATION_MATRIX.md#fr-12-implementation) records traceability.

## Findings corrected in this review

| Priority | Finding and consequence | Change and regression evidence |
| --- | --- | --- |
| P2 | After five-each ASL unlock, a viewer could still receive public ASL belonging to an expired, banned or suspended peer before background cleanup. | [Room snapshots](../../celld/durable-objects/room.ts) now apply current owner eligibility before disclosure. Three [FR-12 cases](../../tests/fr12.test.ts) verify hidden peer ASL while preserving valid self ASL. |
| P2 | An in-flight scanner callback could finish after approval and overwrite or delete the published image. | [Profile scanner writes](../../celld/features/profile-pictures/routes.ts) use an atomic R2 create-only condition. An internal [published-output check](../../celld/features/profile-pictures/state.ts) preserves the exact approved attempt during late-response cleanup. Two deferred-write/response regressions verify retained immutable output; actual workerd/R2 smoke also replays an output callback with different bytes. |
| P1 for affected integrations | Existing Google, email, assistant, attachment scanning and LiveKit requests used a fetch redirect mode that Workers rejects before dispatch. | Those six calls now use manual redirects and reject non-success/redirect responses. Seven [provider-dispatch cases](../../tests/cloudflare-fetch.test.ts) exercise adapter calls and ensure credential-bearing redirects are not followed. Existing LiveKit management permissions are a separate unresolved finding. |
| Test reliability | A tablet geometry assertion could run during the chat's entrance animation and report a temporarily translated composer as outside the viewport. | [Responsive tests](../../tests/browser/disclosure-responsive.spec.ts) now poll for the settled composer bounds while still failing a persistent overflow. No arbitrary sleep was added. |

The R2 write condition and null-on-precondition-failure behavior follow the [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/). The fetch compatibility restriction is documented in the [Workers Request API](https://developers.cloudflare.com/workers/runtime-apis/request/). Real local workerd execution validates the profile pipeline separately from Node mocks.

## Verification

- `pnpm check`: TypeScript plus **106 tests across 12 files**, including **28 FR-12 cases** and **7 provider-compatibility cases**, pass.
- `pnpm test:native`: **8 native runtime scenarios**, **1 restart-persistence scenario**, then **35 browser scenarios against built assets** and the same **35 against Vite** pass. These include all 12 responsive cases at phone, landscape, tablet and desktop sizes.
- `pnpm run deploy:cloudflare:dry-run`: production frontend build/typecheck and Worker bundle/configuration checks pass without publication. Existing dependency annotation and bundle-size warnings remain.
- All five migrations, including [0005](../../celld/migrations/0005_profile_pictures.sql), applied successfully to clean, isolated local Wrangler D1 storage.
- Production-mode local workerd with real D1/DO/R2 bindings and a contract-validating scanner fixture passed five-each ASL/privacy/no extra age wait, ten-each notification/independent approvals, saved decline/later sharing, private downloads, immutable scanner retries, replacement and stale leave/access rejection.
- Targeted formatting, documentation links and whitespace checks pass. Private local keys are absent from tracked/new source and build assets; `.env` and `.dev.vars` remain ignored.

Local runtime evidence/configuration lives under ignored `.context/fr12-final-cloudflare/`; durable regressions are tracked under `tests/`. Providers were fixtures; actual production provider accounts, remote migrations and live deployment were not exercised.

## Deployment prerequisites

1. Preserve the existing production `MESSAGE_KEY`. The shared local `.env` is for local development and is not automatically uploaded to Cloudflare. If this is the first deployment, follow the private secrets-file procedure in [README](../../README.md#cloudflare-deployment).
2. Apply all required D1 migrations with `pnpm run db:migrate:cloudflare` before publishing this Worker version. The production startup gate requires migration 0005. Existing Durable Object names, bindings and `v1`/`v2` migration history remain unchanged; these JSON-state additions need no new Durable Object class migration.
3. Confirm the configured D1/R2 resources, `charoo-jobs` and dead-letter queues exist, and `WEB_ORIGIN` exactly matches the deployed browser origin. Picture uploads require both `MEDIA_SCANNER_URL` and `MEDIA_SCANNER_TOKEN`; absent configuration explicitly disables uploads. Verify the real scanner's sanitized-output contract before relying on it.
4. When deployment is authorized, use `pnpm run deploy:cloudflare` (the Cloudflare target). Verify authenticated ASL and picture-sharing flows with two accounts, consent after reload, private image denial before approval/after leaving, and cleanup/outbox behavior on that actual deployment.

## Remaining production findings

The earlier [implementation review](../IMPLEMENTATION_REVIEW.md) remains relevant. In particular, **IMP-01** is an existing shared-room pending-approval/block bypass, and **IMP-02** is an existing LiveKit management-grant defect that prevents reliable server-side call termination when video is enabled. Neither was silently changed by this feature/readiness review. Resolve IMP-01 before treating shared-room authorization as production-ready; keep video disabled until IMP-02 is resolved and verified. The remaining documented P2 findings and deferred reconnect gap are also unchanged.

# Charoo shared engineering handoff

Updated **2026-11-16** after authorized crawler implementation and production recovery. [SRS.md](../../SRS.md) remains canonical. Recheck repository and external state before continuing; completed production actions below must not be replayed blindly.

| Field | Current state |
| --- | --- |
| Repository / workspace | Charoo / `dhaka` |
| Branch / base | `dJangg0/crawler-rate-limit-production-fix` / `origin/main` at `f9fff705664d8079f6860acc988c72914e2dfce6` |
| Objective / delivery | Add crawler throttling; diagnose and repair production startup; record the change in a new PR. Production recovered and source ready for review. |
| Production | `charoo-live`, https://chat.charoo.live; version `3b93037b-d14f-4274-8678-9cb82a7f2d91` |
| Task checkpoint | `.context/handoffs/production-503-root.md`; crawler implementation details in `.context/handoffs/crawler-rate-limit-root.md` |

## Implementation

- The fetch gateway reuses RateLimiter for a separate durable per-trusted-IP crawler quota: default 30 requests per 60-second window, configurable through `CRAWLER_REQUESTS_PER_MINUTE`. Paths, methods and crawler identities share allowance. Excess returns `429` with no-store and Retry-After 60; limiter failure returns sanitized `503`; HEAD rejection bodies are empty. Health checks are exempt. Missing trusted IP skips this quota.
- Cloudflare production/staging use Worker-first routing and `ASSETS.fetch` for frontend files, retaining asset headers and SPA fallback without application/session work. Ordinary browser agents skip crawler RPCs. All Cloudflare assets now invoke Worker; crawler checks add DO calls. Celld retains asset-first behavior, so its static files are outside this quota.
- Guest access and optional sign-in remain available. Existing guest-session quota is 10/hour per client key; general API quota is 180/minute. No mandatory login or CAPTCHA added. User-agent detection is evadable, and shared/distributed IPs limit precision. Traffic effectiveness and cost remain unmeasured.
- SRS BE-05, architecture/README, ADR-02 and the implementation matrix record the contract and verification limits.

## Production incident and authorized recovery

- After the user's deployment of version `bc3048a6-3db6-4392-906b-ed00ed51bbef`, HTML loaded but API health returned `503`. Metadata-only checks confirmed production had migrations 0001–0004 but lacked `0005_profile_pictures.sql`. The existing readiness gate correctly refused startup. The deploy script publishes code; it does not apply database migrations.
- The same deployment reverted WEB_ORIGIN to the Workers URL; custom-domain Origin requests failed `403`. The checked-in production origin and README now use `https://chat.charoo.live`, guarded by a regression assertion.
- The user explicitly authorized the fix and a new PR. Applied existing migration **0005** to production D1 `7db6b08c-c9ef-44ae-8815-0c789eac81ff` at **2026-11-16 14:41:40 UTC**. It adds the profile-picture table/index; no deletion or backfill. No migrations remain pending.
- Published corrected production Worker version **`3b93037b-d14f-4274-8678-9cb82a7f2d91`**, created **2026-11-16T14:42:12.918Z**. Existing resource identities and secret bindings retained; secrets were not replaced. Do not reapply migrations or deploy again without checking current state and the next task's scope.
- Verified both production hostnames: API health `200`; custom-origin provider discovery `200` with exact CORS; unauthenticated account access `401`; foreign origins `403`. Google provider availability remains true. No real user sessions, conversations, signed-in workflows or provider completion were exercised.

## Verification and continuity

- PASS: `pnpm check`, **138 tests**, including **30** crawler/config/guest cases. Focused HTTP/crawler origin-correction checks also passed **44/44**.
- PASS: production/staging builds and dry runs; final production build/publish; targeted source/test Prettier; `git diff --check`. Existing third-party annotation/chunk-size warnings remain.
- PASS: isolated actual local workerd/DO smoke for SPA/assets/API routing, retained headers, shared quota, HEAD, IP/browser behavior and health. Setup/results are ignored under `.context/crawler-cloudflare/`; lasting regressions are tracked in `tests/crawler-rate-limit.test.ts`. Temporary runtime stopped.
- No full browser/native suite rerun for this gateway change. Remote smoke does not certify signed-in behavior, load or quota effectiveness. Existing IMP-01/IMP-03 access-control issues and conditional IMP-02 remain open.
- Fresh PR branch created without renaming the original workspace branch. Preserve the user's unrelated Celld Worker-name change in `wrangler.jsonc` and earlier diagnostic documentation outside this PR. Do not add `.context`, credentials or private content to Git.
- Existing isolated staging resources/migrations/separate key remain; this recovery changed production only. Preserve its key backup. Cloudflare Builds automation configuration remains unverified; repository CI checks code but does not publish it.

## Next action

Review/merge the crawler and production-origin change into `main`. Production is already recovered; merging alone does not require repeating the live repair. Recheck the actual deployed version and migration state before any future release. If disguised guest automation becomes a confirmed issue, evaluate a separately scoped human-verification layer.

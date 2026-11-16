# Staging and production deployment drift

**Historical snapshot, superseded by production recovery:** This review predates the subsequent production rollout and repair. Production migration 0005 is now applied and Worker version `3b93037b-d14f-4274-8678-9cb82a7f2d91` uses `https://chat.charoo.live`. The older deployment/origin observations below remain evidence of the earlier state; see the [current handoff](CONTEXT_HANDOFF.md) for recovery and verification.

Verified read-only on **2026-11-16**, from workspace `dhaka`, branch `dJangg0/cloudflare-durable-objects-blueprint`, HEAD `9459e4a1bdb57a60ee1ad01599ca6f60b4493685`. Scope: SRS AD-04 and the environment configuration aspects of BE-04/BE-05. No application change, deployment, migration, domain change or credential mutation was performed.

## Finding

**Confirmed deployment drift:** production still serves an older application. Staging received a newer Wrangler code upload; production's subsequent dashboard versions only record binding, variable and secret changes.

All times below are **Asia/Manila (UTC+08:00)**, converted from Cloudflare timestamps.

| Evidence | Production | Staging |
| --- | --- | --- |
| Public URL | https://chat.charoo.live/ | https://charoo-live-staging.shy-star-eff8.workers.dev/ |
| Worker | `charoo-live` | `charoo-live-staging` |
| Last code upload in complete version history | Nov 11, 14:07:58; `85213c11-2824-4987-b79b-7b0f65c11e14`, Wrangler | Nov 16, 15:05:56; `17f1ade6-612c-4112-b9da-579472019756`, Wrangler |
| Active version, receiving 100% traffic | `613cfd8a-0093-4ba4-8cc5-873641eb4314` | `aeef1266-7b4c-4aa6-9523-88145b16068c` |
| Active version's change | Nov 16, 15:29:29: `Updated variable: WEB_ORIGIN` | Nov 16, 15:15:51: `Updated secret: GOOGLE_CLIENT_SECRET` |
| Served JavaScript | `index-DlURj3zp.js` | `index-C1WsMaMQ.js` |
| Served CSS | `index-BvlGBEO6.css` | `index-DF5vWxMj.css` |
| HTML title | `Charoo — one link, everyone’s in` | `Charoo — Chat, Ready.. Go!` |

Production has 13 recorded versions: the original Wrangler upload and 12 dashboard versions whose annotations identify configuration changes. Staging has 10 versions, including two Wrangler uploads. Public bundle inspection finds timeout and disclosure UI markers in staging that production lacks; marker inspection does not verify those workflows at runtime.

## Git source and domain checks

- GitHub reports `trycharoo/charoo.live` has default branch `main`. `git ls-remote origin` confirms `main` at `f9fff705664d8079f6860acc988c72914e2dfce6` (PR #14, isolated staging and quick-chat timeout). Its source tree equals the current workspace's tree. The newer source has reached main; that does not establish the exact commit running in either environment.
- [CI](../../.github/workflows/check.yml) runs verification and a Celld dry run. It contains no Cloudflare publishing step. [Package scripts](../../package.json) explicitly deploy production with `wrangler.cloudflare.jsonc` and staging with `wrangler.staging.jsonc`; these commands publish the local checkout and do not select a Git branch.
- Cloudflare's domain API maps `chat.charoo.live` to service `charoo-live`, environment `production`. Cache-busted GETs to that hostname and `charoo-live.shy-star-eff8.workers.dev` return byte-identical HTML. Both differ from staging. The observed difference therefore exists at the server, independently of browser cache.
- **Unverified:** Cloudflare Workers Builds Git repository/branch settings. Requests to the documented [trigger-list endpoint](https://developers.cloudflare.com/api/resources/workers_builds/subresources/triggers/methods/list/) using the actual Worker tags returned `10000 Authentication error` for both Workers. Current Wrangler credentials can inspect Workers but cannot inspect this Builds configuration. Do not infer that a Git integration exists or is absent, or that it points to a particular branch. Version annotations contain no Git commit SHA.

## Configuration reconciliation before a future release

Live production `WEB_ORIGIN` is already `https://chat.charoo.live`; staging uses its staging URL. Both Workers now bind `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as `secret_text`. This supersedes the earlier handoff's plaintext-secret/origin observations; credential rotation itself was not verified.

The checked-in [production configuration](../../wrangler.cloudflare.jsonc) still sets `WEB_ORIGIN` to `https://charoo-live.shy-star-eff8.workers.dev`. Its custom domain is dashboard-managed. A future production release should reconcile this public setting and preserve existing secrets, resource identities and routes. Verify production D1 migrations before publishing newer code; this investigation did not query application data or migration state.

Recommended next step: prepare a production release from current main with the correct production origin and verified migrations, then deploy explicitly to `charoo-live` and verify the public assets and affected application flows. If automatic deployment is desired, separately verify/configure its Git connection and production branch. No release or CI change is authorized by this diagnostic request.

## Verification limits

Executed: Git remote/ref and tree comparisons; source/config/CI inspection; Cloudflare domain, complete version history and active deployment reads; sanitized binding metadata; public GETs and bundle comparisons. [Cloudflare's version-list API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/list/) returned 13/13 production and 10/10 staging versions with `per_page=100`. Metadata was filtered before saving; no secret values are included.

Application tests/builds were not rerun for this documentation-only investigation. No signed-in sessions, conversation data, writes, matching, OAuth completion or provider flows were exercised. Public evidence and sanitized metadata are in the workspace's gitignored `.context/`; they do not transfer with Git. Existing implementation findings remain open.

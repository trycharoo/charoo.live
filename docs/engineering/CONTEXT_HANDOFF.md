# Charoo shared engineering handoff

Sanitized summary for the latest milestone. Root `SRS.md` remains canonical. Use the matching private checkpoint and recheck branch, HEAD, worktree and any external state before continuing. Earlier requirements-only scope is superseded by the explicit FR-12 implementation request.

| Field | Latest implementation milestone |
| --- | --- |
| Updated | 2026-11-12, FR-12 implementation and local verification complete |
| Repository / workspace | Charoo / `gwangju` |
| Branch / target | `dJangg0/asl-profile-chat-logic` / `origin/main` |
| Starting HEAD | `4f0f6c1fc54b0da446118a56a3186f6a82206346`, matched freshly fetched main at initial review |
| Objective | Implement five-each ASL and ten-each voluntary picture sharing under FR-12 |
| State | Implemented and locally verified; working-tree changes, no commit/push/PR/deployment performed |
| Private checkpoint | `.context/handoffs/fr12-final-review-root.md` (latest review); earlier implementation details in `.context/handoffs/fr12-implementation-root.md` |

## Final Cloudflare readiness review

[Final report](FR12_CLOUDFLARE_REVIEW.md): ready for a controlled FR-12 Cloudflare test deployment after configuration, while existing application-wide IMP-01 (shared-room pending approval bypasses blocks) and IMP-02 (conditional LiveKit management grant) remain production concerns. No remote deployment, migration, commit, push or PR was performed.

Corrected unavailable-owner ASL disclosure, a scanner output retry race that could overwrite/delete an approved picture, and all six remaining provider fetches using a Cloudflare-unsupported redirect mode. R2 conditional writes now freeze accepted output; late responses preserve the exact already-published attempt. Providers use manual redirects and reject non-success responses. A responsive geometry assertion now waits for the entrance animation to settle.

Final verification PASS: `pnpm check` (106 tests across 12 files, including 28 FR-12 and 7 provider compatibility cases); `pnpm test:native` (8 native cases, 1 restart case, 35 browser cases on built assets and 35 on Vite); Cloudflare deployment dry-run; clean isolated local D1 migration of all 5 files; production-mode local workerd/D1/DO/R2 smoke with deliberately replayed scanner output, consent/privacy/replacement/leave checks; source/build secret hygiene and formatting/whitespace checks. All review test services were stopped after verification. Real providers and remote configuration remain unverified. Preserve the production MESSAGE_KEY, apply migration 0005 before traffic, configure the real scanner for uploads and verify queues/origin/bindings before an authorized deployment. Private checkpoint `.context/handoffs/fr12-final-review-root.md`.

## Latest responsive follow-up

User subsequently requested mobile/web responsiveness and explicit tests of picture sharing. Added adaptive image/copy layout, 44px consent/upload controls, uncropped image previews, long text/file-input wrapping, a compact phone quick-chat header and short-landscape spacing. The disclosure now follows chat history so automatic scrolling does not bury the milestone above messages. Preserved earlier feature/backend work and concurrently present general responsive styles.

PASS: 21 focused Playwright tests: 12 new responsive cases across 320×568, 360×740, 390×844, 667×375, 768×1024 and 1440×1000, plus 8 prior disclosure and 1 Next scenario. Tests cover mobile navigation, consent/decline/share-later, private upload/errors, full portrait/wide image shape, touch sizes, overflow and composer reachability. PASS: `pnpm check` (93 tests plus types), `pnpm run build:cloudflare`, whitespace and 381 local documentation links/anchors. Test Vite stopped after verification. Responsive screenshots at `.context/fr12-responsive-390x844.png` and `.context/fr12-responsive-1440x1000.png`. Private checkpoint `.context/handoffs/fr12-responsive-root.md`; no deployment performed.

## Local environment setup follow-up

The user requested reusable local `MESSAGE_KEY` setup. Created private, gitignored root `.env` at the main Conductor repository and copied it into `gwangju`, preserving the key in both locations with mode 0600. No prior local environment/data existed at either location. Conductor defaults copy `.env*` into new local workspaces; no include-rule override was present. Existing other workspaces and production secrets were not changed. README documents the workflow. Validation passed, and actual `pnpm dev:celld -- --no-watch` startup returned healthy at port 55061; the test process was stopped. Current workspace now has persistent `.celld/dev` data and generated `.dev.vars`: retain its `.env` key. Private checkpoint `.context/handoffs/local-root-environment-root.md`.

## Behavior and boundaries

- Five qualifying messages **each** unlock permitted ASL. Ten **each** show picture-sharing availability to both. No additional room-age/aggregate gate; old persisted flags are normalized to the new rule.
- Each owner independently approves the specific picture shown in their prompt. Decline persists with a share-later action; refresh/reconnect cannot imply approval. Missing pictures have no actionable consent prompt. Next starts fresh.
- AppCoordinator owns private picture lifecycle in D1/R2; Room owns per-conversation consent. New profile UI uploads JPEG/PNG/WebP up to 5 MB through scanner validation. New Hono routes authenticate content and bound scanner capabilities; room image reads recheck access around R2 reads.
- Replacement invalidates earlier consent and changes approved image URLs. Expired/unavailable owners, blocks, leaving, room expiry and access loss prevent image retrieval. Bounded cleanup queues durable object deletion before deleting owner records.
- Stable send IDs, existing distinct-content/qualifying intervals, ASL preferences, REST/WebSocket ownership, encryption, private R2 and migration history are preserved. Existing IMP-01–IMP-11/GAP-01 were not repaired as part of this feature.

## Verification

- PASS: `pnpm check` — TypeScript and **93 tests across 11 files**, including **22 FR-12** domain/HTTP cases. Covers imbalanced contributions, no legacy time gate/early flag, qualification and retries, consent/decline/later share, restart, new matches, missing/replaced pictures, auth/CSRF/expiry, R2 races, scanner capabilities/sanitized-output rejection/redirects and bounded cleanup.
- PASS: `BROWSER_BASE_URL=http://127.0.0.1:55060 pnpm exec playwright test tests/browser/disclosure.spec.ts tests/browser/random-chat.spec.ts` — **9 tests** (8 new disclosure/profile scenarios plus existing Next). Desktop/mobile screenshots inspected at `.context/fr12-desktop.png` and `.context/fr12-mobile.png`; no horizontal overflow at 390px.
- PASS: `pnpm run deploy:cloudflare:dry-run` — includes Cloudflare production frontend build/typecheck and Worker bundling; nothing published. Existing third-party build annotation/chunk-size warnings remain.
- PASS: all five D1 migrations applied to isolated **local** Wrangler storage, including `0005_profile_pictures.sql`. Production-mode local workerd then exercised real D1/DO/R2 bindings with a scanner fixture: five-each ASL/privacy without two-minute wait, ten-each independent consent/decline/later approval, private content retrieval, replacement and stale leave rejection. Runner/config under ignored `.context/fr12-cloudflare/`.
- PASS: `git diff --check`. Final documentation paths/anchors checked separately at completion.
- Reviews corrected stale room-action binding, changed-picture retry state, image URL identity, expired owner access, bounded cleanup, legacy early ASL flags and unsupported workerd fetch redirect mode. New scanner uses manual redirects and rejects non-success responses.

## Limits and next action

No remote migration, deployment, production scanner validation, push or PR action performed. Full native and browser suites subsequently passed during the final readiness review. Local scanner is a contract-validating substitute, not a safety-provider certification. Legacy ASL settings remain accepted for compatibility but no longer control quick-chat milestones.

Before an authorized rollout, apply `0005_profile_pictures.sql` to the intended D1, ensure the existing scanner bindings are configured for uploads, deploy to the intended Cloudflare target and verify production behavior. Current task ends with local implementation and verification; further publication/deployment requires the user's requested workflow. Do not repeat local tests or historical publication actions merely because this handoff lists them.

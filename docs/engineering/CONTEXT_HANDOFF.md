# Charoo shared engineering handoff

Sanitized summary for the latest implementation and publication milestone. Root [SRS.md](../../SRS.md) remains canonical. Recheck repository state and external services before continuing.

| Field | Current state |
|---|---|
| Updated | 2026-11-12 — FR-12 implementation, verification and PR creation |
| Repository / workspace | Charoo / `gwangju` |
| Branch / target | `dJangg0/asl-profile-chat-logic` / `origin/main` |
| Starting commit | `4f0f6c1fc54b0da446118a56a3186f6a82206346` |
| Current commits | `cb8266f` FR-12 feature; `77c21bb` Workers-compatible provider redirects |
| Objective / state | Implemented, locally verified, committed and pushed; [PR #13](https://github.com/trycharoo/charoo.live/pull/13) is open. No remote migration or deployment was performed. |

## Delivered behavior

- Five qualifying messages from each quick-chat participant unlock permitted ASL; ten each enable independent profile-picture consent. Declines persist with a share-later action, and consent is tied to a specific picture and room.
- AppCoordinator owns private profile-picture storage and scanning; Room enforces room-scoped consent and image access. Migration `0005_profile_pictures.sql` is additive. Uploads require the configured scanner.
- Profile-picture upload and disclosure UI support narrow and desktop layouts. Provider calls now use Workers-supported manual redirects and reject redirects without forwarding credentials.
- Existing IMP-01–IMP-11 and GAP-01 remain open; this PR does not resolve them.

## Verification

- PASS: `pnpm check` — TypeScript and 106 tests across 12 files (28 FR-12 cases and 7 provider compatibility cases).
- PASS: `pnpm test:native` — 8 native scenarios, 1 restart scenario, and 35 browser scenarios against built assets plus 35 against Vite.
- PASS: `pnpm run deploy:cloudflare:dry-run` — Worker bundle and configuration check only; existing dependency annotation and bundle-size warnings remain.
- PASS: `git diff --check origin/main...HEAD`; working tree was clean after pushing the feature commits.
- Local scanner and isolated workerd/D1/DO/R2 fixtures were used. Real provider accounts, remote migrations and production deployment remain unverified.

## Next action and rollout limits

Review PR #13. Before any authorized rollout, apply migration 0005 to the intended D1, preserve the production `MESSAGE_KEY`, configure and validate the real scanner, and confirm queues, origin and bindings. Do not deploy or migrate based on local checks alone.

# Charoo architecture decision log

Initialized **2026-11-12**, adapting the Guardian ADR template. Existing application decisions remain in [SRS.md](../../SRS.md#architecture-decisions) and [ARCHITECTURE.md](../../ARCHITECTURE.md). This index preserves their IDs without inventing historical rationale or reopening them during setup.

| Existing ID | Established decision | Evidence / reconsideration |
|---|---|---|
| AD-01 | Hono REST/JSON public commands/queries; native Durable Object RPC internally | [SRS decisions](../../SRS.md#architecture-decisions), [Hono app](../../celld/http/app.ts), [contracts](../../packages/contracts/src/index.ts). Replacements need an actual requirement. |
| AD-02 | Authenticated sockets for notifications/room/discovery; REST message writes | [Realtime design](../../ARCHITECTURE.md#frontend-and-transport), [client](../../src/realtime.ts), [Room](../../celld/durable-objects/room.ts). Revisit for demonstrated transport/recovery needs; IMP-08 remains open. |
| AD-03 | Documented heartbeats, disconnected fallback and lifecycle timers | [SRS decisions](../../SRS.md#architecture-decisions), [App](../../src/App.tsx), [realtime client](../../src/realtime.ts). Changed timers need purpose, lifecycle and outage evidence. |
| AD-04 | Separate Cloudflare production and Celld local/optional fleet configurations | [Cloudflare](../../wrangler.cloudflare.jsonc), [Celld](../../wrangler.jsonc), [README](../../README.md#cloudflare-deployment). IMP-09–IMP-11 remain open; verify the intended runtime. |
| AD-05 | Reuse authorities/contracts and keep changes proportionate | [SRS decisions](../../SRS.md#architecture-decisions). Record consequential authorized changes with alternatives, migration/rollback and security/recovery evidence. |

These link to the existing baseline rather than granting new approval. For future application decisions, retain affected FR/BE/AD IDs and use the [bundled ADR template](../../.agents/skills/engineering-srs-guardian/assets/templates/ARCHITECTURE_DECISIONS.md). Record the problem, constraints, options, rationale, tradeoffs, contracts/state, operational risks, validation and revisit criteria; distinguish proposed from accepted choices.

## ENG-01: Integrate Guardian around the existing contract

- **Date/status:** 2026-11-12 / ACCEPTED for repository setup under the user's explicit integration request. No product architecture change.
- **Problem:** Add a reusable skill, traceability and continuity while preserving the root SRS, architecture, stable IDs, security rules and per-agent handoffs.
- **Drivers:** One authoritative contract, Codex compatibility in Conductor, minimal maintenance, complete functional resources, evidence-based assessment and safe parallel work.

| Candidate | Benefits | Tradeoffs / fit |
|---|---|---|
| Relocate root requirements/architecture into the template layout | One new layout | Breaks existing links and startup rules; requires unrelated migration work. |
| Copy a second full specification | Familiar template filenames | Independently maintained contracts can drift and obscure requirement ownership. |
| Keep root contracts; add linked indexes, matrix and shared summary | Preserves existing instructions/IDs and enables Guardian's workflow | Requires explicit canonical-path guidance; selected. |

- **Choice:** One functional package at `.agents/skills/engineering-srs-guardian/`; concise merged root instructions; template-derived engineering docs that reference the canonical specification. Preserve all functional references, examples and templates.
- **Package adaptations:** Retain display metadata/implicit invocation; omit the optional supplied product filter. Exclude macOS metadata and an unreferenced scaffold reference. Adapt the package README and add generic canonical-document/checkpoint guidance to the skill.
- **Affected contracts:** Agent workflow/continuity only. Existing SRS IDs, application source/tests, migrations, dependencies, runtime configuration and production resources remain unchanged.
- **Recovery:** Explicitly open `SKILL.md` in harnesses without local discovery. Each agent retains its private checkpoint; the coordinating agent maintains the sanitized shared summary. Recheck repository and external state on resume.
- **Risks:** A running session or another harness may not expose the skill automatically. New workspaces need tracked files on their starting branch; ignored checkpoints require explicit transfer. Never store credentials or private user data in handoffs.
- **Validation:** Check metadata/discovery, local references, original instruction preservation, matrix coverage/gaps and documentation-only diff. Results belong in [CONTEXT_HANDOFF.md](CONTEXT_HANDOFF.md).
- **Rollback:** Revert this setup's documentation/skill changes through the normal branch workflow. No runtime or data migration is involved.
- **Revisit:** When canonical documents deliberately move, harness conventions change, or shared handoff ownership needs revision. Preserve existing requirement IDs and invariants.

## PD-01: Quick-chat disclosure requires balanced participation and owner consent

- **Date/status:** 2026-11-12 / ACCEPTED product requirement from the specification request; subsequently implemented under the explicit implementation request. See ADR-01 below.
- **Problem:** A combined message total can imply mutual participation when one person sent most messages; a count milestone alone does not authorize revealing a profile picture.
- **Decision:** [FR-12](../../SRS.md#quick-chat-disclosure-milestones-fr-12) requires five qualifying messages from **each** participant for permitted ASL, then ten from **each** for a notification to both and optional picture-sharing prompts. These are count-based milestones without the legacy room-age wait. Each owner independently approves their own picture; decline/dismissal leaves it hidden with a share-later chat notice and action. No existing picture means no actionable picture-sharing prompt.
- **Alternatives ruled out by the request:** A pooled total does not establish each person's contribution. Automatic or forced reciprocal picture disclosure does not preserve independent owner consent.
- **Boundaries/tradeoffs:** Preserve ASL visibility and existing meaningful-message qualification; restrict progress/consent and image access to the current authorized chat. Reaching a milestone does not override privacy, blocks or expiry. This adds consent/notification state to future implementation work but selects no new API, schema, storage service or transport.
- **Evidence/validation at the original requirements review:** Code then used different configurable ASL gates and lacked picture sharing. The [matrix](IMPLEMENTATION_MATRIX.md#fr-12-implementation) now records the subsequent authorized implementation; SRS acceptance cases cover imbalanced counts, both milestones, independent consent, later approval, absent pictures, retries/reconnect and stale access. No application checks were claimed passing at the requirements-only stage.
- **Revisit:** If the user changes what qualifies as a message, ASL privacy behavior, picture scope or disclosure milestones. Any later product decision about withdrawing an already approved picture must be specified before implementing that additional control; this request does not define an unshare feature.

## ADR-01: Private account pictures with room-scoped disclosure consent

- **Date/status:** 2026-11-12 / ACCEPTED for the user's FR-12 implementation request; verification tracked in the implementation matrix.
- **Problem:** Implement five-each ASL and ten-each voluntary picture sharing. The original profile has no picture storage; pictures must remain unavailable to a partner before their owner's approval, including through direct HTTP requests.
- **Choice:** Keep meaningful-message counters and independent disclosure choices in the authoritative Room. Use fixed five/ten per-participant milestones without the legacy age/aggregate gates. Keep profile pictures in a separate private D1/R2 lifecycle governed by AppCoordinator, using the existing scanner's quarantine, sanitized-output and scoped capability conventions. Add an append-only D1 migration; retain existing Durable Object bindings and stored participant JSON with compatible optional fields.

| Alternative | Assessment |
| --- | --- |
| Reuse a room attachment as a permanent profile picture | Rejected: profile lifetime would depend on a temporary room, and existing attachment download permissions do not express owner picture consent. |
| Store a public/external picture URL and hide it in the frontend | Rejected: delivering a retrievable URL before approval breaks FR-12 and private-media boundaries. |
| Separate private account media, authorized through room consent when shared | Selected: preserves account and room authorities, private R2 and scanner safety without another storage service or transport. |

- **Boundaries:** Hono validates authenticated REST commands; Room snapshots expose progress and an owner's own decision/picture identity. Partner image URLs are returned only after that owner's approval. Room picture reads recheck membership, block and expiry restrictions; knowing the URL is insufficient. Consent references a specific picture, so replacement cannot disclose a new picture under an old approval. Missing pictures have no actionable prompt. Declining is persisted and permits later approval in the same chat. New matches never inherit consent.
- **Realtime/recovery:** Existing authenticated room invalidations trigger authoritative reads. Durable participant choices survive reconnect/restart; state-derived notices avoid appending duplicate milestone messages on retry. Stable message IDs, distinct-content fingerprints and qualifying intervals remain authoritative. Reactions, system notices and rejected sends never count.
- **Migration/rollout:** Apply `0005_profile_pictures.sql` before production traffic. Legacy ASL settings remain accepted for client/settings compatibility but no longer control quick-chat milestones. Picture uploads require the existing scanner bindings; unavailable configuration is reported explicitly. Local tests do not establish production scanner availability.
- **Recovery/rollback:** Preserve durable media cleanup work and revoke inaccessible images independently of asynchronous object deletion. Application rollback must retain the additive D1 migration and private objects; do not remove applied migration history or restore public access. No deployment or remote migration is part of this implementation task.
- **Acceptance evidence:** FR-12 boundary, consent, retry/restart, stale-access and private-media tests are recorded in [IMPLEMENTATION_MATRIX.md](IMPLEMENTATION_MATRIX.md). Browser checks cover consent/decline/error and responsive states. Cloudflare validation must be reported separately from SQLite/Celld checks.

The new profile scanner uses `redirect: "manual"` and rejects non-success responses, including redirects, before approval. Local workerd testing exposed that `redirect: "error"` fails before dispatch; this is documented by [Cloudflare Request runtime behavior](https://developers.cloudflare.com/workers/runtime-apis/request/). The initial feature change left other adapters unchanged; the subsequent Cloudflare readiness review corrected the same unsupported mode in all six remaining provider calls.

Final readiness review also applies current owner eligibility to ASL and freezes scanner output with an atomic R2 create-only condition. Late scanner responses preserve an output already published by the same approved attempt; abandoned output still undergoes cleanup. Regression/runtime evidence and remaining production findings are in [FR12_CLOUDFLARE_REVIEW.md](FR12_CLOUDFLARE_REVIEW.md).

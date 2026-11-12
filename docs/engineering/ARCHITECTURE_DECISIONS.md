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

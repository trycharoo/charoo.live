# Agent instructions for Charoo

## Start here

Read [SRS.md](SRS.md) before planning implementation. It defines the product requirements, current architecture, and acceptance criteria. Read the relevant parts of [ARCHITECTURE.md](ARCHITECTURE.md), [README.md](README.md), contracts, source, and tests for the task; avoid loading unrelated files or whole logs.

Follow the active system/developer instructions and the user's current task. These repository notes establish the default implementation contract; they do not override those instructions or expand authorization. If source and documentation disagree, identify the discrepancy and verify the behavior before relying on either.

## SRS-driven engineering

Use [Engineering SRS Guardian](.agents/skills/engineering-srs-guardian/SKILL.md) for application architecture, feature implementation, significant bug fixes, technical decisions, and engineering reviews. Read the skill when it applies; if the harness does not discover local skills, open that file explicitly. Routine edits need only proportionate checks.

- Start with the relevant requirements in `SRS.md` and decisions in `SRS.md` / `ARCHITECTURE.md`. [PROJECT_SRS.md](docs/engineering/PROJECT_SRS.md) indexes the existing contract; [ARCHITECTURE_DECISIONS.md](docs/engineering/ARCHITECTURE_DECISIONS.md) links existing decisions and records new consequential choices. Preserve the existing FR/BE/AD IDs and canonical document locations.
- Inspect actual source, contracts and tests before proposing substantive modifications. Understand the actors, business logic, system boundaries, authoritative data owners and failure paths before implementation.
- Evaluate credible architectural alternatives against the actual requirement and established decisions. Technology suggestions and the skill's worked examples are candidates, not requirements.
- Verify consistency across affected frontend, backend, API/event contracts, database/migrations and infrastructure. Preserve business invariants, authorization, retries and lifecycle rules across those boundaries.
- Maintain [IMPLEMENTATION_MATRIX.md](docs/engineering/IMPLEMENTATION_MATRIX.md) with affected requirement IDs, source/test evidence, verification level and known gaps. Never infer completion from code presence or a passing unrelated test.
- Update the canonical SRS when approved requirements change, the decision log when consequential architecture changes, and the matrix when implementation evidence changes. Distinguish confirmed requirements, observed behavior, recommendations and unknowns; keep defects visible rather than redefining the contract around them.

## Preserve the implementation contract

- Production uses Cloudflare Workers and Durable Objects through `wrangler.cloudflare.jsonc`. Local Celld and optional fleet tooling use `wrangler.jsonc`; choose the command for the intended target.
- Keep Hono REST commands/queries and authenticated WebSocket updates. SSE and GraphQL are alternatives to evaluate for an actual requirement, not automatic replacements. See the SRS transport requirements and decisions.
- Preserve authoritative ownership, permission checks, encryption, stable operation IDs, durable outboxes, and migration history. D1 query indexes do not grant room access.
- Keep credentials in backend bindings. Never copy secret values, session cookies, CSRF tokens, or private user content into documentation, checkpoints, logs, or frontend assets.
- Keep changes within the requested feature and preserve unrelated work already present. Update the SRS and relevant decision record when an authorized change alters the contract; do not rewrite the contract merely to excuse accidental drift.

## Long sessions and context handoff

**Before context becomes full, before a context refresh/compaction, or before handing work to another session, save a concise implementation gist in `.context/handoffs/<task-slug>-<agent-slug>.md`, using [docs/HANDOFF_TEMPLATE.md](docs/HANDOFF_TEMPLATE.md). Preserve the objective, latest user steering, decisions, completed changes, verification, external actions already performed, unresolved work, and exact next step. After compaction, restart, or handoff, read this file and the relevant SRS requirements, verify them against the current workspace, and continue the same task.**

Create a checkpoint early during substantial work and update it after meaningful milestones and before context-heavy investigations. Do not wait for an exact remaining-context percentage: the harness may not expose one or may compact without warning. Each agent owns a distinct task/agent file and must not overwrite another agent's checkpoint. Keep the gist brief and replace stale details instead of appending a transcript.

Also refresh [CONTEXT_HANDOFF.md](docs/engineering/CONTEXT_HANDOFF.md) at meaningful engineering milestones and session handoffs with a concise, sanitized shared summary, verification limits and next action. Keep task-specific working details in the required `.context/handoffs/` files; the shared summary does not replace them. The coordinating agent owns shared updates during parallel work. On resume, check this summary and the matching task checkpoint against actual repository state.

Only invoke compaction/refresh when the harness exposes a supported control. A Markdown instruction cannot force the harness to reset context; if no control exists, save the checkpoint and continue using the harness's normal continuation. Never claim a refresh occurred when it did not.

On resume, inspect `pwd`, branch/HEAD, `git status`, relevant diffs, and needed services. Select the checkpoint matching the active task and branch, not simply the newest file. Recheck external state before retrying a migration, deployment, resource creation, or other mutation recorded as completed. Preserve earlier user authorization; ask only for information or authorization that is actually missing.

## Feature workspaces and completion

Use one feature/workspace when practical. Repository guidance follows Git history: new workspaces only inherit these files after they reach the workspace's starting branch or are explicitly copied. `.context/` is gitignored and does not transfer automatically. Promote lasting requirements and decisions into the tracked documents; transfer an unfinished task's sanitized checkpoint explicitly when needed.

Before finishing, check the affected SRS requirements, run verification appropriate to the change, and report what passed, failed, or was not run. Documentation-only changes need documentation checks, not a production deployment. Use the command matrix in the SRS; successful Celld tests do not by themselves prove Cloudflare runtime compatibility.

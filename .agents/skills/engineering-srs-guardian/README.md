# Engineering SRS Guardian

A reusable requirements, architecture, implementation review and context handoff workflow. The functional skill, metadata, references, worked example and five original templates live together in this directory.

## Use in this repository

Read [root AGENTS.md](../../../AGENTS.md) and [SRS.md](../../../SRS.md) first. The [engineering index](../../../docs/engineering/PROJECT_SRS.md) connects Charoo's existing contract, decisions, source/test matrix and shared handoff. Templates are starting points for missing documents, not approved Charoo requirements; the chat example's numbers, technologies and offline behavior are illustrative.

In Codex, type `$engineering-srs-guardian`, or ask:

- “Use $engineering-srs-guardian to implement this feature against SRS.md: …”
- “Use $engineering-srs-guardian to review this branch against SRS.md and update the implementation matrix.”
- “Refresh the shared CONTEXT_HANDOFF.md and my task checkpoint before handoff.”

Implicit invocation is enabled in [agents/openai.yaml](agents/openai.yaml). This is metadata within the skill, not root agent instructions. This skill needs no API keys, MCP server, runtime dependencies or background worker.

## Discovery and portability

This is a project installation at `.agents/skills/engineering-srs-guardian/`. [Official Codex documentation](https://learn.chatgpt.com/docs/build-skills) describes repository discovery from `.agents/skills` and explicit `$skill-name` invocation. Local Codex 0.166.0 app-server `skills/list` confirmed this skill enabled with repository scope and no matching errors during setup on 2026-11-12. This does not establish discovery in every Conductor agent or future session. If a running session does not show it, restart in this workspace; for other harnesses, explicitly request reading root `AGENTS.md` and this `SKILL.md`.

New workspaces receive tracked skills only after these files reach their starting branch or are explicitly copied. Gitignored task checkpoints do not transfer automatically.

For another compatible repository, copy this whole directory into its `.agents/skills/` directory, preserve existing instructions and canonical requirements, and initialize only missing documents from the [templates](assets/templates). Do not copy examples into product scope.

## Package integration notes

- Preserved the operating loop, engineering standards, response contract, continuity rules, three functional references and all five templates.
- Added a generic note to `SKILL.md` respecting existing canonical documentation, stable IDs and per-agent checkpoint rules.
- Preserved display metadata and implicit invocation; removed the supplied optional `policy.products` filter containing lowercase product names. No product restriction is necessary for this local repository installation.
- Adapted this README for repository installation instead of the supplied archive-import instructions.
- Excluded `.DS_Store` and unreferenced `references/api_reference.md` scaffold, which contains no API contract. No functional reference or template was removed. No archive, duplicate skill installation or example application was added.

The skill can save context to writable files but cannot reset a chat, detect an exact remaining context budget, or serve as a persistent background agent. Follow root instructions for private per-agent checkpoints and coordinated shared summaries.

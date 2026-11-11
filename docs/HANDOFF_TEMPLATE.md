# Task handoff template

Copy this template to `.context/handoffs/<task-slug>-<agent-slug>.md` using lowercase letters, numbers, and hyphens for the slugs. Each agent owns its checkpoint; preserve other agents' files. Keep this tracked template generic and put current task state in the gitignored checkpoint.

Update the checkpoint at meaningful milestones and before context-heavy work or a reported compaction. Do not depend on knowing the exact remaining context. A note cannot force context reset; use compaction controls only when the harness actually provides them. Writing a checkpoint does not complete or pause the task: continue authorized work unless the user or harness requires a handoff.

Record facts concisely and distinguish verified, proposed, and uncertain information. Never include credentials, cookies, tokens, secret values, or private user data. Use public URLs without secret query or fragment values. `.context/` does not automatically transfer to a new workspace; explicitly transfer the needed checkpoint or provide a sanitized handoff to the next agent.

---

# Current task

Updated (date/time and timezone):
Checkpoint owner / task slug:
Workspace absolute path:
Branch / HEAD / base reference:
Status (in progress, waiting on input, or complete with evidence):

## Objective and latest steering

- Intended outcome and completion criteria:
- Latest user correction or preference:
- Authorization already present in the task/session and actual limits; record the basis without expanding its scope:
- Scope and exclusions:

## Applicable implementation contract

- Relevant SRS requirement IDs and architecture sections:
- Accepted decisions and rationale, with decision-record links when available:
- Invariants this task must preserve:

## Implementation state

- Completed and verified changes, with file paths and purpose:
- Implemented but unverified work:
- Proposed or unfinished work:
- Pre-existing or other-agent changes to preserve:
- Important source locations and current behavior:

## Verification and evidence

- Exact command or check, result, and when it ran:
- Evidence paths or public links:
- Failed or skipped checks, practical limits, and unresolved failures:
- Checks that need repeating because relevant inputs changed:

## External state and running processes

- Mutations already performed: target, outcome, migration/resource/version identifiers:
- Public deployment URLs and verified version/status:
- Processes: owner, PID, port, working directory, start command, and observed state:
- Outstanding external actions, their authorization, and effects that must not repeat:

## Decisions, assumptions, and open issues

- Verified facts versus assumptions that still need checking:
- Decisions still needed, blockers, and the exact missing information:

## Next actions

1. Immediate next concrete step:
2. Remaining ordered work and its dependencies:
3. Final verification and completion criteria still outstanding:

## Resume procedure

Read `AGENTS.md`, the relevant SRS sections, and this checkpoint. Recheck `pwd`, branch and HEAD, `git status`, relevant source, and any required services or external state. Reconcile stale details before acting; do not blindly reuse PIDs or assume a deployment or migration needs replaying. Preserve unrelated edits, confirm an action's prior outcome before retrying a mutation, and continue the original objective with the latest user steering.

A completed checkpoint records history; it is not a request to restart that task. Select the checkpoint matching the current task and branch rather than the newest unrelated file.

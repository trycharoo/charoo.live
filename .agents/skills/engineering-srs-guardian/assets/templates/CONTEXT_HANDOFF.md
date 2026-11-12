# Engineering Context Handoff - [Project]

> Written at a milestone or before a long-session rollover. Factual, minimal and enough to resume safely. This is not proof of the live system's current state. Do not include secrets, tokens, personal data or full logs.

| Field | State |
|---|---|
| Created (UTC) | YYYY-MM-DD HH:MM |
| Immediate goal | [One sentence] |
| Target environment | [Local / staging / production] |
| Repository and branch | [URL / branch] |
| Examined commit SHA | [SHA] |
| Open PRs / linked issues | [IDs / URLs] |
| SRS version | [Version/date] |
| Last test run | [When, branch and outcome] |

## 1. Current product intent and immutable rules
- [Product goal and the 3-7 most important FR / INV IDs]
- [Choices the user explicitly approved; do not confuse an assistant recommendation with approval]

## 2. Verified implementation facts
- [What code was actually read or changed, exact relevant paths/symbols, commit/PR links]
- [What was tested, commands/environment and observed result]
- [What is merged versus merely proposed; what is deployed versus merely merged]

## 3. Incomplete or uncertain work
| Severity | Item / impacted requirement | Evidence or reason unknown | Next verification |
|---|---|---|---|
| [Priority] | [FR / INV] | [Missing info] | [Command or inspection] |

## 4. Architecture and dependencies
- **Key ADRs:** [ID, decision, why]
- **Service interactions:** [Critical API / event / DB dependencies]
- **Environment notes:** [Non-secret differences that matter]
- **Do not break:** [Compatibility rules, migration order, server-side business invariants]

## 5. Next action (single highest-leverage step)
1. [Inspect these concrete files/PRs and confirm current branch/HEAD]
2. [Make one targeted change / run a specified verification]
3. [Update SRS/matrix/ADR/handoff if results differ]

## 6. Resume prompt (copy into a fresh chat)

Read `docs/engineering/PROJECT_SRS.md`, `ARCHITECTURE_DECISIONS.md`, `IMPLEMENTATION_MATRIX.md`, and `CONTEXT_HANDOFF.md` first. Act as a staff engineer. Reopen the actual repository and confirm current branch/commit/PR state before claiming anything is complete. Reconcile differences between the SRS and actual backend, database, frontend and tests. Protect business invariants; challenge architecture choices and provide evidence for every finding. Continue from the "Next action" above without repeating already settled decisions. Do not push directly to protected branches or assert tests passed unless run.

## 7. How to refresh this handoff
Update after each major milestone, meaningful requirement change, large code review or interrupted session. When the current conversation is becoming lengthy, create the file proactively; don't wait for an exact token threshold. A new chat must be started by the user or the surrounding tool/workflow; the skill cannot reset conversations automatically.

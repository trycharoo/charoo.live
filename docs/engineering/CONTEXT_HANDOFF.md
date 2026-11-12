# Charoo shared engineering handoff

Sanitized milestone summary; verify actual repository and external state before acting. Per-agent checkpoints remain required under `.context/handoffs/` using [the existing template](../HANDOFF_TEMPLATE.md); the coordinating agent owns this shared summary.

| Field | Latest requirements milestone |
| --- | --- |
| Updated | 2026-11-12 08:02 UTC; pre-publication snapshot |
| Repository / workspace | Charoo / `oslo` |
| Branch / target | `dJangg0/engineering-srs-guardian` / `origin/main` |
| Examined HEAD | `a7898a6b0c0050f88061e10b2f06f0d0fb3414ed` |
| Objective | Document quick-chat ASL/picture milestones and owner consent in the SRS; no feature implementation |
| State | Requirements update complete and validated; subsequent user request authorizes committing and pushing these edits to the current branch |
| Earlier publication | Guardian setup committed/pushed as `a7898a6` and [PR #12](https://github.com/trycharoo/charoo.live/pull/12) created against main; no merge claimed, remote PR status not rechecked for this SRS follow-up |

## Product intent and approved decisions

Root [SRS.md](../../SRS.md) remains canonical; [PROJECT_SRS.md](PROJECT_SRS.md) supplies navigation and [the matrix](IMPLEMENTATION_MATRIX.md) records implementation evidence. Existing FR/BE/AD IDs and IMP-01–IMP-11 / GAP-01 remain intact.

The latest user request approves **FR-12 as requirements only**: five qualifying messages from each participant unlock permitted ASL; ten from each notify both that picture sharing is available and prompt owners with pictures. Each owner independently chooses whether to reveal their own picture. Decline/dismissal keeps it hidden with a share-later chat notice/action. A combined total never substitutes for either person's contribution. Here “profile” is interpreted as profile picture, as framed by the request.

[PD-01](ARCHITECTURE_DECISIONS.md#pd-01-quick-chat-disclosure-requires-balanced-participation-and-owner-consent) records this product decision, not a selected implementation design. Preserve meaningful-message qualification and ASL visibility. Target milestones have no additional legacy room-age wait. Consent is scoped to the current chat, never implied by silence or reciprocal sharing, and cannot bypass blocks, expiry or authorization.

Preserve existing authoritative ownership, REST/WebSocket boundaries, durable IDs/outboxes, encryption, private media and migration history. No feature, API, schema, runtime configuration, migration or deployment is authorized by this documentation request.

## Changes and source evidence

- Added FR-12, detailed milestone/consent rules and acceptance cases to `SRS.md`; linked it from FR-07.
- Updated the requirements index, matrix and decision log to distinguish the approved target from current implementation; refreshed this handoff.
- Source inspection: Room already counts qualifying distinct messages and enforces ASL visibility. Defaults currently require 10 each, 20 total and 120 seconds. Existing balanced-ASL test uses lowered settings; it does not prove the new milestones. Profile schema/UI lacks profile pictures and reveal consent/notifications.
- No application code, test, API, migration, dependency or configuration changed. The target is not implemented or deployed. Existing defects were neither fixed nor reproduced again.

## Verification and limits

- PASS: all 358 local links/anchors across the five changed documents resolve; original 23 FR/BE/AD IDs plus FR-12 match 24 unique matrix rows; all existing findings retained; milestone/consent acceptance cases present; documentation-only scope, whitespace and `git diff --check` pass. Independent review found no actionable issues.
- Current application behavior: relevant source/test definitions inspected only; no application tests or services run for this requirements-only edit.
- Earlier Guardian setup evidence remains historical: actual Codex discovery/validator, original package/instruction preservation, 23 baseline IDs / 12 findings, 320 baseline links and whitespace checks passed. FR-12 adds one target ID; old counts are setup evidence, not a claim about this updated document set.
- SLOs, live providers, Cloudflare parity and complete accessibility acceptance remain unverified. Picture storage/schema, consent operations/notifications and any future unshare control require separate implementation decisions.

## External state and next action

No external mutations were performed during the SRS editing step. The subsequent user request explicitly authorizes committing and pushing all pending changes; the existing PR #12 was confirmed open on this branch before publication. Recheck actual commit/upstream state before retrying publication; do not create a duplicate PR. No deployment or migration is authorized.

The requirements update is complete; finish the subsequently requested commit/push and verify a clean working tree and synchronized upstream. No feature implementation is part of this request. A later authorized implementation must satisfy FR-12 acceptance cases, update relevant source/contracts/tests and reconcile defaults with the new target.

On resume, read `AGENTS.md`, relevant SRS sections, this summary and the matching private checkpoint. Recheck `pwd`, branch/HEAD, `git status`, relevant diff/source and any needed services/remote state. Completed setup history is not a new task, and a handoff cannot reset a conversation or prove current deployment behavior.

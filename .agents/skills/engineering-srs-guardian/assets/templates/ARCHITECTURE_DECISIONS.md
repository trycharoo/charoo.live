# Architecture Decision Log - [Project]

A decision record explains *why* an implementation exists, what it trades off, and when to reconsider it. Use one ADR per consequential design choice. Do not treat a fashionable stack as a requirement.

## Decision index
| ADR | Date | Status | Decision | Affected requirements | Review trigger |
|---|---|---|---|---|---|
| ADR-001 | YYYY-MM-DD | PROPOSED | [Short choice] | FR-001, NFR-001 | [Condition] |

Allowed status: `PROPOSED`, `ACCEPTED`, `SUPERSEDED`, `REJECTED`. Link superseding ADR rather than erasing history.

---

## ADR-001: [Decision title]
- **Context / problem:** [The behavior and operational constraints, not the solution]
- **Decision drivers:** [Latency, cost, reliability, bidirectionality, load, team skills, privacy]
- **Options compared:**

| Option | Benefits | Risks / operational costs | Fit with constraints |
|---|---|---|---|
| A: [Pattern] | [Pros] | [Cons] | [Assessment] |
| B: [Pattern] | [Pros] | [Cons] | [Assessment] |
| C: [Optional] | [Pros] | [Cons] | [Assessment] |

- **Selected choice:** [Pattern, assumptions and why]
- **Rejected alternatives:** [Reasoned explanation; avoid strawmen]
- **Data contracts / invariants affected:** [FR/NFR/INV IDs]
- **Failure/recovery behavior:** [What if connection, DB, client or worker fails?]
- **Validation plan:** [Test, load numbers, metrics, rollout proof]
- **Consequences / debt:** [What gets more complicated?]
- **Revisit when:** [Measurable condition; e.g., >N concurrent sessions, no longer meeting p95]
- **Evidence links:** [Code, PR, tests, dashboards]

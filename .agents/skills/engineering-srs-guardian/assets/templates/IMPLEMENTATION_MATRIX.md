# SRS-to-Implementation Traceability - [Project]

> Verify against the actual branch, code, tests and runtime. Avoid declaring features complete based solely on PR descriptions or UI demos.

**Reviewed date:** [UTC date]

**Repository / branch / commit:** [URL, branch, full or short SHA]

**Environments checked:** [local, staging, production; say NOT CHECKED where applicable]

## Status definitions
- **PASS**: Acceptance criteria were checked with cited code and tests, or actual runtime evidence; state the verification level.
- **PARTIAL**: Some paths work but a meaningful case or layer is missing.
- **FAIL**: Observed violation of an SRS requirement or invariant.
- **UNKNOWN**: Evidence missing, checks not run, or repository inaccessible.
- **N/A**: Requirement explicitly not applicable to the present milestone.

## Requirement matrix
| Requirement | Backend/domain | Data/infra | Frontend/UX | Test evidence | Status | Next action / evidence |
|---|---|---|---|---|---|---|
| FR-001 | [file:symbol / PR] | [migration / index] | [screen/state] | [test + result] | UNKNOWN | [Verify path] |
| INV-001 | [server enforcement] | [transaction / constraint] | [presentation] | [race/negative test] | UNKNOWN | [Verify paths] |
| NFR-001 | [metric/instrumentation] | [load limits] | [perceived performance] | [measurement] | UNKNOWN | [Measure] |

## Audit findings
| Rank | Severity | Finding and user impact | Evidence | Minimal fix | Regression test | Owner / status |
|---|---|---|---|---|---|---|
| 1 | BLOCKER / HIGH / MEDIUM / LOW | [Exact divergence] | [Path:line, commit, log/test result] | [Smallest safe change] | [Scenario] | [Status] |

## Gate checklist
- [ ] Each MVP invariant has backend enforcement and a negative/concurrent test.
- [ ] Critical user journey works end-to-end from actual UI to persisted data and back.
- [ ] Authz checks apply to direct API/realtime operations, not only UI routes.
- [ ] Duplicates, retries, disconnects and stale state have defined behavior.
- [ ] Failure UX is visible, actionable and does not silently lose data.
- [ ] Schema changes have migration, existing-data and rollback compatibility plans.
- [ ] Observability identifies failures without leaking sensitive data.
- [ ] Test run result, timestamp, version and environment are recorded.
- [ ] Release and recovery steps are documented; blockers resolved or explicitly waived by owner.

## Evidence log
| When (UTC) | Branch/commit/environment | Command or procedure | Result | Artifact/link |
|---|---|---|---|---|
| [Time] | [Target] | [Test / review / manual E2E] | PASS / FAIL / NOT RUN | [URL/path] |

## Reconciliation notes
Changes since the last review, newly discovered unimplemented requirements, deviating branches, and decisions needed. Update `PROJECT_SRS.md` only when intended product behavior changes; update this matrix when the *implementation evidence* changes.

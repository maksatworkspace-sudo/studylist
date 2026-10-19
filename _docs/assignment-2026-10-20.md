# AI-Native Assignment And Remediation Decision

Date: 2026-10-20. Status: USER-AUTHORIZED REMEDIATION, not implementation proof.
Read [process](process.md), [issue links](tasks.md), [original brainstorm](../chat-brainstorm.md),
[plan](plan.md), [earlier decisions](decisions-2026-10-19.md),
[historical architecture](architecture.md) and [baseline verification](verification.md).

## User Assignment Record

The following is the user's supplied English checklist (line wrapping only).
It is a later assignment, not inserted into the earlier original brainstorm.

```text
- Fully follow:
https://aishippingblog.com/p/ai-native-development-specifications
https://aishippingblog.com/p/build-and-ship-a-full-stack-app-with

I know they start from different places, but think about how can you combine.

- Utilize Github Issues as in ai-native-development-specifications.
- Use Non generic design agents like Lovable / v0 / Claude Design. OR at least provide good references for the coding agent.
- Close all mvp tags. It can be up to 100 issues. (more is ok)
- Use persistent storage as sqlLite.
- Use dbms agnostic tools like ORM.
- Work in iterations. First front end with mockService -> openapi.yml (describe contract) -> backend in memory story - > backend sqllite storage -> connect frontend + backend.
- Add all your .md files to the github repo. Improve them while you develop.
- Add your chat history where you brainstormed before creating an app as text file. (.md)
- Actually run your app and throughly test it.
- If found a bug, create an issue Github describe with Goal and Description and ask pm.md to groom and qa.md to add more test cases. Use tag user-test-bug. So that we know you actually tested. (Overall you will have mvp, post-mvp, user-test-bug tags).
- Work and test until it's fully working and well tested.
- Submit everything to github repo and close (qa-engineer.md should close it) all issues with mvp and user-test-bug tags before the deadline.
```

The user first requested an audit, then explicitly authorized completing the
compliance gaps. Publication remains paused. Subsequent technical instruction
selects TypeORM EntitySchema + better-sqlite3; forbids a SQL rewrite shim;
requires a real replaceable memory repository and distinct honest stage commits;
and preserves existing PostgreSQL state. No deadline date was supplied.

This section records available messages/decisions only. It is not a fabricated
full transcript of all later development turns. Original brainstorming remains
unchanged in chat-brainstorm.md; later product clarifications remain attributed
in decisions-2026-10-19.md. No real owner phone/name or credentials are recorded.

## Historical Baseline

Commit 6c703879a144ef2a12b2a813378a3ba45db98b46 contains the existing working
Next.js/TypeScript MAXBALL feedback app, raw PostgreSQL/PGlite persistence, local
email/AI fixtures and documented tests/screenshots. It predates the new process.
Its 25 tests plus 3 separately executed HTTP scenarios do not prove new SQLite
acceptance. The original initial docs and brainstorm were already committed.

At audit there were no GitHub issues, role/process docs, OpenAPI or mock-first
history. Do not pretend a new repository/empty app is being started or rewrite
that commit into invented historical checkpoints. New work is remediation.

## Binding Architecture Decision For New Work

- Retain Next.js, React, TypeScript, current compact Kazakh UI and original assets.
- Frontend uses a typed replaceable service: deterministic mockService first,
  then a contracted HTTP implementation. No direct component backend bypass.
- Put root openapi.yml after the mock checkpoint and validate actual operations.
- Business services depend on typed domain repositories and atomic unit-of-work
  boundaries, not query(sql). A genuine collection-based memory implementation
  runs the API before SQLite; SQLite :memory: and PGlite do not fulfill that stage.
- Persistence uses TypeORM EntitySchema with better-sqlite3 and explicit tracked
  migrations. Keep datastore-specific boot details at the adapter boundary. Use
  common ORM/repository operations, not an ad-hoc PostgreSQL-to-SQLite translator.
- Require shared memory/SQLite behavior tests, file-backed persistence/restart,
  constraints, transactions, conflicting writes and durable jobs. ORM use alone
  is not proof any arbitrary DBMS is already supported; a second adapter is #3.
- Keep all old .local/postgres data, previous uploads and Supabase migrations.
  Start a separate ignored SQLite file. No automatic destructive data migration.
- Existing Supabase/PostgreSQL/Vercel choices in older docs are historical, not the
  target for this assignment. Final docs must be reconciled after implementation;
  this decision does not falsely claim the old application is already converted.

TypeORM's [EntitySchema documentation](https://typeorm.io/docs/entity/separating-entity-definition/)
describes separated model definitions. The concrete library choice comes from
the user's explicit instruction, not a claimed portability guarantee.

## Hosting And Release Constraint

A persistent local SQLite file needs durable filesystem storage and a suitable
process/concurrency plan. Ordinary Vercel Functions do not supply a shared durable
local filesystem; deploying this file there as-is is not an acceptable storage
solution. A possible future persistent-volume Node host must be assessed and
approved, not silently bought or deployed. See [Vercel runtime documentation](https://vercel.com/docs/functions/runtimes).

Publication is paused under [#2](https://github.com/maksatworkspace-sudo/studylist/issues/2).
No deployment is performed as part of this PM checkpoint. Real email delivery,
Gmail authorization and actual Kazakh AI quality remain mandatory BLOCKED release
gates under [#1](https://github.com/maksatworkspace-sudo/studylist/issues/1).
Local safe provider adapters, durable queues, failure handling and all promised
product features remain MVP under #16; mocks never mean live integration PASS.

## Acceptance Mapping

| Requirement | Authoritative work/evidence |
| --- | --- |
| Canonical issues and independent roles | #4; process and team docs |
| Design reference | design-system.md; existing TENEASY direction and screenshots |
| Mock frontend -> OpenAPI | #5 -> #6, each with distinct commit and QA PASS |
| Real memory -> ORM SQLite -> connected app | #9 -> #10 -> #11, separate commits |
| Agreed product/security behavior | #12-#16; no silent feature deferral |
| Actual discovered bug workflow | #7/#8 and later genuine user-test-bug issues |
| Isolated HTTP/browser CI | #19, depends on #4/#6, not feature acceptance |
| Thorough independent acceptance | #17 including clean source npm ci verification |
| All docs/chat pushed and issues QA-closed | #18 after all other MVP/bug PASS |
| Real provider/publication/scale work | Visible #1/#2/#3, no false production claim |

The exact current AC/dependencies are in GitHub, not maintained in this table.

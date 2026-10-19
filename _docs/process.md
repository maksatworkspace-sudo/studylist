# Development Process

Date: 2026-10-20. This is the remediation process, not a claim about earlier work.
The private [GitHub issues](https://github.com/maksatworkspace-sudo/studylist/issues)
are the ONLY mutable backlog. [tasks.md](tasks.md) is a link-only index.

## Precedence And Scope

The latest user assignment and [assignment record](assignment-2026-10-20.md)
override obsolete storage/deployment choices in the earlier architecture.
[plan.md](plan.md) and subsequent user decisions define product behavior. Keep
teacher ratings, reporting/Excel, notifications, email and AI worker contracts in
MVP. Live provider verification is an explicit mandatory public-release gate,
not a feature silently dropped because credentials are unavailable.

Do not deploy: the owner paused publication. Keep the repository private. Do not
buy services, send actual email or make paid AI calls without authorization.

## Roles And Issue Lifecycle

1. Orchestrator chooses an unblocked issue and assigns independent role agents.
2. [PM](team/pm.md) grooms it with [task-template.md](task-template.md). Engineer
   reads the exact AC and waits for prerequisite PASS before implementation.
3. [Engineer](team/software-engineer.md) implements one scoped issue, adds tests,
   makes regular commits and pushes evidence. The issue remains OPEN.
4. [Independent QA](team/qa-engineer.md) executes every AC against the pushed
   result, adds adverse/regression cases and comments PASS or FAIL with evidence.
5. FAIL returns to the engineer using QA evidence; PM resolves genuine scope
   ambiguity without weakening a failed requirement. Repeat until actual PASS.
6. QA itself closes only after every AC and dependency passes and all relevant
   code/tests/evidence are committed and pushed. PM, engineer and orchestrator
   never close on QA's behalf. Avoid automatic issue-closing commit keywords.

Role separation is real work by separate agents, not merely files named after
roles. If independent QA is unavailable, record that and leave acceptance open.
The orchestrator coordinates; it must not relabel its own implementation review
as independent QA. Parallel slices must have explicit nonoverlapping ownership.

## Ordered Remediation Checkpoints

| Stage | Issue | Gate and distinct evidence |
| --- | --- | --- |
| Baseline/process | [#4](https://github.com/maksatworkspace-sudo/studylist/issues/4) | Historical working commit plus new process-only commit; no empty-project fiction |
| Mock frontend | [#5](https://github.com/maksatworkspace-sudo/studylist/issues/5) | Typed replaceable service; browser runs without application API calls |
| OpenAPI | [#6](https://github.com/maksatworkspace-sudo/studylist/issues/6) | Root openapi.yml, validation and contract checks |
| Memory backend | [#9](https://github.com/maksatworkspace-sudo/studylist/issues/9) | Running API with real collection-based repository, no SQL engine |
| SQLite ORM | [#10](https://github.com/maksatworkspace-sudo/studylist/issues/10) | TypeORM EntitySchema + better-sqlite3, migrations, shared tests and restart proof |
| Connected app | [#11](https://github.com/maksatworkspace-sudo/studylist/issues/11) | HTTP frontend, two sessions and restart persistence |
| Feature/security verification | [#12](https://github.com/maksatworkspace-sudo/studylist/issues/12), [#13](https://github.com/maksatworkspace-sudo/studylist/issues/13), [#14](https://github.com/maksatworkspace-sudo/studylist/issues/14), [#15](https://github.com/maksatworkspace-sudo/studylist/issues/15), [#16](https://github.com/maksatworkspace-sudo/studylist/issues/16) | Verify existing features rather than claim them newly built |
| Independent runner slice | [#19](https://github.com/maksatworkspace-sudo/studylist/issues/19) | After #4/#6 PASS; no domain change; isolated HTTP/browser CI |
| Full QA | [#17](https://github.com/maksatworkspace-sudo/studylist/issues/17) | Feature QA plus #19, adversarial tests, clean npm ci proof and actual bug loop |
| Final acceptance | [#18](https://github.com/maksatworkspace-sudo/studylist/issues/18) | Reconciled docs; all other MVP/bug issues QA-closed, then QA closes this |

Each of mock, contract, memory, SQLite and integration has its own honest
remediation commit and pushed evidence. Do not combine the entire rewrite into
one commit or invent earlier stage history. Read-only preparation may run ahead;
domain implementation waits for the relevant groomed predecessor PASS. CI
infrastructure #19 can proceed after #4/#6 while backend work evolves, but cannot
claim adapter execution before the adapter actually exists.

## Bug Loop

Actual reproduction -> GitHub issue with `user-test-bug`, Goal, Description,
environment/commit, steps, expected/actual and safe evidence -> PM grooming -> QA
adds and demonstrates failing regression -> engineer fixes -> QA re-runs original
and adjacent cases -> QA PASS and closure after pushed proof. Add `bug` as useful.
Do not invent defects or count old undocumented fixes as freshly reproduced.

QA's reproduced [#7](https://github.com/maksatworkspace-sudo/studylist/issues/7)
and [#8](https://github.com/maksatworkspace-sudo/studylist/issues/8) are groomed.
Preserve their original evidence and expected status choices. Fix in the new
backend only after QA cases and #5/#6 gates; final closure needs both adapters
and integrated HTTP verification. Bug work may be in the relevant stage commit
but must retain its issue/AC/regression trail.

## Evidence And Stop Condition

Every implementation comment records commit SHA, AC mapping, commands/results,
adapter, server URL and relevant redacted artifacts. QA records its own execution.
Update docs alongside changes; no secrets, databases, real owner phone or private
account screenshots belong in Git. Stage explicit owned paths in shared work.

Stop only when all `mvp` and `user-test-bug` issues have legitimate independent
QA PASS and closure, all sources/docs/tests/evidence are pushed and the documented
local app starts from a fresh source installation. Query both labels, including
closed issues, rather than infer success from an empty filter. No deadline was
provided; never claim a deadline was met without a supplied date.

Unverified [live providers #1](https://github.com/maksatworkspace-sudo/studylist/issues/1),
[hosting/publication #2](https://github.com/maksatworkspace-sudo/studylist/issues/2)
and [scale #3](https://github.com/maksatworkspace-sudo/studylist/issues/3) remain
visible. Post-mvp labeling is deferred execution, not production acceptance.

## Sources

The user combines [specification/role/issue workflow](https://aishippingblog.com/p/ai-native-development-specifications)
and [incremental full-stack development](https://aishippingblog.com/p/build-and-ship-a-full-stack-app-with).
User-specific ordering and QA-only closure take precedence over example details.

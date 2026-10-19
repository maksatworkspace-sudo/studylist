# GitHub Task Template

Use this structure in each canonical issue, not a second Markdown task board.
Select `mvp`, `post-mvp` or, for an actually reproduced defect, `user-test-bug`.
An issue may also have `bug`; never create fake bugs to satisfy a count.

```markdown
## Goal
Observable outcome in one or two sentences.

## Description
Product scenario, source decision and current vs intended behavior. Identify
whether this is new implementation, remediation or verification of existing work.

## Acceptance Criteria
- [ ] AC1: Observable positive behavior and its expected result.
- [ ] AC2: Negative/permission/error boundary and expected status/message.
- [ ] AC3: Persistence, atomicity, retry or concurrency rule where applicable.
- [ ] AC4: Named automated/browser checks and committed/pushed evidence.

## Out of Scope
- Excluded behavior -> actual linked follow-up issue.
- Never silently move a promised core feature out of MVP.

## Constraints
Allowed boundaries/tools, user decisions, existing-data protection, no deployment
and no secrets. Engineer does not close; independent QA checks every AC and closes
only after PASS with pushed proof.

## Dependencies
Exact linked issue numbers and gate (for example, predecessor QA PASS).
State None explicitly for a genuinely independent issue.
```

For a bug retain original environment/commit, exact reproduction, expected vs
actual, evidence, severity/impact and controls. Add AC without rewriting reporter
history. QA demonstrates a failing regression before the engineer application fix.
An absent environment is a visible block, not a passing/skipped required case.

# Independent Baseline QA: Catalog Validation

## Scope And Environment

- Date: 2026-10-20, Asia/Almaty.
- Historical application baseline: `6c703879a144ef2a12b2a813378a3ba45db98b46`.
- Running server: `http://127.0.0.1:3000`, Next.js development mode, persisted
  local PGlite PostgreSQL. The existing data directory was not reset or migrated.
- This is independent QA, not implementation or final acceptance. Other agents
  are preparing process documents and a separate mock frontend concurrently.
- Requests used independent cookie jars and synthetic fixtures. No owner data,
  session cookie, receipt secret, provider key or external provider response is
  included here. QA-created feedback was deleted through its owning session;
  QA-created catalog/staff fixtures were left inactive.

## Reproduced Bugs

- [#7](https://github.com/maksatworkspace-sudo/studylist/issues/7): missing valid
  course/teacher UUIDs each cause HTTP 500; inactive course/teacher entries each
  accept new feedback with HTTP 200. Malformed UUIDs correctly return 400.
- [#8](https://github.com/maksatworkspace-sudo/studylist/issues/8): authorized
  leadership updates of a nonexistent course, teacher or account each return
  HTTP 200 `{"ok":true}` instead of 404.

The original independent reproduction, safe response bodies and user impact are
preserved in those issues. PM appended acceptance criteria on 2026-10-20 before
QA added regression cases. Neither issue has been closed.

## Executed Checks

| Execution | Actual result |
| --- | --- |
| `npm test` before new QA cases | 25 passed, 3 live HTTP cases skipped |
| `npm run test:http` | 3 passed against the running baseline |
| Independent additional inline HTTP assertions | 26 passed |
| `TEST_URL=http://127.0.0.1:3000 npx vitest run tests/qa-catalog.test.ts` | 17 executed: 8 failed, 9 passed; expected baseline RED |

The 26 additional assertions covered guest/user/admin leadership permissions;
foreign completion/discard of staged uploads; an oversized PUT followed by a
successful retry; owner file survival after foreign discard; authenticated
hidden-post detail/comment/support/bookmark denial; foreign edit/delete denial;
owner access; deleted-post interaction denial; valid/invalid leap dates; and
malformed file identifiers.

Earlier exploratory requests also checked incomplete uploads, zero-byte files,
public attachment access after publication, hidden attachment denial, author
access to hidden attachments, and deleted attachment denial. These were real
HTTP requests, not additional counted automated test cases.

## Regression Results

`tests/qa-catalog.test.ts` follows the existing `TEST_URL` skip convention and
refuses fixture setup unless the running app identifies itself as local demo
mode. No application source, package file or existing test file was modified.

The eight failed test cases are:

1. Missing course: expected 400/404, actual 500.
2. Inactive course: expected 400/404 with no new post, actual 200 and a new post.
3. Missing course update: expected 404, actual 200.
4. Missing teacher: expected 400/404, actual 500.
5. Inactive teacher: expected 400/404 with no new post, actual 200 and a new post.
6. Missing teacher update: expected 404, actual 200.
7. Missing account activation update: expected 404, actual 200.
8. Uploaded-file retry: invalid course returns 500 instead of 400/404. The same
   uploaded file remains reusable and succeeds with active course and teacher.

The nine passing cases cover two malformed feedback target IDs, malformed
leadership mutation IDs, real QA-owned catalog/account updates and read-back,
four unauthorized roles, and leadership self-protection.

The first harness invocation found an unsupported Vitest chaining method before
running any tests. QA corrected its own new test harness and reran all 17 cases;
the zero-test invocation is not bug evidence and is not counted as execution.

## Limits And Handoff

- This RED result is for PGlite only. It does not satisfy the separate required
  in-memory RED checkpoint, SQLite verification or integrated-backend acceptance.
- Private notification/job/author records, transactional archive races, frontend
  draft/error presentation and every new-adapter AC still require later proof.
- A concurrent frontend edit temporarily made `npm run typecheck` fail because
  `src/services/index.ts` referenced a not-yet-created `./mock` module. This was
  observed during active implementation, not filed as a finished-feature bug or
  counted as a successful typecheck.
- The regression file must first reproduce on the contracted memory backend,
  then pass unchanged on memory, file SQLite and integrated HTTP after the
  engineer's committed fix. QA will add repository-level/race checks as needed.
- No browser mock-stage acceptance, live email/AI, publication or whole-app PASS
  is asserted by this report. Issues #7 and #8 remain open for independent QA.

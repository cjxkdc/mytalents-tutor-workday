# Backend contract v1 — proposed integration addendum

The existing [CONTRACT.md](CONTRACT.md) describes the portal's IndexedDB mock. The new backend is a separate service. The portal is **not switched to HTTP** in this backend-only change, and its pages, styles and mock data are retained.

Canonical backend inputs and result types live in [src/index.ts](src/index.ts), HTTP requests in [openapi.json](openapi.json), and usage in [docs/api.md](../../docs/api.md). This addendum is submitted for the other owner's review; do not merge a contract change without that review.

## Tutor review of AI results (DESIGN_CONSENSUS.md v1.4)

The user requires a tutor to review AI-marked and scanned results before they become official. A processed scan
job ends in `awaiting_review` with a `MarkingReview` holding per-question AI suggestions (`suggested`,
`uncertain`, or `unreadable` - unreadable is never scored as zero). Nothing is written to attempts, mistakes or the
three tables until a tutor calls `POST /api/v1/reviews/{id}/confirm` with the full marks; that call writes the
attempt and all projections in one transaction. `reject` records nothing. Students cannot read reviews.

Imports posted by staff through `/api/v1/imports` are tutor-entered or tutor-confirmed marks and need no second
review. Weekly-homework multiple-choice auto-grading also needs no review.

## Field mapping for the future HTTP adapter

| Portal mock v0.1 | Backend v1 |
| --- | --- |
| user.role=tutor | Principal.role=teacher |
| user.studentId | Principal.studentIds[0], assigned server-side |
| Test.id / name / type=module-test | Exam.id / title / kind=module_test |
| question.no / marks / kps | question.id (e.g. q1) / maxScore / knowledgePointIds |
| testId + numeric attempt | stable examId + attempt.id; ordinal derived by completedAt |
| QuestionResult.version (opaque string) | integer attempt.revision, all question results replaced together |
| markedAt local date/string | ISO timestamp with explicit timezone, e.g. +11:00 |
| pct (0–100) | ratio (0–1); present ratio*100 in UI |
| band green/amber/red | high/medium/low; front end chooses colors |
| not-understood / not-covered / insufficient | not_understood / not_covered / null |
| ApiError VALIDATION / CONFLICT / STORAGE | map specific HTTP error codes as documented; preserve code for debugging |

Mock getExhibits maps to the three `/api/v1/tables/*` endpoints; getEvidence/getMyProgress to the student's learning-state response; getMyMistakes to mistakes (filter BLANK for a W/C-only view). me/listStudents/reference catalog use me/students/exams/knowledge-points/policies. Confirming local marks maps to a single ImportBatch. Confirming an AI scan result maps to `POST /api/v1/reviews/{id}/confirm`.

The backend's initial rule version uses score ratios and latest attempts per exam. The existing mock uses a recent-evidence wrong-answer ratio. These are **different policies**, not interchangeable defaults. The backend is authoritative once connected; the frontend must display the backend's evidence/reason/policyVersion rather than recompute mastery. Review the proposed thresholds in defaultPolicy before the real demo. No student is labeled not-covered solely because data is absent.

Not yet mapped: correction submission lifecycle, ungraded upload storage in Drive, externally reported exam timing logs, Classroom sync. These mock-only methods must not be presented as live backend functionality until their endpoints are implemented. The new scan endpoint currently requires its generated QR answer sheet and PNG/JPEG pages. A pre-existing arbitrary paper upload cannot silently be treated as graded.

## Owner B backend module interface

Export `register(app, deps)` using BackendModule from `backend/src/modules.ts`, then pass it in createApp's modules array. The supplied deps contain repo, derive, policy, ai, notify, audit, imports, reportFacts and access helpers. Every registered route inherits authentication; each module must apply role and student scope checks with deps.access.

```ts
export const register: BackendModule = (app, deps) => {
  app.get('/api/v1/example/report-facts', async request => {
    deps.access.requireStaff(request.principal);
    const state = await deps.repo.read();
    return deps.reportFacts(state, '2026-10-13',
      id => deps.access.canReadStudent(request.principal, id));
  });
};
```

For writes, use one repo.transact callback and append audit/outbox to that same draft via deps.audit.append/deps.notify.enqueue. These helpers never send an external message. NotificationAdapter remains the separate delivery port. New fact tables require a typed State/schema extension reviewed in a PR; do not put business state in frontend localStorage once connected.

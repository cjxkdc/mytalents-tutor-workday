# Contract (draft v0.1)

What both people build against. Owner: A. Changes go through a PR reviewed by B.

## 1. Page modules

Each page is an ES module in `apps/<app>/pages/` and is registered in `apps/<app>/routes.js`:

```js
{ id: 'messages', label: 'Messages', icon: 'message-circle', owner: 'B', roles: ['tutor', 'manager'], nav: true,
  load: () => import('./pages/messages.js') }
```

- Access: the router controls who can open a page (`roles`); the API controls who can read or change data.
  A page may still show or hide buttons by `ctx.user.role` (e.g. manager-only sign-off).
- `params` are the hash path segments after the route id, URL-decoded: `#/marking/sub-101` → `['sub-101']`.
  Pages must treat unknown or missing params as "nothing selected", never throw.
- `icon` is a Tabler outline icon name.

The module exports one function:

```js
export function render(el, params, ctx) {
  // build DOM inside `el`; may return a cleanup function
  return () => { /* remove listeners, revoke object URLs, stop timers */ };
}
```

| `ctx` field | Meaning |
|---|---|
| `api` | The API (section 3). Demo mode: `packages/contract/mock-api.js`. |
| `user` | `{ id, name, role }` plus `staffId` or `studentId`, `studentNo`. Demo identity. |
| `signal` | `AbortSignal`, aborted when the page is left or the identity changes. After every `await`, `if (ctx.signal.aborted) return;`. |
| `subscribe(fn)` | Call `fn` when data changes (this tab, other tabs, window focus). Removed automatically on leave. |
| `navigate(path)` | Go to `#/<path>`. |
| `toast(msg)` | Short status message. |
| `routes` | The app's route table (used by home tiles). |

Lifecycle on navigation: abort `signal` → drop subscriptions → run cleanup → mount the next page.
Abort does **not** undo writes that already finished.

Pattern used by every page (`requestGate` is in `packages/ui/components/html.js`):

```js
const gate = requestGate(ctx.signal);
async function load() {
  const current = gate();            // newest request wins; false after the page is left
  try {
    const d = await ctx.api.something();
    if (!current()) return;
    paint(d);
  } catch (e) { if (current()) el.innerHTML = errorBanner(e); }
}
load();
ctx.subscribe(load);
```

- `subscribe` notifications may repeat and do not map one-to-one to writes. Just re-query.
- Keep unsaved form input in variables outside `paint()`, because `load()` repaints on every data change.
- After any awaited write in an event handler, check `ctx.signal.aborted` before touching the page or calling `toast`.
- Capture selection state (e.g. the clicked heat-map cell) at the start of `load()` and use the captured value.

## 2. Errors

All API methods return Promises and reject with `ApiError { code, message, details? }`.
Exception: `subscribe(fn)` is synchronous and returns the unsubscribe function.

| code | When |
|---|---|
| `FORBIDDEN` | Wrong role, or a student asking for someone else's data |
| `NOT_FOUND` | Unknown id |
| `VALIDATION` | Bad input. `details` lists the fields or `{ qNo, message }` items |
| `INVALID_STATE` | Action not allowed in the record's current status |
| `REASON_REQUIRED` | Replacing existing results without a reason |
| `CONFLICT` | The record changed since the caller loaded it (stale version). Refresh and retry |
| `STORAGE` | The storage layer failed (e.g. browser quota). `message` has the native error |

### State transitions

| Record | Transitions | Who |
|---|---|---|
| Submission | `queued` → `marked` (confirmMarking) · `queued` → `exception` (markException) | staff |
| Correction | none → `submitted` (student) · `needs-work` → `submitted` (student) · `submitted` → `confirmed` / `needs-work` (staff) | as shown |
| Lesson change | none → `pending` (student) → `approved` / `declined` (staff) · `pending` → `withdrawn` (student) · none → `approved` (staff direct) · `approved` → `revoked` (staff) | as shown |

Every check-then-write runs inside one storage transaction, so two tabs confirming the same submission
cannot both succeed: the second gets `INVALID_STATE`.

Versions guard against acting on stale screens: every marking gives the results a new `version`;
`submitCorrection` must send the `resultVersion` the student saw, and `reviewCorrection` the correction
`version` the tutor saw. A mismatch returns `CONFLICT`.

Re-marking an attempt that already has results replaces them (needs `reason`). Corrections attached to the
replaced results are removed and copied in full into the audit entry (`supersededCorrections`), because they no
longer match the new marks. Demo simplification - the backend should version results instead.

## 3. API methods (implemented in demo mode)

### Common
| Method | Returns |
|---|---|
| `me()` | current user |
| `reference()` | `{ modules, tests, policy, today }` |
| `subscribe(fn)` | unsubscribe function (pages use `ctx.subscribe`) |
| `resetDemo()` | demo only |

### Staff (tutor, manager) - owner A
| Method | Notes |
|---|---|
| `getStaffHome()` | counts for home page, week timetable, upcoming SACs |
| `listStudents()` | |
| `listSubmissions()` | all submissions with `studentName`, `testName` |
| `getSubmission(id)` | `{ submission, student, test, pages[{ blob, type, name, index }], existingAttempts, nextAttempt, aiSuggestions }` |
| `confirmMarking(id, { attempt, items[{ qNo, outcome, score }], reason? })` | outcome ∈ DONE / W / C / BLANK; 0 ≤ score ≤ marks; BLANK scores 0. Replacing an attempt that already has results needs `reason`; logged to audit. Returns `{ score, total, pct }` |
| `markException(id, reason)` | |
| `getExhibits()` | `{ students, sheet, stats, progress }` - Exhibits 1-3 |
| `getEvidence(studentId, kpId)` | evidence behind one heat-map cell (students may only ask for themselves) |
| `listExamRecords()` | |
| `listCorrections()` / `reviewCorrection(id, { accept, note, version })` | returning a correction needs a note; `version` from the list |
| `listAudit()` | |

### Timetable - owner A
Lessons only; Q&A sessions are not part of the timetable. Weekly template = reference data; changes and attendance
are facts; the lessons on a date are derived by `packages/contract/timetable.js` (pure, reusable by the backend).

| Method | Who | Notes |
|---|---|---|
| `getTimetable({ from?, to? })` | staff | default this Mon-Sun, at most 42 days. `{ today, from, to, rules, teachers, rooms, students, days[{ date, weekday, lessons, summary }], pending, recent }` |
| `changeLesson({ occId, kind, to?, reason })` | staff | kind ∈ leave / online / reschedule; takes effect at once. Extra lesson: `{ kind: 'extra', studentId, to: { date, start, end, teacher, mode, room? }, reason }` |
| `decideLessonChange(id, { approve, note, version })` | staff | declining needs `note`; approving re-checks the slot and fills `notice` |
| `revokeLessonChange(id, { reason, version })` | staff | approved → revoked; refused once attendance is recorded |
| `markAttendance(occId, date, status)` | staff | status ∈ present / late / absent, `null` clears. Only lessons that take place, today or earlier |
| `getMyTimetable({ from?, to? })` | student | own lessons and own requests; no staff notice text |
| `requestLessonChange({ occId, kind, to?, reason })` | student | kind ∈ leave / online / reschedule → `pending` |
| `withdrawLessonChange(id, version)` | student | pending → withdrawn |

Rules (all return `VALIDATION` or `INVALID_STATE`): reason required; lesson today or later; one pending or approved
change per lesson; no change once attendance is recorded; reschedule and extra lessons must be on a weekday, inside
`policy.timetable` shift hours and must not overlap the student's other lessons. Shared teachers or rooms are group
lessons, not conflicts. An approved change carries `notice: { to, text }` for the tutor to copy into WeCom - nothing is sent.

```js
// one lesson occurrence (days[].lessons[])
{ id: 'L02|2026-10-15' /* lessonId|original date, or X|changeId for extras */, lessonId, studentId, studentName,
  date, start, end, teacher, room, mode: 'onsite'|'online', extra,
  state: 'scheduled'|'cancelled'|'moved' /* moved = placeholder on the original date */,
  change?, pending?, movedFrom?: { date, start, end }, movedTo?: { date, start, end },
  attendance?: { status: 'present'|'late'|'absent', markedBy, markedAt } }
// summary (per day) - arrivals for the daily report come from here
{ lessons, onsite, online, present, late, absent, unmarked, cancelled, arrivedOnsite }
// change fact
{ id, occId, lessonId?, studentId, date /* original */, kind: 'leave'|'online'|'reschedule'|'extra', to?, reason,
  source: 'student'|'staff', status, requestedBy, requestedAt, decidedBy?, decidedAt?, decisionNote?, notice?, version }
```

### Student - owner A
| Method | Notes |
|---|---|
| `getMyHome()` | profile, lessons, current module and test, SAC with gaps |
| `listMyTests()` | tests with `attempts` and `nextAttempt` |
| `submitTest({ testId, suggestedAttempt, files[{ blob, name, type }] })` | limits in `policy.upload`; attempt is only a suggestion, the tutor confirms |
| `listMySubmissions()` | |
| `getMyMistakes()` | W and C results with correction status: open / submitted / needs-work / confirmed |
| `submitCorrection(mistakeId, note, resultVersion)` | `resultVersion` from `getMyMistakes()` |
| `getMyProgress()` | own heat-map row, test stats |
| `listMyExamRecords()` / `addExamRecord(rec)` | `rec = { date, paper, start, endFirst, endSecond, checks, score, outOf }` |

### Return shapes B is most likely to read

`?` = may be null. Dates are `YYYY-MM-DD`, timestamps `YYYY-MM-DDTHH:mm:ss` local time.

```js
// getStaffHome()
{ today: '2026-10-13', queued: 2, exceptions: 1, correctionsToReview: 0, timetableRequests: 2,
  week:          [/* lesson occurrences (see Timetable) for today + 6 days, each with day: 1=Mon..7=Sun */],
  todaySessions: [/* today's lessons that take place, sorted by start */],
  upcomingSacs:  [{ studentId, studentName, date, title, moduleIds: ['M2','M3'] }] }

// getExhibits()
{ students: [{ id, name, studentNo, year, school, currentModule, completedModules: [], sac? }],
  sheet:    [{ studentId, testId, attempt, markedAt, score, total, pct, entered, questions,
               cells: { [qNo]: { outcome: 'DONE'|'W'|'C'|'BLANK', score, markedBy, markedAt } } }],
  stats:    [{ studentId, tests: { [testId]: null | { attempts, latest, score, total, pct, band: 'green'|'amber'|'red' } } }],
  progress: [{ studentId, cells: { [kpId]: { status, cCount } }, summary: { mastered, partial, notUnderstood } }] }
// status ∈ mastered | partial | not-understood | not-covered | insufficient   (percentages are 0-100)

// getMyProgress()
{ row: /* one progress entry as above */, stats: /* one stats entry as above */, modules, tests, policy }

// getMyMistakes()
[{ id, resultVersion, type: 'W'|'C', testId, testName, attempt, qNo, marks, markedAt, kps: [{ id, name }],
   correction: { status: 'open'|'submitted'|'needs-work'|'confirmed', version?, note?, tutorNote?, submittedAt?, confirmedAt? } }]
```

### Adding storage
New fact tables need a new IndexedDB store: add the name to `STORES` in `db.js`, bump `DB_VERSION`, and create
the store in `onupgradeneeded`. Bumping `SEED_VERSION` in `mock-data.js` **wipes all demo data** in every
browser that opens the app. Agree these changes with the storage owner in the PR.

### To be added by B (propose here first)
Messages and triage (a message asking for a lesson change should end up as a timetable change, via
`changeLesson`), daily report and sign-off (arrivals from the Timetable `summary`), parent reports,
student management, policy approval, AI quality. Put each new method in this file with
inputs, outputs and errors before building against it.

## 4. Facts vs derived data

Only facts are written: results, submissions, pages, corrections, exam records, lesson changes, attendance, audit (more to come from B).
Exhibits 1-3, mastery, mistake lists and report counts are computed by `packages/contract/derive.js`
(pure functions - the real backend reuses them). Rule values come from `policy`, never hard-coded.

AI output will always be stored as a pending suggestion; only a tutor action turns it into a fact.

## 5. Demo-mode storage

- IndexedDB `tutor-workday-demo`: one store per fact table, scan pages stored as Blobs.
- localStorage: only the demo identity per app.
- Both apps share the database because they run on the same origin. **This is demo-only.** In production
  each app talks only to the backend, which scopes student requests to the signed-in student.
- The shared Google Sheets database is reached through the TypeScript backend (branch
  `codex/backend-automation-core`, see its `BACKEND.md`). The portals are not connected to it yet.

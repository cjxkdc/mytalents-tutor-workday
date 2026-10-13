# MyTalents Tutor Workday

A hackathon project to simplify teaching operations and learning support at MyTalents
(AIPS Hackathon case *Automating the Learning Support Tutor's Workday*).

**Status:** front-end framework for both portals is running in demo mode. **All data is synthetic and stored
in your browser only.** A separate TypeScript backend is now available; these existing portal pages still use
the IndexedDB mock API until their owner connects them. External Google/AI credentials are not configured.

## Backend

With Node.js 24+ and pnpm 11.25.0, run `pnpm install --frozen-lockfile`, then `pnpm dev`.
The API listens on `http://127.0.0.1:3100`; `pnpm demo:seed` imports synthetic data.
`pnpm check` runs type checking, tests and a production build.

See [backend setup](backend/README.md), [API](docs/api.md), [module handoff](docs/architecture.md),
and [backend contract addendum](packages/contract/BACKEND.md). This backend automatically validates/imports
marks and derives all three exhibits without a teacher approval gate, following the latest project request.
This PR does not change the portal pages, their mock workflow, or their appearance.

> **Pending decisions** (see `DESIGN_CONSENSUS.md`, "待用户决定的冲突"): two Google Sheets connections now coexist
> (this TypeScript service and the Apps Script service the portals use), and the consensus exam flow is
> "AI marks -> tutor reviews", which differs from the no-approval statement above. Neither is settled yet.

## Run

No build step, no dependencies:

```bash
python serve.py
```

Open http://localhost:8765 and pick a portal:

- Staff portal (tutor, manager): http://localhost:8765/apps/staff/
- Student portal (mobile first): http://localhost:8765/apps/student/

Open both in separate tabs: a test a student uploads appears in the staff marking queue straight away.
Use "Reset demo data" in the top strip to start over.

### Storage

Data currently lives in your browser (IndexedDB, synthetic demo data). The shared Google Sheets database is
connected through the TypeScript backend in `backend/` (owner: Robin); the portals are not wired to it yet. See DESIGN_CONSENSUS.md, "数据库".

## Product direction

Create an LMS-inspired workspace for teachers, managers and students. Reduce repeated data entry, help staff
coordinate follow-up work, and make daily progress easier to see.

## Modules

| Area | Capabilities | Status |
| --- | --- | --- |
| Teacher portal | Test marking/review, records (Exhibits 1-3), corrections | Working (demo) |
| | Timetable: whiteboard by room, attendance, change requests and direct changes, extra lessons, WeCom notice text | Working (demo) |
| | Daily reports, student briefings, student management (messages stay in WeChat; no message centre) | Placeholders (owner B) |
| Manager access | Teacher capabilities plus daily report review and sign-off, policy approval | Placeholders (owner B) |
| Student portal | Upload scanned papers, mistake bank, record exam data, view learning progress | Working (demo) |
| | Timetable: weekly lessons, request leave / online / reschedule | Working (demo) |
| | Study hints | Placeholder (owner B) |
| Shared features | Role-based access (demo identity switcher), mistake bank, timetable, Google ecosystem sync | Partly; sync not connected |

What works end to end: student upload → marking console (per-question DONE / W / C / Blank + score; tutor confirms
the attempt; replacing results needs a reason and is logged) → Exhibits 1-3 and heat-map with evidence drill-down
→ student mistake bank → student correction → tutor confirms or returns it.

## Structure

```
apps/staff/          staff portal
apps/student/        student portal
packages/contract/   CONTRACT.md, mock API (IndexedDB), derive functions, synthetic data
packages/ui/         tokens, base styles, router, layout, shared components
backend/             src/, test/: modular TypeScript API, Google Sheets repository, scanning and tests (Robin)
docs/                milestones and ownership
prototype/           earlier single-page prototype, kept for reference
serve.py             no-cache dev server
```

## Visual direction

LMS-style portal: quick-access tiles, a daily schedule panel and a modular dashboard, in a bright blue-and-white
palette (`packages/ui/tokens.css`). Apply MyTalents' own identity and content; no third-party logos.

## Collaboration

- Work on a feature branch (`a/<feature>`, `b/<feature>`) and open a pull request to `main`.
- Build pages and API methods against [packages/contract/CONTRACT.md](packages/contract/CONTRACT.md);
  propose contract changes in a PR reviewed by the other owner.
- Keep credentials and real student records out of the repository; use synthetic examples for the demo.

## Docs

- [Contract](packages/contract/CONTRACT.md) - page interface, API methods, errors, state transitions
- [Milestones](docs/MILESTONES.md)
- [Ownership](docs/OWNERSHIP.md)

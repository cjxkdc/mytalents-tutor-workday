# Tutor Workday

Prototype for the AIPS Hackathon case *Automating the Learning Support Tutor's Workday*.

**Demo mode only: all data is mock data stored in your browser.** No real student information.

## Run

No build step, no dependencies:

```bash
python serve.py
```

Open http://localhost:8765 and pick a portal:

- Staff portal: http://localhost:8765/apps/staff/
- Student portal: http://localhost:8765/apps/student/

Open both in separate tabs: a test a student uploads appears in the staff marking queue straight away.
Use "Reset demo data" in the top strip to start over.

## Structure

```
apps/staff/          staff portal (tutor, manager)
apps/student/        student portal (mobile first)
packages/contract/   CONTRACT.md, mock API, derive functions, mock data
packages/ui/         tokens, base styles, router, layout, shared components
backend/             (not started)
docs/                milestones and ownership
prototype/           earlier single-page prototype, kept for reference
```

## What works (owner A)

- Student uploads photos of a test (resized in the browser, stored locally)
- Staff marking queue and console: scans next to per-question DONE / W / C / Blank and score;
  attempt confirmed by the tutor; replacing results requires a reason and is logged
- Records: Exhibits 1-3 generated from one result table, heat-map drill-down to evidence, exam records, audit log
- Student mistake bank (W and C), corrections, tutor confirms or returns them
- Student progress and exam log

Pages owned by B are registered as placeholders with their planned scope.

## Docs

- [Contract](packages/contract/CONTRACT.md) - page interface, API methods, errors
- [Milestones](docs/MILESTONES.md)
- [Ownership](docs/OWNERSHIP.md)

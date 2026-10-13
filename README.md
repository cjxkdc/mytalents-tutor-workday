# Tutor Workday Dashboard

Prototype for the AIPS Hackathon case *Automating the Learning Support Tutor's Workday* (University of Melbourne AI Prototyping Studio).

**All data is mock data** modelled on the brief's Exhibits 1–3. No real student information.

## Run

No build step and no dependencies. ES modules need a local server:

```bash
python -m http.server 8765
```

Then open http://localhost:8765.

## Core idea

The tutor confirms each test question **once**. That single confirmation writes a result long table, and the Marking Sheet (Exhibit 1), the Student Progress Sheet (Exhibit 2) and the Student Exam Statistics (Exhibit 3) are all derived views of it. This removes the triple entry in brief step 8.

AI only drafts or suggests. The tutor keeps every judgement call: final marks and W/C labels, passing a Demo, scheduling a Retest, messages to parents, and confirming the follow-up list. The manager still signs the report.

## Pages → brief steps

| Page | Brief step | Status |
|---|---|---|
| Today | 1–3: workspace, timetable, attendance, change requests | Working on mock data |
| Briefings | 4: pre-session fact sheet per student (step 5 stays human) | Working; AI plan suggestion is a placeholder |
| Messages | 6–7: paste message → triage → reply draft | Triage is a keyword **stub**; AI draft is a placeholder |
| Marking | 8: submission queue + per-question console → sync to Exhibits 1–3 | Working; scan crops and AI suggestions are placeholders |
| Records | Exhibits 1–3 + 9C exam self-records; heat-map cells drill down to evidence | Working |
| Daily report | Phase 5: auto-counted facts, rule-based follow-up nominations, manual sign-off | Working |
| Policy | Every rule the system applies, flagged *proposed* until the centre approves | Working |

## Structure

```
index.html
css/styles.css
js/app.js            hash router + nav
js/data/mock.js      mock data + proposed policy (shape mirrors planned Google Sheets tables)
js/lib/store.js      state, derived Exhibit views, mutations
js/lib/triage.js     STUB message triage (to be replaced by an LLM call)
js/lib/ui.js         small render helpers
js/views/*.js        one file per page
```

## Proposed policy (demo defaults)

- Mastery uses the latest 3 valid evidence items per knowledge point; fewer than 2 gives "insufficient evidence".
- C (careless) is shown separately and does not count toward mastery.
- Blank means "confirmed not attempted". It is never turned into W, and it is a different state from "not entered".
- A W on a multi-knowledge-point question counts only against the primary knowledge point.

All values live in `js/data/mock.js` → `policy` and are shown on the Policy page.

## Not built yet

- Google Sheets / Classroom read-write (currently in-memory mock; changes reset on reload)
- Answer-sheet template with QR, scan upload and cropping
- AI marking suggestions (match / no match / cannot tell), message triage and drafts, plan suggestions
- Tutor override with reason logging on the heat-map
- Parent weekly report drafts

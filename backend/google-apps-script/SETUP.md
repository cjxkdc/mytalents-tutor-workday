# Google Sheets database setup

The Google Sheet is the database. An Apps Script web app bound to it reads and writes the tabs and
stores scan images in Google Drive. The portals reach it through `packages/contract/sheets-db.js`.

**Use synthetic data only.** Access is "web app link + shared token", not real authentication.

This is the hackathon demo storage (DESIGN_CONSENSUS.md v1.5). Use a **new** spreadsheet: never the one the
TypeScript backend in `backend/src` writes to.

## One-time setup (about 5 minutes)

1. Sign in to the Google account that should own the data. Create a new Google Sheet, e.g. `MyTalents DB (demo)`.
2. In the Sheet: **Extensions → Apps Script**. Delete the sample code and paste the whole of `Code.gs`.
   Optional: Project Settings → tick "Show appsscript.json", then paste `appsscript.json`.
3. Choose the function **`setup`** in the toolbar and click **Run**. Approve the permission prompts
   (Sheets and Drive). Open the **Execution log** and copy the token it prints.
   `setup` also creates a Drive folder `MyTalents scans (demo)` for scan images.
4. **Deploy → New deployment →** type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click Deploy and copy the **Web app URL** (ends in `/exec`).
5. In the repository, copy `packages/contract/config.example.json` to `packages/contract/config.local.json`
   and fill in `url` and `token`. This file is gitignored - never commit it.
6. Run `python serve.py` and open a portal. The strip under the top bar should say
   "stored in the shared Google Sheet". The first page load fills every tab with the demo data.

To go back to the offline browser database, delete `config.local.json` or add `?storage=indexeddb` to the URL.

## Updating the server code

Paste the new `Code.gs`, then **Deploy → Manage deployments →** edit (pencil) **→ Version: New version → Deploy**.
The URL stays the same. A new *deployment* would give a new URL.

## How the Sheet is laid out

- One tab per fact table (`results`, `submissions`, `pages`, `corrections`, `examRecords`, `audit`, `meta`, ...).
  New tables in `db.js` `STORES` get their tab automatically on first write - no schema step.
- Row 1: field names. Row 2 (hidden): column types. Row 3 onwards: one record per row.
- `_rev` counts changes to a record. Tab `_revs` holds one revision per table, used to detect
  concurrent edits: if two people change the same table at the same moment, the second write is retried
  on fresh data, so nobody's change is silently lost.
- Scan images live in Drive; the `pages` tab only keeps the file id (`blob__drive`).
- **`View - ...` tabs are for people, not the app**: `View - Exhibit 1 Marking`, `View - Exhibit 2 Progress`,
  `View - Exhibit 3 Exam stats` and `View - Timetable <date>`. The portals rebuild them about a second after
  every change, colour-coded like the centre's sheets. Open one during the demo, mark a test in the staff
  portal, and the row updates. Anything typed into these tabs is overwritten.

## Rules for people opening the Sheet

- Treat it as **read-only**. Editing cells by hand skips validation, history and the audit log.
  Share it with staff as Viewer.
- Never edit the hidden types row, `id`, `_rev` or the `_revs` tab.
- "Reset demo data" in the portals overwrites **every tab** with demo data.

## Limits to know

- Each request takes about 1-3 seconds; the portals cache reads for a few seconds and check for changes
  from other devices every 15 seconds.
- Apps Script quotas apply (execution time, daily calls). Fine for a demo, not for a whole centre.
- Business rules still run in the browser; the server guarantees atomic writes and conflict detection.
  Server-side grading (weekly homework answer keys) must move into Apps Script before real use.

## Testing without Google

Open `backend/google-apps-script/sim/test.html?storage=sim`. It runs the real `Code.gs` against an
in-memory spreadsheet and checks seeding, uploads to Drive, marking, the `View - ...` tabs, timetable
tables, concurrent edits, correction versions, formula-looking text, wrong tokens and reset (23 checks). Any portal also accepts `?storage=sim`
(memory only, lost on reload).

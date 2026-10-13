// Exhibits 1-3 as views over one result table, exam self-records and the audit log. Owner A.
import { esc, errorBanner, proposedPolicy, fmtDateTime, requestGate } from '../../../packages/ui/components/html.js';
import { outcomeCell, heatmap, bindHeatmap, evidenceTable, MASTERY_LABEL } from '../../../packages/ui/components/records.js';

const TABS = [
  ['marking', 'Exhibit 1 · Marking Sheet'],
  ['progress', 'Exhibit 2 · Progress Sheet'],
  ['stats', 'Exhibit 3 · Exam Statistics'],
  ['exams', 'Exam records'],
  ['audit', 'Audit log'],
];

let pick = null; // { studentId, kpId } - survives data refresh

export function render(el, params, ctx) {
  const tab = TABS.some(t => t[0] === params[0]) ? params[0] : 'marking';
  el.innerHTML = `
    <div class="page-head"><h1>Records</h1><p class="lede">All three sheets are generated from one result table - nothing is entered twice.</p></div>
    <nav class="sub-tabs">${TABS.map(([id, label]) => `<a href="#/records/${id}" class="${id === tab ? 'active' : ''}">${label}</a>`).join('')}</nav>
    <section class="card"><div class="card-body" id="body"><div class="loading">Loading…</div></div></section>`;
  const body = el.querySelector('#body');
  let ref = null;

  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    const selected = pick; // capture at start: a newer click must not mix with this request's evidence
    try {
      ref = ref || await ctx.api.reference();
      const view = { marking, progress, stats, exams, audit }[tab];
      const html = await view(selected);
      if (!current()) return;
      body.innerHTML = html;
      if (tab === 'progress') bindHeatmap(body, (s, k) => { pick = { studentId: s, kpId: k }; load(); });
    } catch (e) { if (current()) body.innerHTML = errorBanner(e); }
  }

  const name = (students, id) => students.find(s => s.id === id)?.name || id;

  async function marking() {
    const x = await ctx.api.getExhibits();
    const maxQ = Math.max(...ref.tests.map(t => t.questions.length));
    return `<p class="muted">DONE = correct · W = wrong · C = careless error · Blank = confirmed not attempted · - = not entered</p>
      <div class="table-wrap"><table>
      <thead><tr><th>Student</th><th>Test</th><th>Attempt</th><th>Marked</th>${Array.from({ length: maxQ }, (_, i) => `<th>Q${i + 1}</th>`).join('')}<th>Score</th></tr></thead>
      <tbody>${x.sheet.map(r => {
        const t = ref.tests.find(tt => tt.id === r.testId);
        return `<tr><td>${esc(name(x.students, r.studentId))}</td><td>${esc(r.testId)}</td><td>${r.attempt}</td><td>${esc(r.markedAt)}</td>
          ${t.questions.map(q => outcomeCell(r.cells[q.no])).join('')}${'<td></td>'.repeat(maxQ - t.questions.length)}<td>${r.score}/${r.total}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  async function progress(p) {
    const x = await ctx.api.getExhibits();
    const rows = x.progress.map(p => ({ ...p, label: name(x.students, p.studentId) }));
    let drill = '<p class="muted">Select a cell to see the evidence behind it.</p>';
    if (p) {
      const cell = await ctx.api.getEvidence(p.studentId, p.kpId);
      const kp = ref.modules.flatMap(m => m.kps).find(k => k.id === p.kpId);
      drill = `<div class="drill"><h3>${esc(name(x.students, p.studentId))} · ${esc(kp.id)} ${esc(kp.name)} → ${MASTERY_LABEL[cell.status]}</h3>
        ${evidenceTable(cell, ref.policy)}
        <p class="placeholder">Tutor override (status + reason, written to the audit log) - next step for this page.</p></div>`;
    }
    return proposedPolicy() + heatmap(ref.modules, rows, p) + drill;
  }

  async function stats() {
    const x = await ctx.api.getExhibits();
    return `${proposedPolicy()}<div class="table-wrap"><table>
      <thead><tr><th>Student</th>${ref.tests.map(t => `<th>${esc(t.name)}</th>`).join('')}</tr></thead>
      <tbody>${x.stats.map(r => `<tr><td>${esc(name(x.students, r.studentId))}</td>${ref.tests.map(t => {
        const c = r.tests[t.id];
        return c ? `<td class="band-${c.band}">${c.pct}% <span class="muted">· ${c.attempts > 1 ? 'attempt ' + c.latest : '1st'}</span></td>` : '<td class="muted">-</td>';
      }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="muted">Latest attempt shown. Bands: green ≥ ${ref.policy.bands.green}%, amber ≥ ${ref.policy.bands.amber}%.</p>`;
  }

  async function exams() {
    const rows = await ctx.api.listExamRecords();
    const mins = (a, b) => { const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return h2 * 60 + m2 - (h1 * 60 + m1); };
    return `<p class="muted">Self-recorded by students after each exam (step 9C). Descriptive only.</p>
      <div class="table-wrap"><table><thead><tr><th>Student</th><th>Date</th><th>Paper</th><th>First pass</th><th>Second pass</th><th>Checks</th><th>Score</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.studentName)}</td><td>${esc(r.date)}</td><td>${esc(r.paper)}</td>
        <td>${mins(r.start, r.endFirst)} min</td><td>${mins(r.endFirst, r.endSecond)} min</td><td>${r.checks}</td><td>${r.score}/${r.outOf}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  async function audit() {
    const rows = await ctx.api.listAudit();
    if (!rows.length) return '<p class="empty">No actions logged yet.</p>';
    return `<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(fmtDateTime(r.at))}</td><td>${esc(r.by)} <span class="muted">(${esc(r.role)})</span></td><td>${esc(r.action)}</td>
        <td style="white-space:normal"><code>${esc(JSON.stringify(r.details))}</code></td></tr>`).join('')}</tbody></table></div>`;
  }

  load();
  ctx.subscribe(load);
}

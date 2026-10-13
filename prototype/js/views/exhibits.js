// Exhibits 1-3 as views over the same long table, plus the step 9C self-recorded exam data.
import * as store from '../lib/store.js';
import { esc, outcomeCell, MASTERY_LABEL, proposedBanner } from '../lib/ui.js';

const TABS = [
  ['marking', 'Exhibit 1 · Marking Sheet'],
  ['progress', 'Exhibit 2 · Progress Sheet'],
  ['stats', 'Exhibit 3 · Exam Statistics'],
  ['records', 'Exam records (9C)'],
];

let drill = null; // { studentId, kpId }

export function render(el, params) {
  const tab = params[0] || 'marking';
  el.innerHTML = `
    <h1>Records</h1>
    <p class="lede">All three sheets are generated from one result table - nothing is entered twice.</p>
    <div class="tabs">${TABS.map(([id, label]) => `<a class="tab ${id === tab ? 'active' : ''}" href="#/exhibits/${id}">${label}</a>`).join('')}</div>
    <div id="tab-body">${({ marking, progress, stats, records }[tab] || marking)()}</div>`;

  el.querySelectorAll('[data-drill]').forEach(td => td.addEventListener('click', () => {
    const [studentId, kpId] = td.dataset.drill.split('|');
    drill = { studentId, kpId };
    render(el, params);
  }));
}

function marking() {
  const rows = store.markingSheet();
  const maxQ = Math.max(...store.tests.map(t => t.questions.length));
  return `<section class="card">
    <p class="muted">DONE = correct · W = wrong · C = careless error · Blank = confirmed not attempted · - = not entered</p>
    <div class="table-wrap"><table class="sheet">
      <thead><tr><th>Student</th><th>Test</th><th>Att.</th><th>Marked</th>${Array.from({ length: maxQ }, (_, i) => `<th>Q${i + 1}</th>`).join('')}<th>Score</th></tr></thead>
      <tbody>${rows.map(r => {
        const s = store.studentById(r.studentId);
        const test = store.testById(r.testId);
        const sc = store.attemptScore(r.studentId, r.testId, r.attempt);
        return `<tr><td>${esc(s.name)}</td><td>${esc(r.testId)}</td><td>${r.attempt}</td><td>${esc(r.markedAt)}</td>
          ${test.questions.map(q => outcomeCell(r.cells[q.no])).join('')}
          <td>${sc.score}/${sc.total}</td></tr>`;
      }).join('')}</tbody>
    </table></div></section>`;
}

function progress() {
  const kps = store.modules.flatMap(m => m.kps.map(k => ({ ...k, moduleId: m.id })));
  return `${proposedBanner()}
  <section class="card">
    <div class="legend">${Object.entries(MASTERY_LABEL).map(([k, v]) => `<span><i class="sw ms-${k}"></i>${v}</span>`).join('')}</div>
    <div class="table-wrap"><table class="heat">
      <thead>
        <tr><th></th>${store.modules.map(m => `<th colspan="${m.kps.length}">${esc(m.id)} ${esc(m.name)}</th>`).join('')}<th>Mastered</th></tr>
        <tr><th>Student</th>${kps.map(k => `<th title="${esc(k.name)}">${esc(k.id)}</th>`).join('')}<th></th></tr>
      </thead>
      <tbody>${store.students.map(s => {
        const sum = store.progressSummary(s);
        return `<tr><td>${esc(s.name)}</td>${kps.map(k => {
          const c = store.masteryCell(s, k.id);
          const active = drill && drill.studentId === s.id && drill.kpId === k.id;
          return `<td class="hm ms-${c.status} ${active ? 'sel' : ''}" data-drill="${s.id}|${k.id}" title="${esc(MASTERY_LABEL[c.status])}${c.cCount ? ` · C x${c.cCount}` : ''}">${c.cCount ? '<span class="cdot">C</span>' : ''}</td>`;
        }).join('')}<td>${sum.mastered}%</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    ${drill ? drillPanel() : '<p class="muted">Click a cell to see the evidence behind it.</p>'}
  </section>`;
}

function drillPanel() {
  const s = store.studentById(drill.studentId);
  const kp = store.kpIndex[drill.kpId];
  const c = store.masteryCell(s, drill.kpId);
  return `<div class="drill">
    <h3>${esc(s.name)} · ${esc(kp.id)} ${esc(kp.name)} → ${esc(MASTERY_LABEL[c.status])}</h3>
    <p class="muted">Rule: latest ${store.policy.mastery.window} valid items, min ${store.policy.mastery.minEvidence}. C and Blank excluded; W counts only on the primary knowledge point.</p>
    ${c.evidence.length ? `<table><thead><tr><th>Date</th><th>Test</th><th>Q</th><th>Mark</th><th>Counted</th></tr></thead><tbody>
      ${c.evidence.map(e => `<tr><td>${esc(e.markedAt)}</td><td>${esc(e.testId)} #${e.attempt}</td><td>${e.qNo}</td>
        <td class="oc oc-${e.outcome}">${e.outcome}</td><td>${e.counts ? (c.valid.includes(e) ? 'yes' : 'outside window') : esc(e.why)}</td></tr>`).join('')}
    </tbody></table>` : '<p>No evidence recorded.</p>'}
    <p class="placeholder">Tutor override (with reason, logged) - not built yet.</p>
  </div>`;
}

function stats() {
  const rows = store.examStats();
  return `${proposedBanner()}
  <section class="card"><div class="table-wrap"><table>
    <thead><tr><th>Student</th>${store.tests.map(t => `<th>${esc(t.name)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr><td>${esc(r.student.name)}</td>${store.tests.map(t => {
      const x = r.tests[t.id];
      return x ? `<td class="band band-${x.band}">${x.pct}%<span class="muted"> · ${x.attempts > 1 ? `attempt ${x.latest}` : '1st'}</span></td>` : '<td class="muted">-</td>';
    }).join('')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="muted">Bands: green ≥ ${store.policy.bands.green}% · amber ≥ ${store.policy.bands.amber}% · red below. Latest attempt shown.</p></section>`;
}

function records() {
  const mins = (a, b) => { const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return (h2 * 60 + m2) - (h1 * 60 + m1); };
  return `<section class="card">
    <p class="muted">Self-recorded by students after each exam (step 9C.5). First-pass and second-pass time are descriptive only.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Student</th><th>Date</th><th>Paper</th><th>First pass</th><th>Second pass</th><th>Checks</th><th>Score</th></tr></thead>
      <tbody>${store.examRecords.map(r => `<tr><td>${esc(store.studentById(r.studentId).name)}</td><td>${esc(r.date)}</td><td>${esc(r.paper)}</td>
        <td>${mins(r.start, r.end1)} min</td><td>${mins(r.end1, r.end2)} min</td><td>${r.checks}</td><td>${r.score}/${r.outOf}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
}

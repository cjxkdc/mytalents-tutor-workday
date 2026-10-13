// Step 4: pre-session briefing built only from recorded facts; step 5 conversation stays with the tutor.
import * as store from '../lib/store.js';
import { esc, chip, OUTCOME_LABEL } from '../lib/ui.js';

export function render(el, params) {
  const selected = params[0] || store.students[0].id;
  el.innerHTML = `
    <h1>Student briefings</h1>
    <p class="lede">Step 4 · facts from Exhibits 1-3, with source dates. Step 5 (talking with the student) is not automated.</p>
    <div class="split">
      <nav class="list">${store.students.map(s => `
        <a class="list-item ${s.id === selected ? 'active' : ''}" href="#/students/${s.id}">
          <strong>${esc(s.name)}</strong><span class="muted">Year ${s.year} · ${esc(s.currentModule)}</span>
        </a>`).join('')}
      </nav>
      <div>${card(selected)}</div>
    </div>`;
}

function card(id) {
  const b = store.briefing(id);
  const s = b.student;
  const mod = store.modules.find(m => m.id === s.currentModule);
  const summary = store.progressSummary(s);
  const sacDays = s.sac ? store.daysUntil(s.sac.date) : null;

  return `<section class="card">
    <h2>${esc(s.name)}</h2>
    <dl class="facts">
      <dt>Current module</dt><dd>${esc(mod.id)} ${esc(mod.name)} · Demo: ${chip(s.demo[mod.id] || 'unknown')}</dd>
      <dt>Current module test</dt><dd>${b.currentResult
        ? `${b.currentResult.pct}% (attempt ${b.currentResult.latest}) ${chip(b.currentResult.band, b.currentResult.band === 'green' ? 'good' : b.currentResult.band === 'amber' ? 'warn' : 'bad')}`
        : '<span class="muted">Not sat yet</span>'}</dd>
      <dt>Progress (Exhibit 2)</dt><dd>${summary.mastered}% mastered · ${summary.partial}% partial · ${summary.notUnderstood}% not understood</dd>
      <dt>Upcoming SAC</dt><dd>${s.sac
        ? `${esc(s.sac.title)} · ${esc(s.sac.date)} (${sacDays} days) ${b.sacGaps.length ? chip('Gap: ' + b.sacGaps.join(', ') + ' not completed', 'bad') : chip('Modules covered', 'good')}`
        : '<span class="muted">None recorded</span>'}</dd>
      <dt>Awaiting marking</dt><dd>${b.pendingSubs.length ? b.pendingSubs.map(p => `${esc(p.testId)} (${esc(p.status)})`).join(', ') : '<span class="muted">None</span>'}</dd>
      <dt>Open messages</dt><dd>${b.openMessages.length ? b.openMessages.map(m => `<a href="#/messages">${esc(m.text.slice(0, 40))}...</a>`).join('<br>') : '<span class="muted">None</span>'}</dd>
    </dl>

    <h3>Recent W / C / Blank</h3>
    ${b.recentErrors.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Test</th><th>Q</th><th>Mark</th><th>Knowledge point</th></tr></thead>
      <tbody>${b.recentErrors.map(r => {
        const question = store.testById(r.testId).questions.find(x => x.no === r.qNo);
        return `<tr><td>${esc(r.markedAt)}</td><td>${esc(r.testId)} #${r.attempt}</td><td>${r.qNo}</td>
          <td class="oc oc-${r.outcome}">${OUTCOME_LABEL[r.outcome]}</td>
          <td>${question.kps.map(k => esc(k + ' ' + store.kpIndex[k].name)).join(', ')}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="muted">No errors recorded.</p>'}

    <h3>Today's plan</h3>
    <p class="placeholder">AI plan suggestion - not connected yet. Tutor adjusts after talking with the student (step 5).</p>
  </section>`;
}

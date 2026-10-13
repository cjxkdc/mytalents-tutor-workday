// Step 8: submission queue + per-question marking console. One confirmation writes the long table,
// which updates Exhibits 1-3 together. AI suggestions are a placeholder until the vision step is wired in.
import * as store from '../lib/store.js';
import { esc, chip, banner, toast } from '../lib/ui.js';

const drafts = {}; // submissionId -> { qNo: outcome }
const OUTCOMES = ['DONE', 'W', 'C', 'BLANK'];

export function render(el, params) {
  const { submissions } = store.getState();
  const selectedId = params[0] || (submissions.find(s => s.status === 'queued') || {}).id;
  const selected = submissions.find(s => s.id === selectedId);

  el.innerHTML = `
    <h1>Marking</h1>
    <p class="lede">Step 8 · confirm each question once; Marking Sheet, Progress Sheet and Exam Statistics update together.</p>
    <div class="split">
      <nav class="list">${submissions.map(s => {
        const st = store.studentById(s.studentId);
        const tone = s.status === 'marked' ? 'good' : s.status === 'exception' ? 'bad' : 'neutral';
        return `<a class="list-item ${s.id === selectedId ? 'active' : ''}" href="#/marking/${s.id}">
          <strong>${esc(st.name)}</strong>
          <span class="muted">${esc(s.testId)} · attempt ${s.attempt}</span>
          ${chip(s.status, tone)}
        </a>`;
      }).join('')}</nav>
      <div>${selected ? consoleFor(selected) : '<p class="muted">Nothing selected.</p>'}</div>
    </div>`;

  if (!selected || selected.status !== 'queued') return;
  const draft = drafts[selected.id] || (drafts[selected.id] = {});
  el.querySelectorAll('[data-q]').forEach(btn => btn.addEventListener('click', () => {
    draft[btn.dataset.q] = btn.dataset.o;
    render(el, params);
  }));
  el.querySelector('#confirm')?.addEventListener('click', () => {
    store.confirmMarking(selected.id, draft);
    delete drafts[selected.id];
    toast('Confirmed - Exhibits 1-3 updated');
  });
}

function consoleFor(sub) {
  const st = store.studentById(sub.studentId);
  const test = store.testById(sub.testId);
  const meta = `<p class="muted">${esc(test.name)} ${esc(test.version)} · attempt ${sub.attempt} · submitted ${esc(sub.submittedAt)} via ${esc(sub.source)}</p>`;

  if (sub.status === 'exception') {
    return `<section class="card"><h2>${esc(st.name)}</h2>${meta}
      ${banner(`<strong>Exception:</strong> ${esc(sub.exception)}. Ask the student to re-upload; nothing is written to the sheets.`, 'bad')}</section>`;
  }
  if (sub.status === 'marked') {
    const r = store.attemptScore(sub.studentId, sub.testId, sub.attempt);
    return `<section class="card"><h2>${esc(st.name)}</h2>${meta}
      ${banner(`Marked · ${r.score}/${r.total} (${r.pct}%). View in <a href="#/exhibits/marking">Exhibits</a>.`, 'good')}</section>`;
  }

  const draft = drafts[sub.id] || {};
  const done = test.questions.every(q => draft[q.no]);
  return `<section class="card">
    <h2>${esc(st.name)}</h2>${meta}
    ${banner('Scan crops and AI suggestions are placeholders. The tutor sets every outcome; AI will only suggest match / no match / cannot tell.', 'info')}
    <div class="qgrid">${test.questions.map(q => `
      <div class="qrow">
        <div class="qhead"><strong>Q${q.no}</strong> <span class="muted">${q.marks} marks · ${q.kps.map(k => esc(k + ' ' + store.kpIndex[k].name)).join(', ')}</span></div>
        <div class="qbody">
          <div class="scan">Answer box scan</div>
          <div class="suggest">AI suggestion: <span class="muted">not connected</span></div>
          <div class="seg">${OUTCOMES.map(o => `<button class="seg-btn ${draft[q.no] === o ? 'on oc-' + o : ''}" data-q="${q.no}" data-o="${o}">${o === 'BLANK' ? 'Blank' : o}</button>`).join('')}</div>
        </div>
      </div>`).join('')}
    </div>
    <div class="actions">
      <button id="confirm" class="btn btn-primary" ${done ? '' : 'disabled'}>Confirm &amp; sync to Exhibits 1-3</button>
      <span class="muted">${Object.keys(draft).length}/${test.questions.length} set</span>
    </div>
  </section>`;
}

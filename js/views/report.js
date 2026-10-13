// Phase 5: facts are counted from records; follow-up names are nominated by rules and confirmed by the tutor;
// manager sign-off stays manual.
import * as store from '../lib/store.js';
import { esc, chip, banner, toast } from '../lib/ui.js';

export function render(el) {
  const r = store.dailyReport();
  const { qaLog, followUps } = store.getState();
  const candidates = store.followUpCandidates();

  el.innerHTML = `
    <h1>Daily report <span class="muted">${store.TODAY}</span></h1>
    <p class="lede">Phase 5 · 18:20-18:30</p>

    <section class="card">
      <h2>Facts (auto-counted)</h2>
      <table class="facts-table"><tbody>
        ${line('Students studying on site', r.onsite)}
        ${line('Students helped in Q&A (tutor-confirmed)', r.qaStudents)}
        ${line('Q&A questions (tutor-confirmed)', r.qaQuestions, `${r.qaRequests} requests submitted`)}
        ${line('Test papers marked today', r.testsMarked)}
        ${line('SAC / Practice SAC answers completed', r.sacCompleted, 'no Practice SAC records in mock data')}
        ${line('Parent feedback messages completed', r.parentFeedbackDone, 'counted only when marked sent')}
      </tbody></table>
      ${r.qaUnconfirmed ? banner(`${r.qaUnconfirmed} Q&A session(s) not yet confirmed - not counted.`, 'warn') : ''}
      <div class="qa-confirm">${qaLog.filter(q => !q.confirmed).map(q => `
        <div class="paste">${esc(store.studentById(q.studentId).name)}: ${q.requests} requests ·
          questions <input type="number" min="0" value="${q.questions}" data-qa="${q.studentId}" class="num">
          <button class="btn btn-sm" data-qa-confirm="${q.studentId}">Confirm</button></div>`).join('')}
      </div>
    </section>

    <section class="card">
      <h2>Priority follow-up <span class="muted">(rule-based nominations - tutor confirms)</span></h2>
      ${candidates.map(c => {
        const f = followUps[c.student.id] || {};
        return `<div class="nominee">
          <label><input type="checkbox" data-fu="${c.student.id}" ${f.confirmed ? 'checked' : ''}> <strong>${esc(c.student.name)}</strong></label>
          <ul>${c.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <input class="note" data-fu-note="${c.student.id}" placeholder="Tutor note (optional)" value="${esc(f.note || '')}">
        </div>`;
      }).join('') || '<p class="muted">No nominations.</p>'}
    </section>

    <section class="card">
      <h2>Manager sign-off</h2>
      <p>${chip('Manual', 'neutral')} Signed on the work sheet by the manager - not automated.</p>
      <button id="copy" class="btn">Copy report text</button>
    </section>
  `;

  el.querySelectorAll('[data-qa-confirm]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.qaConfirm;
    const n = Number(el.querySelector(`[data-qa="${id}"]`).value) || 0;
    store.confirmQa(id, n);
  }));
  el.querySelectorAll('[data-fu]').forEach(cb => cb.addEventListener('change', () => {
    const note = el.querySelector(`[data-fu-note="${cb.dataset.fu}"]`).value;
    store.setFollowUp(cb.dataset.fu, cb.checked, note);
  }));
  el.querySelectorAll('[data-fu-note]').forEach(inp => inp.addEventListener('change', () => {
    const cb = el.querySelector(`[data-fu="${inp.dataset.fuNote}"]`);
    store.setFollowUp(inp.dataset.fuNote, cb.checked, inp.value);
  }));
  el.querySelector('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(asText(store.dailyReport())); toast('Report copied'); }
    catch { toast('Copy failed - select the text manually'); }
  });
}

const line = (label, value, note = '') => `<tr><td>${esc(label)}</td><td class="num-cell">${value}</td><td class="muted">${esc(note)}</td></tr>`;

function asText(r) {
  return [
    `Daily report ${store.TODAY}`,
    `Students on site: ${r.onsite}`,
    `Q&A: ${r.qaStudents} students, ~${r.qaQuestions} questions`,
    `Test papers marked: ${r.testsMarked}`,
    `SAC / Practice SAC completed: ${r.sacCompleted}`,
    `Parent feedback completed: ${r.parentFeedbackDone}`,
    `Priority follow-up: ${r.followUps.map(f => f.student.name + (f.note ? ` (${f.note})` : '')).join('; ') || 'none'}`,
  ].join('\n');
}

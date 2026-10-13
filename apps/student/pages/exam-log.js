// Scenario C step 5: students record their own exam data. Owner A.
import { esc, banner, errorBanner, requestGate } from '../../../packages/ui/components/html.js';

const FIELDS = [
  ['date', 'Exam date', 'date'], ['paper', 'Module or VCAA paper', 'text'],
  ['start', 'Start time', 'time'], ['endFirst', 'End of first attempt', 'time'], ['endSecond', 'End of second attempt', 'time'],
  ['checks', 'Number of checks', 'number'], ['score', 'Final score', 'number'], ['outOf', 'Out of', 'number'],
];
const ERR = { 'times-order': 'endFirst' };

export function render(el, params, ctx) {
  const form = {};
  let invalid = [];
  let msg = '';
  el.innerHTML = `
    <div class="page-head"><h1>Exam log</h1><p class="lede">Record every exam so you and your tutor can see changes in speed and accuracy over time.</p></div>
    <section class="card"><div class="card-body" id="form"></div></section>
    <section class="card"><div class="card-head"><h2>My records</h2></div><div class="card-body" id="list"></div></section>`;
  const formEl = el.querySelector('#form');
  const list = el.querySelector('#list');

  function paintForm() {
    formEl.innerHTML = `${msg}<div class="form-grid">${FIELDS.map(([k, label, type]) => `
      <label class="field">${label}<input type="${type}" data-k="${k}" value="${esc(form[k] ?? '')}" class="${invalid.includes(k) ? 'invalid' : ''}"
        ${type === 'number' ? 'min="0" step="1"' : ''}></label>`).join('')}</div>
      ${invalid.includes('endFirst') ? '<p class="err">Times must be in order: start, then first attempt, then second attempt.</p>' : ''}
      <div class="actions"><button class="btn btn-primary" id="save">Save record</button></div>`;
    formEl.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', () => {
      form[i.dataset.k] = i.value; invalid = invalid.filter(x => x !== i.dataset.k); i.classList.remove('invalid');
    }));
    formEl.querySelector('#save').addEventListener('click', save);
  }

  async function save() {
    try {
      await ctx.api.addExamRecord({ ...form, checks: parseInt(form.checks, 10), score: Number(form.score), outOf: Number(form.outOf) });
      Object.keys(form).forEach(k => delete form[k]); invalid = []; msg = banner('Saved.', 'good');
    } catch (e) {
      invalid = (e.details || []).map(x => ERR[x] || x);
      msg = errorBanner(e);
    }
    if (!ctx.signal.aborted) paintForm();
  }

  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    try {
      const rows = await ctx.api.listMyExamRecords();
      if (!current()) return;
      const mins = (a, b) => { const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return h2 * 60 + m2 - (h1 * 60 + m1); };
      list.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Paper</th><th>First pass</th><th>Second pass</th><th>Checks</th><th>Score</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.paper)}</td><td>${mins(r.start, r.endFirst)} min</td><td>${mins(r.endFirst, r.endSecond)} min</td>
          <td>${r.checks}</td><td>${r.score}/${r.outOf}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No records yet.</p>';
    } catch (e) { if (current()) list.innerHTML = errorBanner(e); }
  }
  paintForm(); load(); ctx.subscribe(load);
}

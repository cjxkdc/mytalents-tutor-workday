// Mistake bank: W and C questions from marked tests, with corrections. Owner A.
import { esc, chip, errorBanner, requestGate } from '../../../packages/ui/components/html.js';
import { correctionChip } from '../../../packages/ui/components/records.js';

export function render(el, params, ctx) {
  let filter = params[0] === 'C' ? 'C' : params[0] === 'all' ? 'all' : 'W';
  const notes = {};
  const errs = {};
  let rows = [];

  el.innerHTML = `
    <div class="page-head"><h1>Mistake bank</h1>
      <p class="lede">W = wrong answer (possible knowledge gap). C = careless error. Correct each one, then your tutor confirms it.</p></div>
    <nav class="sub-tabs" id="filters"></nav>
    <section class="card"><div class="card-body" id="body"><div class="loading">Loading…</div></div></section>`;
  const body = el.querySelector('#body');
  const filters = el.querySelector('#filters');

  function paint() {
    const count = t => rows.filter(r => (t === 'all' || r.type === t) && r.correction.status !== 'confirmed').length;
    filters.innerHTML = [['W', 'Wrong (W)'], ['C', 'Careless (C)'], ['all', 'All']]
      .map(([id, label]) => `<a href="#/mistakes/${id}" class="${id === filter ? 'active' : ''}">${label} · ${count(id)} open</a>`).join('');
    const shown = rows.filter(r => filter === 'all' || r.type === filter);
    if (!shown.length) { body.innerHTML = '<p class="empty">Nothing here yet.</p>'; return; }
    body.innerHTML = shown.map(m => {
      const st = m.correction.status;
      const canSubmit = st === 'open' || st === 'needs-work';
      return `<div class="mistake">
        <div class="mistake-head"><strong>${esc(m.testName)} · Q${m.qNo}</strong>
          ${chip(m.type === 'C' ? 'Careless (C)' : 'Wrong (W)', m.type === 'C' ? 'warn' : 'bad')} ${correctionChip(st)}
          <span class="muted">attempt ${m.attempt} · ${esc(m.markedAt)} · ${m.marks} marks</span></div>
        <div class="muted">${m.kps.map(k => esc(`${k.id} ${k.name}`)).join(' · ')}</div>
        ${m.correction.note ? `<p style="white-space:pre-wrap"><b>Your correction:</b> ${esc(m.correction.note)}</p>` : ''}
        ${m.correction.tutorNote ? `<p><b>Tutor:</b> ${esc(m.correction.tutorNote)}</p>` : ''}
        ${canSubmit ? `<label class="sr-only" for="n-${esc(m.id)}">Correction for ${esc(m.testName)} Q${m.qNo}</label>
          <textarea id="n-${esc(m.id)}" rows="2" data-note="${esc(m.id)}" placeholder="What went wrong, and the corrected working">${esc(notes[m.id] || '')}</textarea>
          <div class="actions"><button class="btn btn-sm btn-primary" data-submit="${esc(m.id)}">Submit correction</button>
          <span class="err">${esc(errs[m.id] || '')}</span></div>` : ''}
      </div>`;
    }).join('');
    body.querySelectorAll('[data-note]').forEach(t => t.addEventListener('input', () => { notes[t.dataset.note] = t.value; }));
    body.querySelectorAll('[data-submit]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.submit;
      try {
        await ctx.api.submitCorrection(id, notes[id] || '', rows.find(r => r.id === id)?.resultVersion);
        delete notes[id]; delete errs[id];
        if (!ctx.signal.aborted) ctx.toast('Sent to your tutor');
      } catch (e) { if (!ctx.signal.aborted) { errs[id] = e.message; paint(); } }
    }));
  }

  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    try {
      const r = await ctx.api.getMyMistakes();
      if (!current()) return;
      rows = r; paint();
    } catch (e) { if (current()) body.innerHTML = errorBanner(e); }
  }
  load();
  ctx.subscribe(load);
}

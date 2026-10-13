// Tutor reviews corrections that students submitted from their mistake bank. Owner A.
import { esc, chip, errorBanner, fmtDateTime, requestGate } from '../../../packages/ui/components/html.js';
import { correctionChip } from '../../../packages/ui/components/records.js';

export function render(el, params, ctx) {
  el.innerHTML = `
    <div class="page-head"><h1>Corrections</h1>
      <p class="lede">Scenario C step 3 · students correct their W / C questions; the tutor confirms or returns them.</p></div>
    <div id="body"><div class="loading">Loading…</div></div>`;
  const body = el.querySelector('#body');
  const notes = {};
  const versions = {}; // correction version the tutor is looking at

  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    try {
      const rows = await ctx.api.listCorrections();
      if (!current()) return;
      rows.forEach(c => { versions[c.id] = c.version; });
      if (!rows.length) { body.innerHTML = '<section class="card"><p class="empty">No corrections submitted yet.</p></section>'; return; }
      body.innerHTML = rows.map(c => `<section class="card"><div class="card-body">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <strong>${esc(c.studentName)}</strong><span class="muted">${esc(c.testName)} · Q${c.qNo}</span>
          ${chip(c.type === 'C' ? 'Careless (C)' : 'Wrong (W)', c.type === 'C' ? 'warn' : 'bad')} ${correctionChip(c.status)}
          <span class="muted">${esc(fmtDateTime(c.submittedAt))}</span></div>
        <p style="white-space:pre-wrap">${esc(c.note)}</p>
        ${c.tutorNote ? `<p class="muted">Tutor note: ${esc(c.tutorNote)}</p>` : ''}
        ${c.status === 'submitted' ? `<label class="field">Note to student (required when returning)<input data-note="${esc(c.id)}" value="${esc(notes[c.id] || '')}"></label>
          <div class="actions"><button class="btn btn-primary" data-accept="${esc(c.id)}">Confirm correction</button>
          <button class="btn" data-return="${esc(c.id)}">Needs more work</button><span class="err" data-err="${esc(c.id)}"></span></div>` : ''}
      </div></section>`).join('');
      body.querySelectorAll('[data-note]').forEach(i => i.addEventListener('input', () => { notes[i.dataset.note] = i.value; }));
      body.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => review(b.dataset.accept, true)));
      body.querySelectorAll('[data-return]').forEach(b => b.addEventListener('click', () => review(b.dataset.return, false)));
    } catch (e) { if (current()) body.innerHTML = errorBanner(e); }
  }

  async function review(id, accept) {
    try {
      await ctx.api.reviewCorrection(id, { accept, note: notes[id] || '', version: versions[id] });
      delete notes[id];
      if (!ctx.signal.aborted) ctx.toast(accept ? 'Correction confirmed' : 'Returned to student');
    } catch (e) {
      if (ctx.signal.aborted) return;
      const slot = [...body.querySelectorAll('[data-err]')].find(x => x.dataset.err === id);
      if (slot) slot.textContent = e.message;
    }
  }

  load();
  ctx.subscribe(load);
}

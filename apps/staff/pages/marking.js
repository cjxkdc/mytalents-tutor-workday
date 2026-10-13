// Brief step 8: submission queue + per-question marking console. Owner A.
// One confirmation writes QuestionResults; Exhibits 1-3 and the mistake bank are derived from them.
import { esc, chip, banner, errorBanner, fmtDateTime, requestGate } from '../../../packages/ui/components/html.js';
import { OUTCOME_LABEL } from '../../../packages/ui/components/records.js';

const OUTCOMES = ['DONE', 'W', 'C', 'BLANK'];
const drafts = new Map(); // submissionId -> { attempt, reason, items: { qNo: { outcome, score } } }
const STATUS_TONE = { queued: '', marked: 'good', exception: 'bad' };

export function render(el, params, ctx) {
  let list = [];
  let detail = null;
  let urls = [];
  let fieldErrors = {};
  let topError = null;
  const selectedId = () => params[0] || list.find(s => s.status === 'queued')?.id || list[0]?.id;

  el.innerHTML = `
    <div class="page-head"><h1>Marking</h1>
      <p class="lede">Step 8 · confirm every question once; the three record sheets and the mistake bank update together.</p></div>
    <div class="split"><nav class="list" id="queue" aria-label="Submissions"></nav><div id="console"><div class="loading">Loading…</div></div></div>`;
  const queueEl = el.querySelector('#queue');
  const consoleEl = el.querySelector('#console');

  const revoke = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };

  function paintQueue() {
    const id = selectedId();
    const groups = [['queued', 'To mark'], ['exception', 'Exceptions'], ['marked', 'Marked']];
    queueEl.innerHTML = groups.map(([st, label]) => {
      const items = list.filter(s => s.status === st);
      if (!items.length) return '';
      return `<h3>${label} (${items.length})</h3>${items.map(s => `
        <a class="list-item${s.id === id ? ' active' : ''}" href="#/marking/${encodeURIComponent(s.id)}">
          <strong>${esc(s.studentName)}</strong><span class="muted">${esc(s.testName)} · ${s.status === 'marked' ? 'attempt ' + s.attempt : 'suggested attempt ' + (s.suggestedAttempt ?? '?')}</span>
          <span>${chip(s.status, STATUS_TONE[s.status])} <span class="muted">${esc(fmtDateTime(s.submittedAt))}</span></span></a>`).join('')}`;
    }).join('') || '<p class="empty">No submissions.</p>';
  }

  function draftFor(d) {
    if (!drafts.has(d.submission.id)) drafts.set(d.submission.id, { attempt: d.submission.suggestedAttempt || d.nextAttempt, reason: '', items: {} });
    return drafts.get(d.submission.id);
  }

  function scansHtml(d) {
    revoke();
    if (!d.pages.length) return `<div class="scan-missing">No scan attached${d.submission.source === 'seed' ? ' (seeded demo record)' : ''}.</div>`;
    return d.pages.map(p => {
      if (!p.type.startsWith('image/')) return `<div class="scan-missing">${esc(p.name)} (${esc(p.type)}) - open in a viewer</div>`;
      const u = URL.createObjectURL(p.blob); urls.push(u);
      return `<figure style="margin:0"><img src="${u}" alt="Page ${p.index + 1} of ${esc(d.student.name)}'s ${esc(d.test.name)}"><figcaption class="muted">Page ${p.index + 1}</figcaption></figure>`;
    }).join('');
  }

  function paintConsole() {
    const d = detail;
    if (!d) { consoleEl.innerHTML = '<p class="empty">Nothing selected.</p>'; return; }
    const s = d.submission;
    const head = `<h2>${esc(d.student.name)} · ${esc(d.test.name)} <span class="muted">${esc(d.test.version)}</span></h2>
      <p class="muted">Submitted ${esc(fmtDateTime(s.submittedAt))} via ${esc(s.source)} · ${s.pageCount} page(s)
      · ${s.check === 'not-checked' ? chip('QR / clarity not checked - verify manually', 'warn') : chip(s.check)}</p>`;

    if (s.status === 'exception') {
      consoleEl.innerHTML = `<section class="card"><div class="card-body">${head}
        ${banner(`<strong>Exception:</strong> ${esc(s.exception)}. Ask the student to upload again. Nothing was written to the records.`, 'bad')}</div></section>`;
      return;
    }
    if (s.status === 'marked') {
      consoleEl.innerHTML = `<section class="card"><div class="card-body">${head}
        ${banner(`Marked by ${esc(s.markedBy)} on ${esc(s.markedAt)} as attempt ${s.attempt}. See <a href="#/records/marking">Records</a>.`, 'good')}</div></section>`;
      return;
    }

    const dr = draftFor(d);
    const replacing = d.existingAttempts.includes(dr.attempt);
    const done = d.test.questions.filter(q => dr.items[q.no]?.outcome).length;

    consoleEl.innerHTML = `<section class="card"><div class="card-body">${head}
      ${topError ? errorBanner(topError) : ''}
      <div class="console">
        <div class="scans">${scansHtml(d)}</div>
        <div>
          <div class="attempt-box">
            <label class="field">Attempt<input type="number" min="1" step="1" id="attempt" value="${dr.attempt}"></label>
            <div class="muted">Student suggested ${s.suggestedAttempt ?? '-'} · recorded attempts: ${d.existingAttempts.join(', ') || 'none'} · next new attempt: ${d.nextAttempt}</div>
          </div>
          ${replacing ? `${banner(`Attempt ${dr.attempt} already has results. Confirming will <strong>replace</strong> them, and the change is logged.`, 'warn')}
            <label class="field">Reason for replacing<textarea id="reason" rows="2">${esc(dr.reason)}</textarea></label>` : ''}
          ${banner('AI suggestions are not connected yet. The tutor sets every outcome and score.', 'info')}
          ${d.test.questions.map(q => {
            const it = dr.items[q.no] || {};
            const err = fieldErrors[q.no];
            return `<div class="qrow${err ? ' has-err' : ''}">
              <div class="qhead"><strong>Q${q.no}</strong><span class="muted">${q.marks} marks · ${q.kps.map(esc).join(', ')}</span></div>
              <div class="qctl">
                <div class="seg" role="group" aria-label="Q${q.no} outcome">${OUTCOMES.map(o =>
                  `<button type="button" data-q="${q.no}" data-o="${o}" class="${it.outcome === o ? 'oc-' + o : ''}" aria-pressed="${it.outcome === o}">${OUTCOME_LABEL[o]}</button>`).join('')}</div>
                <label>Score <input class="inline" type="number" min="0" max="${q.marks}" step="0.5" data-score="${q.no}"
                  value="${it.score ?? ''}" ${it.outcome === 'BLANK' ? 'disabled' : ''} aria-label="Q${q.no} score"> / ${q.marks}</label>
                <span class="muted">AI: not connected</span>
              </div>
              ${err ? `<div class="err">${esc(err)}</div>` : ''}
            </div>`;
          }).join('')}
          <div class="actions">
            <button class="btn btn-primary" id="confirm">Confirm & update records</button>
            <button class="btn" id="exception">Mark as exception</button>
            <span class="muted">${done}/${d.test.questions.length} set</span>
          </div>
        </div>
      </div></div></section>`;

    consoleEl.querySelector('#attempt').addEventListener('change', e => { dr.attempt = parseInt(e.target.value, 10); topError = null; paintConsole(); });
    consoleEl.querySelector('#reason')?.addEventListener('input', e => { dr.reason = e.target.value; });
    consoleEl.querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => {
      const q = d.test.questions.find(x => x.no === +b.dataset.q);
      const o = b.dataset.o;
      dr.items[q.no] = { outcome: o, score: o === 'DONE' ? q.marks : 0 };
      delete fieldErrors[q.no];
      paintConsole();
    }));
    consoleEl.querySelectorAll('[data-score]').forEach(inp => inp.addEventListener('input', () => {
      const qn = +inp.dataset.score;
      dr.items[qn] = { ...(dr.items[qn] || {}), score: inp.value === '' ? undefined : Number(inp.value) };
    }));
    consoleEl.querySelector('#confirm').addEventListener('click', confirm);
    consoleEl.querySelector('#exception').addEventListener('click', markException);
  }

  async function confirm() {
    const d = detail;
    const dr = draftFor(d);
    fieldErrors = {}; topError = null;
    try {
      const items = d.test.questions.map(q => ({ qNo: q.no, outcome: dr.items[q.no]?.outcome, score: dr.items[q.no]?.score }));
      const r = await ctx.api.confirmMarking(d.submission.id, { attempt: dr.attempt, items, reason: dr.reason });
      drafts.delete(d.submission.id);
      if (!ctx.signal.aborted) ctx.toast(`Saved · ${r.score}/${r.total} (${r.pct}%) · records updated`);
    } catch (e) {
      if (ctx.signal.aborted) return;
      if (e.code === 'VALIDATION' && Array.isArray(e.details)) e.details.forEach(x => { fieldErrors[x.qNo] = x.message; });
      topError = e;
      paintConsole();
    }
  }

  async function markException() {
    const reason = prompt('Why can this submission not be marked? (shown to staff)');
    if (!reason) return;
    try { await ctx.api.markException(detail.submission.id, reason); if (!ctx.signal.aborted) ctx.toast('Marked as exception'); }
    catch (e) { if (!ctx.signal.aborted) { topError = e; paintConsole(); } }
  }

  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    try {
      const l = await ctx.api.listSubmissions();
      if (!current()) return;
      list = l; paintQueue();
      const id = selectedId();
      const d = id ? await ctx.api.getSubmission(id) : null;
      if (!current()) return;
      detail = d; paintConsole();
    } catch (e) { if (current()) consoleEl.innerHTML = errorBanner(e); }
  }

  load();
  ctx.subscribe(load);
  return revoke;
}

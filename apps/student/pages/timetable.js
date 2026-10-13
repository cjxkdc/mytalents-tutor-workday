// Student timetable: this week's lessons and change requests (leave, online, move). The tutor decides. Owner A.
import { esc, icon, errorBanner, fmtDateTime, requestGate } from '../../../packages/ui/components/html.js';
import { KIND_LABEL, statusChip, attendanceChip, changeSummary, lessonChips, canChange, keyOf, quote } from '../../../packages/ui/components/lessons.js';
import { label, addDays } from '../../../packages/contract/timetable.js';

export function render(el, params, ctx) {
  const root = document.createElement('div');
  el.replaceChildren(root);
  let data = null;
  let from = null;          // Monday of the week shown; null = this week
  let open = null;          // lesson key whose request form is open
  const form = {};
  const errs = {};
  let busy = false;
  const val = (k, f, d = '') => form[k]?.[f] ?? d;

  function paint() {
    if (!data) { root.innerHTML = '<div class="loading">Loading…</div>'; return; }
    const days = data.days.filter(d => d.lessons.length);
    root.innerHTML = `
      <div class="page-head"><h1>Timetable</h1>
        <p class="lede">Your lessons. Need to miss one, join online or move it? Send a request - your tutor decides.</p></div>
      <section class="card"><div class="card-body">
        <div class="tt-toolbar">
          <button class="btn btn-sm" data-week="-7" aria-label="Previous week">${icon('chevron-left')}</button>
          <strong>${esc(label(data.from))} - ${esc(label(addDays(data.from, 6)))}</strong>
          <button class="btn btn-sm" data-week="7" aria-label="Next week">${icon('chevron-right')}</button>
          <button class="btn btn-sm" data-this>This week</button>
        </div>
        ${days.length ? days.map(d => `<h3 class="tt-day">${esc(label(d.date))}${d.date === data.today ? ' · today' : ''}</h3>
          ${d.lessons.map(lessonCard).join('')}`).join('') : '<p class="empty">No lessons this week.</p>'}
      </div></section>
      <section class="card"><div class="card-head"><h2>My requests</h2></div><div class="card-body">
        ${data.requests.length ? data.requests.map(c => `<div class="req">
          <div>${statusChip(c.status)} ${esc(changeSummary(c))}</div>
          ${quote(c.reason)}
          <div class="muted">Sent ${esc(fmtDateTime(c.requestedAt))}${c.decidedBy ? ` · ${esc(c.status)} by ${esc(c.decidedBy)}` : ''}</div>
          ${c.decisionNote ? `<div>Tutor: ${esc(c.decisionNote)}</div>` : ''}
          ${c.status === 'revoked' ? `<div class="muted">Change undone: ${esc(c.revokeReason)}</div>` : ''}
          ${c.status === 'pending' ? `<div class="actions"><button class="btn btn-sm" data-withdraw="${esc(c.id)}">Withdraw</button>
            <span class="err">${esc(errs['w:' + c.id] || '')}</span></div>` : ''}
        </div>`).join('') : '<p class="empty">No requests yet.</p>'}
      </div></section>`;
  }

  function lessonCard(o) {
    const k = keyOf(o);
    return `<div class="lesson${o.state !== 'scheduled' ? ' is-off' : ''}">
      <div class="lesson-time">${esc(o.start)}-${esc(o.end)}</div>
      <div><strong>Maths tutoring</strong> <span class="muted">· ${o.mode === 'online' ? 'Online' : esc(o.room)} · ${esc(o.teacher)}</span></div>
      <div class="lesson-tags">${lessonChips(o)} ${attendanceChip(o.attendance)}</div>
      ${canChange(o, data.today) ? `<div class="lesson-actions"><button class="btn btn-sm" data-open="${esc(k)}">Request a change</button></div>` : ''}
      ${open === k ? requestForm(o) : ''}
    </div>`;
  }

  function requestForm(o) {
    const k = keyOf(o);
    const kind = val(k, 'kind', 'leave');
    const radio = (v, t) => `<label class="tt-radio"><input type="radio" name="kind-${esc(k)}" data-f="kind" value="${v}"${kind === v ? ' checked' : ''}> ${t}</label>`;
    return `<form class="tt-form" data-form="${esc(k)}">
      <fieldset class="field"><legend>What do you need?</legend>
        ${radio('leave', 'I can\'t come (leave)')}
        ${o.mode === 'onsite' ? radio('online', 'Join online instead') : ''}
        ${radio('reschedule', 'Move to another time')}</fieldset>
      ${kind === 'reschedule' ? `<div class="tt-row">
        <label class="field">Date<input type="date" data-f="date" value="${esc(val(k, 'date', o.date))}"></label>
        <label class="field">Start<input type="time" data-f="start" value="${esc(val(k, 'start', o.start))}"></label>
        <label class="field">End<input type="time" data-f="end" value="${esc(val(k, 'end', o.end))}"></label></div>
        <p class="muted">Lessons run on weekdays, ${esc(data.rules.shiftStart)}-${esc(data.rules.shiftEnd)}.</p>` : ''}
      <label class="field">Reason<textarea rows="2" data-f="reason" placeholder="e.g. School excursion / 学校有活动">${esc(val(k, 'reason'))}</textarea></label>
      <div class="actions"><button class="btn btn-primary btn-sm" type="submit" ${busy ? 'disabled' : ''}>Send request</button>
        <button class="btn btn-sm" type="button" data-close>Cancel</button><span class="err">${esc(errs[k] || '')}</span></div>
    </form>`;
  }

  root.addEventListener('input', e => {
    const t = e.target, f = t.closest('[data-form]');
    if (f && t.dataset.f) (form[f.dataset.form] ||= {})[t.dataset.f] = t.value;
  });
  root.addEventListener('change', e => {
    const t = e.target, f = t.closest('[data-form]');
    if (f && t.dataset.f) { (form[f.dataset.form] ||= {})[t.dataset.f] = t.value; if (t.type === 'radio') paint(); }
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.week) { from = addDays(data.from, +b.dataset.week); open = null; load(); return; }
    if ('this' in b.dataset) { from = null; open = null; load(); return; }
    if (b.dataset.open) { open = open === b.dataset.open ? null : b.dataset.open; paint(); return; }
    if ('close' in b.dataset) { open = null; paint(); return; }
    if (b.dataset.withdraw) return withdraw(b.dataset.withdraw);
  });
  root.addEventListener('submit', e => { e.preventDefault(); send(e.target.dataset.form); });

  async function run(k, fn, ok) {
    if (busy) return;
    busy = true; errs[k] = '';
    try {
      await fn();
      if (ctx.signal.aborted) return;
      delete form[k]; open = null;
      ctx.toast(ok);
    } catch (e) {
      if (!ctx.signal.aborted) errs[k] = e.message;
    } finally {
      busy = false;
      if (!ctx.signal.aborted) paint();
    }
  }

  function send(k) {
    const o = data.days.flatMap(d => d.lessons).find(x => keyOf(x) === k);
    if (!o) return;
    const kind = val(k, 'kind', 'leave');
    const to = kind === 'reschedule' ? { date: val(k, 'date', o.date), start: val(k, 'start', o.start), end: val(k, 'end', o.end) } : undefined;
    return run(k, () => ctx.api.requestLessonChange({ occId: o.id, kind, to, reason: val(k, 'reason') }),
      `Request sent: ${KIND_LABEL[kind]}. Your tutor will decide.`);
  }

  function withdraw(id) {
    const c = data.requests.find(x => x.id === id);
    if (c) run('w:' + id, () => ctx.api.withdrawLessonChange(id, c.version), 'Request withdrawn');
  }

  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    try {
      const d = await ctx.api.getMyTimetable(from ? { from, to: addDays(from, 6) } : {});
      if (!current()) return;
      data = d; paint();
    } catch (e) { if (current()) root.innerHTML = errorBanner(e); }
  }
  paint(); load(); ctx.subscribe(load);
}

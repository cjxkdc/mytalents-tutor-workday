// Staff timetable: the digital whiteboard for brief step 2 (attendance, leave, online, reschedules). Owner A.
// Lessons only. Students request changes; the tutor decides or changes directly, then copies the notice into WeCom.
import { esc, chip, icon, errorBanner, banner, fmtDateTime, requestGate } from '../../../packages/ui/components/html.js';
import { KIND_LABEL, ATT_LABEL, statusChip, changeSummary, lessonChips, canChange, keyOf, slot, quote } from '../../../packages/ui/components/lessons.js';
import { label, addDays, mondayOf } from '../../../packages/contract/timetable.js';

const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export function render(el, params, ctx) {
  const root = document.createElement('div');
  el.replaceChildren(root);
  let data = null;
  let selected = isIso(params[0]) ? params[0] : null;
  let view = 'day';
  let open = null;          // which inline form is open: lesson key, 'extra' or 'revoke:<changeId>'
  const form = {};          // unsaved input per form key, kept across repaints
  const notes = {};         // decline / approve notes per request id
  const errs = {};          // inline errors per form key
  let busy = false;

  const val = (k, f, d = '') => form[k]?.[f] ?? d;

  function paint() {
    if (!data) { root.innerHTML = '<div class="loading">Loading…</div>'; return; }
    const today = data.today;
    const days = data.days.filter(d => d.weekday <= 5 || d.lessons.length);
    const day = data.days.find(d => d.date === selected) || days[0];
    root.innerHTML = `
      <div class="page-head"><h1>Timetable</h1>
        <p class="lede">Step 2 · lessons only. Students request changes and the tutor decides. Every approved change gives a notice to copy into WeCom (nothing is sent automatically).</p></div>
      ${requestsCard(today)}
      <section class="card"><div class="card-body">
        <div class="tt-toolbar">
          <button class="btn btn-sm" data-week="-7" aria-label="Previous week">${icon('chevron-left')}</button>
          <strong>${esc(label(data.from))} - ${esc(label(addDays(data.from, 4)))}</strong>
          <button class="btn btn-sm" data-week="7" aria-label="Next week">${icon('chevron-right')}</button>
          <button class="btn btn-sm" data-today>Today</button>
          <div class="seg" role="group" aria-label="View">
            <button type="button" data-view="day" aria-pressed="${view === 'day'}">Day</button>
            <button type="button" data-view="week" aria-pressed="${view === 'week'}">Week</button></div>
          <span class="tt-spacer"></span>
          <button class="btn btn-sm btn-primary" data-open="extra">${icon('plus')} Extra lesson</button>
        </div>
        ${open === 'extra' ? extraForm() : ''}
        ${view === 'day' ? dayView(days, day, today) : weekView(days, today)}
      </div></section>
      ${recentCard()}`;
  }

  // ---------- pending requests ----------
  function requestsCard() {
    if (!data.pending.length) return '';
    return `<section class="card"><div class="card-head"><h2>Change requests (${data.pending.length})</h2></div><div class="card-body">
      ${data.pending.map(c => `<div class="req">
        <div><strong>${esc(c.studentName)}</strong> · ${esc(changeSummary(c))}
          ${c.lesson ? `<span class="muted">· ${esc(c.lesson.room)}, ${esc(c.lesson.teacher)}</span>` : ''}</div>
        ${quote(c.reason)}
        <div class="muted">Requested by ${esc(c.requestedBy)} · ${esc(fmtDateTime(c.requestedAt))}</div>
        ${c.problems.length ? banner(`<strong>Cannot approve as it stands:</strong> ${esc(c.problems.join('; '))}. Decline with a note or change the lesson yourself.`, 'warn') : ''}
        <div class="actions">
          <input class="inline" data-note="${esc(c.id)}" placeholder="Note to the student (required to decline)" value="${esc(notes[c.id] || '')}">
          <button class="btn btn-primary btn-sm" data-approve="${esc(c.id)}" ${c.problems.length ? 'disabled' : ''}>Approve</button>
          <button class="btn btn-sm" data-decline="${esc(c.id)}">Decline</button>
          <span class="err">${esc(errs['req:' + c.id] || '')}</span></div>
      </div>`).join('')}</div></section>`;
  }

  // ---------- day board ----------
  function dayView(days, day, today) {
    const s = day.summary;
    const columns = [...data.rooms, 'Online'];
    const strip = `<div class="week" role="tablist" aria-label="Days">${days.map(d => `
      <button type="button" role="tab" data-day="${d.date}" class="${d.date === day.date ? 'sel' : ''}" aria-selected="${d.date === day.date}">
        ${esc(label(d.date).split(' ').slice(1).join(' '))}<small>${esc(label(d.date).split(' ')[0])}${d.date === today ? ' · today' : ''} · ${d.summary.lessons}</small></button>`).join('')}</div>`;
    const counts = `<div class="tt-counts">
      ${chip(`${s.lessons} lessons`, 'info')} ${chip(`${s.onsite} on-site`)} ${chip(`${s.online} online`)}
      ${day.date <= today ? `${chip(`${s.present} present`, 'good')} ${chip(`${s.late} late`, 'warn')} ${chip(`${s.absent} absent`, 'bad')} ${chip(`${s.unmarked} not marked`)}` : '<span class="muted">Attendance opens on the day.</span>'}
      ${s.cancelled ? chip(`${s.cancelled} on leave`, 'warn') : ''}</div>`;
    const board = `<div class="tt-board">${columns.map(room => {
      const items = day.lessons.filter(o => o.room === room);
      return `<div class="tt-col"><h3>${esc(room)} <span class="muted">${items.filter(o => o.state === 'scheduled').length}</span></h3>
        ${items.length ? items.map(o => lessonCard(o, today)).join('') : '<p class="empty">No lessons</p>'}</div>`;
    }).join('')}</div>`;
    return strip + counts + board;
  }

  function lessonCard(o, today) {
    const k = keyOf(o);
    const off = o.state !== 'scheduled';
    const canMark = !off && o.date <= today;
    const att = o.attendance?.status || null;
    const revoke = o.change && o.change.status === 'approved' && !o.attendance;
    return `<div class="lesson${off ? ' is-off' : ''}">
      <div class="lesson-time">${esc(o.start)}-${esc(o.end)}</div>
      <div><strong>${esc(o.studentName)}</strong> <span class="muted">· ${esc(o.teacher)}</span></div>
      <div class="lesson-tags">${lessonChips(o)}</div>
      ${canMark ? `<div class="seg att" role="group" aria-label="Attendance for ${esc(o.studentName)}">${Object.entries(ATT_LABEL).map(([v, t]) =>
        `<button type="button" class="att-${v}" data-att="${esc(k)}" data-v="${v}" aria-pressed="${att === v}">${t}</button>`).join('')}</div>` : ''}
      <div class="lesson-actions">
        ${canChange(o, today) ? `<button class="btn btn-sm" data-open="${esc(k)}">Change…</button>` : ''}
        ${revoke ? `<button class="btn btn-sm" data-open="revoke:${esc(o.change.id)}">Undo change</button>` : ''}
      </div>
      ${open === k ? changeForm(o) : ''}
      ${revoke && open === 'revoke:' + o.change.id ? revokeForm(o.change) : ''}
    </div>`;
  }

  function changeForm(o) {
    const k = keyOf(o);
    const kind = val(k, 'kind', 'leave');
    return `<form class="tt-form" data-form="${esc(k)}">
      <label class="field">Change<select data-f="kind">
        <option value="leave"${kind === 'leave' ? ' selected' : ''}>Leave (cancel this lesson)</option>
        ${o.mode === 'onsite' ? `<option value="online"${kind === 'online' ? ' selected' : ''}>Switch to online</option>` : ''}
        <option value="reschedule"${kind === 'reschedule' ? ' selected' : ''}>Move to another time</option></select></label>
      ${kind === 'reschedule' ? `<div class="tt-row">
        <label class="field">Date<input type="date" data-f="date" value="${esc(val(k, 'date', o.date))}"></label>
        <label class="field">Start<input type="time" data-f="start" value="${esc(val(k, 'start', o.start))}"></label>
        <label class="field">End<input type="time" data-f="end" value="${esc(val(k, 'end', o.end))}"></label></div>` : ''}
      <label class="field">Reason<input data-f="reason" value="${esc(val(k, 'reason'))}" placeholder="e.g. parent message on WeCom"></label>
      <div class="actions"><button class="btn btn-primary btn-sm" type="submit" ${busy ? 'disabled' : ''}>Apply change</button>
        <button class="btn btn-sm" type="button" data-close>Cancel</button><span class="err">${esc(errs[k] || '')}</span></div>
    </form>`;
  }

  function revokeForm(c) {
    const k = 'revoke:' + c.id;
    return `<form class="tt-form" data-form="${esc(k)}">
      <label class="field">Why undo "${esc(KIND_LABEL[c.kind])}"?<input data-f="reason" value="${esc(val(k, 'reason'))}"></label>
      <div class="actions"><button class="btn btn-primary btn-sm" type="submit" ${busy ? 'disabled' : ''}>Undo change</button>
        <button class="btn btn-sm" type="button" data-close>Cancel</button><span class="err">${esc(errs[k] || '')}</span></div></form>`;
  }

  function extraForm() {
    const k = 'extra';
    const mode = val(k, 'mode', 'onsite');
    const opt = (list, cur) => list.map(x => `<option value="${esc(x.v)}"${x.v === cur ? ' selected' : ''}>${esc(x.t)}</option>`).join('');
    return `<form class="tt-form tt-extra" data-form="extra"><h3>Add an extra lesson</h3>
      <div class="tt-row">
        <label class="field">Student<select data-f="studentId"><option value="">Choose…</option>${opt(data.students.map(s => ({ v: s.id, t: s.name })), val(k, 'studentId'))}</select></label>
        <label class="field">Date<input type="date" data-f="date" value="${esc(val(k, 'date', selected || data.today))}"></label>
        <label class="field">Start<input type="time" data-f="start" value="${esc(val(k, 'start', '16:00'))}"></label>
        <label class="field">End<input type="time" data-f="end" value="${esc(val(k, 'end', '17:00'))}"></label>
        <label class="field">Teacher<select data-f="teacher">${opt(data.teachers.map(t => ({ v: t, t })), val(k, 'teacher', data.teachers[0]))}</select></label>
        <label class="field">Mode<select data-f="mode">${opt([{ v: 'onsite', t: 'On-site' }, { v: 'online', t: 'Online' }], mode)}</select></label>
        ${mode === 'onsite' ? `<label class="field">Room<select data-f="room">${opt(data.rooms.map(r => ({ v: r, t: r })), val(k, 'room', data.rooms[0]))}</select></label>` : ''}
      </div>
      <label class="field">Reason<input data-f="reason" value="${esc(val(k, 'reason'))}" placeholder="e.g. extra practice before SAC"></label>
      <div class="actions"><button class="btn btn-primary btn-sm" type="submit" ${busy ? 'disabled' : ''}>Add lesson</button>
        <button class="btn btn-sm" type="button" data-close>Cancel</button><span class="err">${esc(errs[k] || '')}</span></div></form>`;
  }

  // ---------- week grid ----------
  function weekView(days, today) {
    return `<div class="table-wrap"><table class="tt-week"><thead><tr>${days.map(d =>
      `<th><button class="linkish" data-goto="${d.date}">${esc(label(d.date))}</button>${d.date === today ? ' ' + chip('today', 'info') : ''}</th>`).join('')}</tr></thead>
      <tbody><tr>${days.map(d => `<td>${d.lessons.length ? d.lessons.map(o => `<div class="tt-mini${o.state !== 'scheduled' ? ' is-off' : ''}">
        <b>${esc(o.start)}</b> ${esc(o.studentName)} <span class="muted">${esc(o.room)}</span>
        ${o.state === 'cancelled' ? chip('leave', 'warn') : o.state === 'moved' ? chip('moved', 'warn') : ''}${o.pending ? chip('request', 'warn') : ''}${o.extra ? chip('extra', 'info') : ''}
        ${o.attendance ? chip(ATT_LABEL[o.attendance.status], o.attendance.status === 'present' ? 'good' : o.attendance.status === 'late' ? 'warn' : 'bad') : ''}</div>`).join('')
        : '<p class="empty">-</p>'}</td>`).join('')}</tr></tbody></table></div>`;
  }

  // ---------- recent decisions and notices ----------
  function recentCard() {
    if (!data.recent.length) return '';
    return `<section class="card"><div class="card-head"><h2>Recent changes</h2></div><div class="card-body">
      ${data.recent.map(c => `<div class="req">
        <div>${statusChip(c.status)} <strong>${esc(c.studentName)}</strong> · ${esc(changeSummary(c))}</div>
        <div class="muted">${c.source === 'student' ? `Requested by ${esc(c.requestedBy)}` : 'Changed by tutor'}${c.decidedBy ? ` · decided by ${esc(c.decidedBy)} ${esc(fmtDateTime(c.decidedAt))}` : ''}</div>
        ${c.reason ? quote(c.reason) : ''}
        ${c.decisionNote ? `<div>Note: ${esc(c.decisionNote)}</div>` : ''}
        ${c.status === 'revoked' ? `<div class="muted">Undone by ${esc(c.revokedBy)}: ${esc(c.revokeReason)}</div>` : ''}
        ${c.status === 'approved' && c.notice ? `<div class="notice-box"><div class="muted">Notice for ${esc(c.notice.to)} (copy into WeCom)</div>
          <pre>${esc(c.notice.text)}</pre><button class="btn btn-sm" data-copy="${esc(c.id)}">${icon('copy')} Copy notice</button></div>` : ''}
      </div>`).join('')}</div></section>`;
  }

  // ---------- events (delegated on root, so repaints need no rebinding) ----------
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.note) { notes[t.dataset.note] = t.value; return; }
    const f = t.closest('[data-form]');
    if (f && t.dataset.f) {
      (form[f.dataset.form] ||= {})[t.dataset.f] = t.value;
      if (t.tagName === 'SELECT') paint(); // kind / mode change the visible fields
    }
  });
  root.addEventListener('change', e => {
    const t = e.target;
    const f = t.closest('[data-form]');
    if (f && t.dataset.f) (form[f.dataset.form] ||= {})[t.dataset.f] = t.value;
  });

  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.week) { selected = addDays(data.from, +b.dataset.week); open = null; load(); return; }
    if ('today' in b.dataset) { selected = data.today; load(); return; }
    if (b.dataset.view) { view = b.dataset.view; paint(); return; }
    if (b.dataset.day) { selected = b.dataset.day; open = null; paint(); return; }
    if (b.dataset.goto) { selected = b.dataset.goto; view = 'day'; paint(); return; }
    if (b.dataset.open) { open = open === b.dataset.open ? null : b.dataset.open; paint(); return; }
    if ('close' in b.dataset) { open = null; paint(); return; }
    if (b.dataset.att) return attendance(b.dataset.att, b.dataset.v, b.getAttribute('aria-pressed') === 'true');
    if (b.dataset.approve) return decide(b.dataset.approve, true);
    if (b.dataset.decline) return decide(b.dataset.decline, false);
    if (b.dataset.copy) return copy(b.dataset.copy);
  });

  root.addEventListener('submit', e => {
    e.preventDefault();
    const k = e.target.dataset.form;
    if (k === 'extra') return submitExtra();
    if (k.startsWith('revoke:')) return submitRevoke(k.slice(7));
    return submitChange(k);
  });

  const findLesson = k => data.days.flatMap(d => d.lessons).find(o => keyOf(o) === k);
  const errText = e => (Array.isArray(e.details) && e.code === 'VALIDATION' && typeof e.details[0] === 'string' && e.details[0].includes(' ') ? e.details.join('; ') : e.message);

  async function run(k, fn, ok) {
    if (busy) return;
    busy = true; errs[k] = '';
    try {
      await fn();
      if (ctx.signal.aborted) return;
      delete form[k]; open = null;
      if (ok) ctx.toast(ok);
    } catch (e) {
      if (ctx.signal.aborted) return;
      errs[k] = errText(e);
    } finally {
      busy = false;
      if (!ctx.signal.aborted) paint();
    }
  }

  function submitChange(k) {
    const o = findLesson(k);
    if (!o) return;
    const kind = val(k, 'kind', 'leave');
    const to = kind === 'reschedule' ? { date: val(k, 'date', o.date), start: val(k, 'start', o.start), end: val(k, 'end', o.end) } : undefined;
    return run(k, () => ctx.api.changeLesson({ occId: o.id, kind, to, reason: val(k, 'reason') }),
      `${KIND_LABEL[kind]} saved. Copy the notice for ${o.teacher} under Recent changes.`);
  }

  function submitExtra() {
    const k = 'extra';
    const mode = val(k, 'mode', 'onsite');
    return run(k, () => ctx.api.changeLesson({ kind: 'extra', studentId: val(k, 'studentId'), reason: val(k, 'reason'),
      to: { date: val(k, 'date', selected || data.today), start: val(k, 'start', '16:00'), end: val(k, 'end', '17:00'),
        teacher: val(k, 'teacher', data.teachers[0]), mode, room: mode === 'onsite' ? val(k, 'room', data.rooms[0]) : undefined } }),
    'Extra lesson added. Copy the notice under Recent changes.');
  }

  function submitRevoke(changeId) {
    const k = 'revoke:' + changeId;
    const c = data.days.flatMap(d => d.lessons).map(o => o.change).find(x => x?.id === changeId);
    if (!c) return;
    return run(k, () => ctx.api.revokeLessonChange(changeId, { reason: val(k, 'reason'), version: c.version }), 'Change undone. Let the teacher know.');
  }

  async function attendance(k, v, wasPressed) {
    const o = findLesson(k);
    if (!o) return;
    try {
      await ctx.api.markAttendance(o.id, o.date, wasPressed ? null : v);
      if (!ctx.signal.aborted) ctx.toast(wasPressed ? `Cleared ${o.studentName}` : `${o.studentName}: ${ATT_LABEL[v]}`);
    } catch (e) { if (!ctx.signal.aborted) ctx.toast(e.message); }
  }

  async function decide(id, approve) {
    const c = data.pending.find(x => x.id === id);
    if (!c) return;
    await run('req:' + id, () => ctx.api.decideLessonChange(id, { approve, note: notes[id] || '', version: c.version }),
      approve ? `Approved. Copy the notice for ${c.lesson?.teacher || 'the teacher'} under Recent changes.` : 'Declined. The student sees your note.');
    if (!errs['req:' + id]) delete notes[id];
  }

  async function copy(id) {
    const c = data.recent.find(x => x.id === id);
    if (!c?.notice) return;
    try { await navigator.clipboard.writeText(c.notice.text); if (!ctx.signal.aborted) ctx.toast('Notice copied - paste it into WeCom'); }
    catch { if (!ctx.signal.aborted) ctx.toast('Copy failed - select the text and copy it manually'); }
  }

  // ---------- data ----------
  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    const from = mondayOf(selected || data?.today || '2000-01-03');
    try {
      const d = await ctx.api.getTimetable(selected ? { from, to: addDays(from, 6) } : {});
      if (!current()) return;
      data = d;
      if (!selected || selected < d.from || selected > d.to) selected = d.today >= d.from && d.today <= d.to ? d.today : d.from;
      paint();
    } catch (e) { if (current()) root.innerHTML = errorBanner(e); }
  }
  paint(); load(); ctx.subscribe(load);
}

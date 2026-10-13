// Student home: hello card, quick links, My Day / My Exams. Owner A (shell).
import { esc, icon, initials, chip, errorBanner, fmtDate, daysBetween, requestGate } from '../../../packages/ui/components/html.js';
import { weekDays, weekStrip, agenda } from '../../../packages/ui/components/week.js';

export function render(el, params, ctx) {
  const { user, routes } = ctx;
  let tab = 'day';
  let data = null;
  let selected = null;
  const tiles = routes.filter(r => r.id !== 'home');

  el.innerHTML = `
    <div class="grid-3">
      <section class="card profile" aria-label="Profile">
        <div class="card-head"><span class="avatar">${esc(initials(user.name))}</span>
          <div><div class="profile-hello">Hello,</div><div class="profile-name">${esc(user.name.split(' ')[0])}</div></div></div>
        <div class="id-strip">Student ID: <span>${esc(user.studentNo)}</span></div>
        <div class="card-body" id="facts"><div class="loading">Loading…</div></div>
      </section>
      <section class="card" aria-label="Quick links">
        <div class="card-head"><h2>My quick links</h2></div>
        <div class="tiles">${tiles.map(r => `<a class="tile${r.owner === 'B' ? ' muted-tile' : ''}" href="#/${r.id}">${icon(r.icon)}<span>${esc(r.label)}</span></a>`).join('')}</div>
      </section>
      <section class="card" aria-label="My day">
        <div class="card-head"><div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="day">My Day</button>
          <button class="tab" role="tab" data-tab="exams">My Exams</button></div></div>
        <div id="panel"><div class="loading">Loading…</div></div>
      </section>
    </div>`;

  const panel = el.querySelector('#panel');
  const facts = el.querySelector('#facts');
  el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));

  function paint() {
    el.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
    if (!data) return;
    const s = data.student;
    facts.innerHTML = `<p>Year ${s.year} · ${esc(s.school)}</p>
      <p>${icon('book')} ${esc(data.currentModule.id)} ${esc(data.currentModule.name)}</p>
      ${data.pendingSubmissions ? `<p>${chip(`${data.pendingSubmissions} upload(s) waiting for marking`, 'info')}</p>` : ''}`;

    if (tab === 'day') {
      const days = weekDays(data.today);
      selected = selected || data.today;
      const items = data.weekLessons.filter(t => t.date === selected)
        .map(t => ({ title: t.state === 'cancelled' ? 'Maths tutoring - cancelled (leave)' : t.state === 'moved' ? 'Maths tutoring - moved' : 'Maths tutoring',
          sub: `${t.mode === 'online' ? 'Online' : 'On-site'} with ${t.teacher}`, time: `${t.start} - ${t.end}`, place: t.room }));
      panel.innerHTML = `<div class="notice">Upload finished tests from <a href="#/upload">Upload test</a>. Need to change a lesson? <a href="#/timetable">Timetable</a>.</div>
        ${weekStrip(days, selected)}${agenda(fmtDate(selected), items, 'No lessons this day.')}`;
      panel.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { selected = b.dataset.day; paint(); }));
    } else {
      const t = data.currentTest;
      const sac = data.sac;
      panel.innerHTML = `<div class="agenda">
        ${sac ? `<div class="agenda-item"><strong>${esc(sac.title)}</strong><div>${esc(fmtDate(sac.date))} · in ${daysBetween(data.today, sac.date)} days</div>
          <div>${sac.gaps.length ? chip('Modules still to finish: ' + sac.gaps.join(', '), 'warn') : chip('All SAC modules covered', 'good')}</div></div>` : ''}
        ${t ? `<div class="agenda-item"><strong>${esc(t.name)}</strong>
          <div>${t.latest ? `Latest attempt ${t.attempts}: ${t.latest.score}/${t.latest.total} (${t.latest.pct}%)` : 'Not sat yet'}</div>
          <div class="muted">Your tutor decides when you are ready to sit or retake it.</div></div>` : ''}
        ${!sac && !t ? '<p class="empty">No exams coming up.</p>' : ''}</div>`;
    }
  }

  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    try {
      const d = await ctx.api.getMyHome();
      if (!current()) return;
      data = d; paint();
    } catch (e) { if (current()) panel.innerHTML = errorBanner(e); }
  }
  paint(); load(); ctx.subscribe(load);
}

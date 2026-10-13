// Staff home: profile card, quick links, My Day / To do. Owner A (shell).
import { esc, icon, initials, errorBanner, fmtDate, requestGate } from '../../../packages/ui/components/html.js';
import { weekDays, weekStrip, agenda } from '../../../packages/ui/components/week.js';

export function render(el, params, ctx) {
  const { user, routes } = ctx;
  let tab = 'day';
  let data = null;
  let selected = null;

  const tiles = routes.filter(r => r.id !== 'home' && (!r.roles || r.roles.includes(user.role)));

  el.innerHTML = `
    <div class="grid-3">
      <section class="card profile" aria-label="Profile">
        <div class="card-head"><span class="avatar">${esc(initials(user.name))}</span>
          <div><div class="profile-hello">Hello,</div><div class="profile-name">${esc(user.name)}</div></div></div>
        <div class="id-strip">Staff ID: <span>${esc(user.staffId)}</span></div>
        <div class="card-body">
          <p>${user.role === 'manager' ? 'Centre manager' : 'Learning support tutor'}</p>
          <p class="muted">Shift: weekdays 14:00-19:00</p>
        </div>
      </section>

      <section class="card" aria-label="Quick links">
        <div class="card-head"><h2>My quick links</h2></div>
        <div class="tiles">${tiles.map(r => `
          <a class="tile${r.owner === 'B' ? ' muted-tile' : ''}" href="#/${r.id}">${icon(r.icon)}<span>${esc(r.label)}</span></a>`).join('')}
        </div>
      </section>

      <section class="card" aria-label="My day">
        <div class="card-head"><div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="day">My Day</button>
          <button class="tab" role="tab" data-tab="todo">To do</button></div></div>
        <div id="panel"><div class="loading">Loading…</div></div>
      </section>
    </div>`;

  const panel = el.querySelector('#panel');
  el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));

  function paint() {
    el.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
    if (!data) return;
    if (tab === 'day') {
      const days = weekDays(data.today);
      selected = selected || data.today;
      const day = days.find(d => d.iso === selected);
      const items = data.week.filter(t => t.day === day.weekday).sort((a, b) => a.start.localeCompare(b.start))
        .map(t => ({ title: t.studentName, sub: `${t.mode === 'online' ? 'Online lesson' : 'On-site lesson'} with ${t.teacher}`, time: `${t.start} - ${t.end}`, place: t.room }));
      panel.innerHTML = `<div class="notice">Shift 14:00-19:00 · ${data.queued} test(s) waiting to be marked</div>
        ${weekStrip(days, selected)}${agenda(fmtDate(selected), items, 'No lessons scheduled.')}`;
      panel.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { selected = b.dataset.day; paint(); }));
    } else {
      panel.innerHTML = `<ul class="todo">
        <li><a href="#/marking">Tests to mark</a><span class="count">${data.queued}</span></li>
        <li><a href="#/marking">Submission exceptions</a><span class="count">${data.exceptions}</span></li>
        <li><a href="#/corrections">Corrections to review</a><span class="count">${data.correctionsToReview}</span></li>
      </ul>
      <div class="card-body"><h3>Upcoming SACs</h3>${data.upcomingSacs.length ? `<ul>${data.upcomingSacs.map(s =>
        `<li>${esc(s.studentName)} · ${esc(s.title)} · ${esc(fmtDate(s.date))}</li>`).join('')}</ul>` : '<p class="muted">None recorded.</p>'}</div>`;
    }
  }

  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    try {
      const d = await ctx.api.getStaffHome();
      if (!current()) return;
      data = d; paint();
    } catch (e) { if (current()) panel.innerHTML = errorBanner(e); }
  }
  paint(); load(); ctx.subscribe(load);
}

// Steps 1-3: one workspace instead of opening five systems; today's attendance and changes.
import * as store from '../lib/store.js';
import { esc, chip } from '../lib/ui.js';

const STATUS_TONE = { 'checked-in': 'good', 'expected': 'neutral', 'change-requested': 'warn', 'leave': 'bad' };

export function render(el) {
  const { timetable, submissions, messages } = store.getState();
  const queued = submissions.filter(s => s.status === 'queued').length;
  const exceptions = submissions.filter(s => s.status === 'exception').length;
  const unread = messages.filter(m => m.status === 'new').length;
  const changes = timetable.filter(t => t.status === 'change-requested');

  el.innerHTML = `
    <h1>Today <span class="muted">${store.TODAY}</span></h1>
    <p class="lede">Steps 1-3 · shift 14:00-19:00</p>

    <div class="kpis">
      ${kpi('Expected today', timetable.length)}
      ${kpi('Checked in', timetable.filter(t => t.status === 'checked-in').length)}
      ${kpi('Change requests', changes.length, changes.length ? 'warn' : '')}
      ${kpi('To mark', queued, '', '#/marking')}
      ${kpi('Submission exceptions', exceptions, exceptions ? 'bad' : '', '#/marking')}
      ${kpi('New messages', unread, '', '#/messages')}
    </div>

    ${changes.length ? `<section class="card">
      <h2>Pending schedule changes <span class="muted">(step 3, tutor confirms)</span></h2>
      <ul class="plain">${changes.map(c => {
        const s = store.studentById(c.studentId);
        return `<li>${esc(s.name)} · ${esc(c.time)} with ${esc(c.teacher)} - request from message, see <a href="#/messages">Messages</a></li>`;
      }).join('')}</ul>
    </section>` : ''}

    <section class="card">
      <h2>Timetable</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Student</th><th>Time</th><th>Teacher</th><th>Room</th><th>Mode</th><th>Status</th><th></th></tr></thead>
        <tbody>${timetable.map(t => {
          const s = store.studentById(t.studentId);
          return `<tr>
            <td><a href="#/students/${s.id}">${esc(s.name)}</a></td>
            <td>${esc(t.time)}</td><td>${esc(t.teacher)}</td><td>${esc(t.room)}</td>
            <td>${chip(t.mode, t.mode === 'online' ? 'info' : 'neutral')}</td>
            <td>${chip(t.status, STATUS_TONE[t.status])}</td>
            <td>${t.status === 'expected' && t.mode === 'onsite' ? `<button class="btn btn-sm" data-checkin="${s.id}">Check in</button>` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>
  `;

  el.querySelectorAll('[data-checkin]').forEach(b => b.addEventListener('click', () => store.checkIn(b.dataset.checkin)));
}

function kpi(label, value, tone = '', href = '') {
  const inner = `<div class="kpi-value">${value}</div><div class="kpi-label">${esc(label)}</div>`;
  return href ? `<a class="kpi ${tone}" href="${href}">${inner}</a>` : `<div class="kpi ${tone}">${inner}</div>`;
}

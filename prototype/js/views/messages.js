// Steps 6-7: messages pasted in by the tutor, triaged (stub), drafted (placeholder). The tutor sends replies.
import * as store from '../lib/store.js';
import { triage } from '../lib/triage.js';
import { esc, chip, banner } from '../lib/ui.js';

const TONE = { new: 'info', triaged: 'warn', resolved: 'good' };

export function render(el) {
  const { messages } = store.getState();
  el.innerHTML = `
    <h1>Messages</h1>
    <p class="lede">Steps 6-7 · triage and drafts are suggestions; the tutor confirms and sends via WeCom.</p>
    ${banner('Input path for the demo: tutor pastes the message. Reading WeCom external-contact chats via API is unverified.', 'info')}
    <section class="card">
      <h2>Paste a message</h2>
      <div class="paste">
        <select id="paste-student">${store.students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <input id="paste-text" placeholder="Paste message text (English or 中文)">
        <button id="paste-add" class="btn">Add</button>
      </div>
    </section>
    ${messages.map(row).join('')}
  `;

  el.querySelector('#paste-add').addEventListener('click', () => {
    const text = el.querySelector('#paste-text').value.trim();
    if (!text) return;
    const studentId = el.querySelector('#paste-student').value;
    messages.unshift({ id: 'm' + Date.now(), studentId, from: 'Pasted by tutor', role: 'unknown', receivedAt: 'now', text, status: 'new' });
    render(el);
  });
  el.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => store.setMessageStatus(b.dataset.id, b.dataset.status)));
}

function row(m) {
  const s = store.studentById(m.studentId);
  const t = triage(m);
  return `<section class="card msg">
    <div class="msg-head">
      <strong>${esc(m.from)}</strong> <span class="muted">re ${esc(s.name)} · ${esc(m.receivedAt)}</span>
      ${chip(m.status, TONE[m.status])}
    </div>
    <blockquote>${esc(m.text)}</blockquote>
    <div class="msg-triage">
      Suggested: ${chip(t.label, 'info')} ${t.alsoMentions.map(x => chip(x)).join(' ')}
      ${t.ambiguous ? chip('Ambiguous - confirm intent', 'warn') : ''}
      <span class="muted">(${esc(t.source)})</span>
    </div>
    <textarea class="draft" placeholder="AI reply draft - not connected yet. Tutor writes / edits and sends manually."></textarea>
    <div class="actions">
      ${m.status === 'new' ? `<button class="btn btn-sm" data-id="${m.id}" data-status="triaged">Confirm triage</button>` : ''}
      ${m.status !== 'resolved' ? `<button class="btn btn-sm btn-primary" data-id="${m.id}" data-status="resolved">Mark sent / resolved</button>` : ''}
    </div>
  </section>`;
}

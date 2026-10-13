// Seven-day strip starting today, plus a simple agenda list. The full calendar is a separate (B) module.
import { esc } from './html.js';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekDays(todayIso) {
  const start = new Date(todayIso + 'T00:00:00');
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const js = d.getDay();
    return { iso, date: d.getDate(), name: DAY[js], weekday: js === 0 ? 7 : js, weekend: js === 0 || js === 6 };
  });
}

export function weekStrip(days, selectedIso) {
  return `<div class="week" role="tablist" aria-label="Days">${days.map(d =>
    `<button type="button" role="tab" data-day="${d.iso}" class="${d.iso === selectedIso ? 'sel' : ''} ${d.weekend ? 'weekend' : ''}" aria-selected="${d.iso === selectedIso}">
      ${d.date}<small>${d.name}</small></button>`).join('')}</div>`;
}

// items: [{ title, sub, time, place }]
export function agenda(heading, items, emptyText) {
  return `<div class="agenda"><div class="agenda-day">${esc(heading)}</div>${items.length
    ? items.map(i => `<div class="agenda-item"><strong>${esc(i.title)}</strong>${i.sub ? `<div>${esc(i.sub)}</div>` : ''}
        ${i.time ? `<div><b>${esc(i.time)}</b></div>` : ''}${i.place ? `<div class="muted">${esc(i.place)}</div>` : ''}</div>`).join('')
    : `<p class="empty">${esc(emptyText)}</p>`}</div>`;
}

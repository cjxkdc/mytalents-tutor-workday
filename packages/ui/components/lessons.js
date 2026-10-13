// Lesson and timetable-change display helpers shared by the staff and student timetables.
import { esc, chip } from './html.js';
import { label } from '../../contract/timetable.js';

export const KIND_LABEL = { leave: 'Leave', online: 'Switch to online', reschedule: 'Move to another time', extra: 'Extra lesson' };
export const ATT_LABEL = { present: 'Present', late: 'Late', absent: 'Absent' };
const ATT_TONE = { present: 'good', late: 'warn', absent: 'bad' };
const STATUS_TONE = { pending: 'warn', approved: 'good', declined: 'bad', withdrawn: '', revoked: '' };

export const statusChip = s => chip(s[0].toUpperCase() + s.slice(1), STATUS_TONE[s] ?? '');
export const attendanceChip = a => (a ? chip(ATT_LABEL[a.status], ATT_TONE[a.status]) : '');
export const slot = (date, start, end) => `${label(date)} ${start}-${end}`;

/** One line describing a change. `c.lesson` is the weekly lesson it applies to (null for extra lessons). */
export function changeSummary(c) {
  const orig = c.lesson ? slot(c.date, c.lesson.start, c.lesson.end) : '';
  switch (c.kind) {
    case 'leave': return `Leave · ${orig}`;
    case 'online': return `Switch to online · ${orig}`;
    case 'reschedule': return `Move ${orig} → ${slot(c.to.date, c.to.start, c.to.end)}`;
    case 'extra': return `Extra lesson · ${slot(c.to.date, c.to.start, c.to.end)} · ${c.to.mode === 'online' ? 'Online' : c.to.room}`;
    default: return '';
  }
}

/** Status chips for one occurrence (see timetable.js lessonsBetween). */
export function lessonChips(o) {
  const out = [];
  if (o.state === 'cancelled') out.push(chip('Cancelled - on leave', 'warn'));
  if (o.state === 'moved') out.push(chip(`Moved to ${slot(o.movedTo.date, o.movedTo.start, o.movedTo.end)}`, 'warn'));
  if (o.movedFrom) out.push(chip(`Moved from ${slot(o.movedFrom.date, o.movedFrom.start, o.movedFrom.end)}`, 'info'));
  if (o.extra) out.push(chip('Extra lesson', 'info'));
  if (o.change?.kind === 'online') out.push(chip('Switched to online', 'info'));
  if (o.pending) out.push(chip(`Request pending: ${KIND_LABEL[o.pending.kind]}`, 'warn'));
  return out.join(' ');
}

/** A regular lesson with no open request or change, not yet marked and not in the past. */
export const canChange = (o, today) =>
  o.state === 'scheduled' && !o.extra && !o.change && !o.pending && !o.attendance && o.date >= today;

/** Unique DOM key: a moved lesson and its placeholder share `id`. */
export const keyOf = o => `${o.id}@${o.date}`;

export const quote = text => `<blockquote class="reason">${esc(text)}</blockquote>`;

// Timetable derivation: weekly lesson template + approved change facts + attendance facts -> the lessons
// that actually happen on given dates. Pure functions (no storage), so the real backend can reuse them.
// Lessons only - Q&A sessions are not part of the timetable (DESIGN_CONSENSUS, Timetable).

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const parse = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = dt => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;

export const CHANGE_KINDS = ['leave', 'online', 'reschedule', 'extra'];
export const STUDENT_KINDS = ['leave', 'online', 'reschedule'];
export const ATTENDANCE = ['present', 'late', 'absent'];
/** Changes that block another change on the same lesson. */
export const isActive = c => c.status === 'pending' || c.status === 'approved';

/** 1 = Monday ... 7 = Sunday */
export const weekdayOf = iso => { const d = parse(iso).getUTCDay(); return d === 0 ? 7 : d; };
export const addDays = (iso, n) => { const dt = parse(iso); dt.setUTCDate(dt.getUTCDate() + n); return fmt(dt); };
export const mondayOf = iso => addDays(iso, 1 - weekdayOf(iso));
export const toMin = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
export const label = iso => { const dt = parse(iso); return `${DAY[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTH[dt.getUTCMonth()]}`; };
export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Occurrence id of a regular lesson on its original date, or of an extra lesson. */
export const occIdOf = (lessonId, date) => `${lessonId}|${date}`;
export const extraOccId = changeId => `X|${changeId}`;

/**
 * Lessons on [from, to].
 * Every occurrence: { id, lessonId, studentId, date, start, end, teacher, room, mode, extra,
 *   state: 'scheduled' | 'cancelled' | 'moved',   // 'moved' = placeholder left on the original date
 *   change,      // the approved change that shaped this occurrence, or null
 *   pending,     // a pending request on it, or null
 *   movedFrom,   // { date, start, end } when it was rescheduled to here
 *   movedTo,     // { date, start, end } on the placeholder
 *   attendance } // attendance fact or null
 * `id` is shared by a moved lesson and its placeholder; it identifies the lesson instance, not the slot.
 */
export function lessonsBetween(from, to, { template, changes, attendance }) {
  const approved = new Map(), pending = new Map();
  for (const c of changes) {
    if (c.status === 'approved') approved.set(c.occId, c);
    else if (c.status === 'pending') pending.set(c.occId, c);
  }
  const att = new Map(attendance.map(a => [a.occId, a]));
  const out = [];
  const push = o => out.push({ ...o, attendance: o.state === 'scheduled' ? att.get(o.id) || null : null });

  for (const date of datesBetween(from, to)) {
    const wd = weekdayOf(date);
    for (const t of template) {
      if (t.day !== wd) continue;
      const id = occIdOf(t.id, date);
      const base = { id, lessonId: t.id, studentId: t.studentId, date, start: t.start, end: t.end, teacher: t.teacher,
        room: t.room, mode: t.mode, extra: false, state: 'scheduled', change: null, pending: pending.get(id) || null, movedFrom: null, movedTo: null };
      const ch = approved.get(id);
      if (!ch) { push(base); continue; }
      if (ch.kind === 'leave') push({ ...base, state: 'cancelled', change: ch });
      else if (ch.kind === 'online') push({ ...base, mode: 'online', room: 'Online', change: ch });
      else if (ch.kind === 'reschedule') push({ ...base, state: 'moved', change: ch, movedTo: { date: ch.to.date, start: ch.to.start, end: ch.to.end } });
    }
  }

  const byLesson = Object.fromEntries(template.map(t => [t.id, t]));
  for (const ch of approved.values()) {
    if (ch.kind === 'reschedule' && ch.to.date >= from && ch.to.date <= to) {
      const t = byLesson[ch.lessonId];
      if (!t) continue;
      push({ id: ch.occId, lessonId: t.id, studentId: t.studentId, date: ch.to.date, start: ch.to.start, end: ch.to.end, teacher: t.teacher,
        room: t.room, mode: t.mode, extra: false, state: 'scheduled', change: ch, pending: null,
        movedFrom: { date: ch.date, start: t.start, end: t.end }, movedTo: null });
    } else if (ch.kind === 'extra' && ch.to.date >= from && ch.to.date <= to) {
      push({ id: ch.occId, lessonId: null, studentId: ch.studentId, date: ch.to.date, start: ch.to.start, end: ch.to.end, teacher: ch.to.teacher,
        room: ch.to.mode === 'online' ? 'Online' : ch.to.room, mode: ch.to.mode, extra: true, state: 'scheduled', change: ch, pending: null, movedFrom: null, movedTo: null });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.studentId.localeCompare(b.studentId));
}

/** Lessons that take place (not cancelled, not a moved placeholder). */
export const happening = o => o.state === 'scheduled';

/**
 * Problems with putting `studentId` in [start, end) on `date`. `lessons` are that date's occurrences;
 * `ignoreId` is the lesson being moved. Returns [] when the slot is fine.
 * Group lessons are normal, so teacher and room overlaps are not conflicts.
 */
export function slotProblems({ studentId, date, start, end, ignoreId }, lessons, rules) {
  const out = [];
  if (weekdayOf(date) > 5 && rules.weekdaysOnly) out.push('Lessons run on weekdays only');
  if (!(start < end)) out.push('End time must be after start time');
  else if (start < rules.shiftStart || end > rules.shiftEnd) out.push(`Lessons must sit within ${rules.shiftStart}-${rules.shiftEnd}`);
  const clash = lessons.find(o => happening(o) && o.id !== ignoreId && o.studentId === studentId && o.date === date
    && toMin(o.start) < toMin(end) && toMin(start) < toMin(o.end));
  if (clash) out.push(`Overlaps another lesson ${clash.start}-${clash.end}`);
  return out;
}

/** Counts for one day's lessons: feeds the daily report (arrivals) and the board header. */
export function attendanceSummary(lessons) {
  const live = lessons.filter(happening);
  const n = s => live.filter(o => o.attendance?.status === s).length;
  return {
    lessons: live.length,
    onsite: live.filter(o => o.mode === 'onsite').length,
    online: live.filter(o => o.mode === 'online').length,
    present: n('present'), late: n('late'), absent: n('absent'),
    unmarked: live.filter(o => !o.attendance).length,
    cancelled: lessons.filter(o => o.state === 'cancelled').length,
    arrivedOnsite: live.filter(o => o.mode === 'onsite' && (o.attendance?.status === 'present' || o.attendance?.status === 'late')).length,
  };
}

/** Plain-text notice for the lesson's teacher. The tutor copies it into WeCom; nothing is sent automatically. */
export function noticeText(change, lesson, studentName) {
  const slot = `${label(lesson.date)} ${lesson.start}-${lesson.end}`;
  const reason = change.reason ? ` Reason: ${change.reason}` : '';
  switch (change.kind) {
    case 'leave': return `[Timetable] ${studentName}: ${slot} (${lesson.room}) is cancelled - student on leave.${reason}`;
    case 'online': return `[Timetable] ${studentName}: ${slot} switches to online.${reason}`;
    case 'reschedule': return `[Timetable] ${studentName}: ${slot} moves to ${label(change.to.date)} ${change.to.start}-${change.to.end}.${reason}`;
    case 'extra': return `[Timetable] Extra lesson for ${studentName}: ${label(change.to.date)} ${change.to.start}-${change.to.end}, ${change.to.mode === 'online' ? 'online' : change.to.room}.${reason}`;
    default: return '';
  }
}

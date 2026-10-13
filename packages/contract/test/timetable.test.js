// Timetable derivation rules (packages/contract/timetable.js). Run: node --test packages/contract/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as tt from '../timetable.js';

const rules = { shiftStart: '14:00', shiftEnd: '19:00', weekdaysOnly: true };
// 2026-10-13 is a Tuesday.
const template = [
  { id: 'L1', studentId: 's1', day: 2, start: '16:00', end: '18:00', teacher: 'Ms Park', room: 'Room A', mode: 'onsite' },
  { id: 'L2', studentId: 's2', day: 2, start: '16:00', end: '17:00', teacher: 'Ms Park', room: 'Room A', mode: 'onsite' },
];
const change = (kind, extra = {}) => ({ id: 'c1', occId: 'L1|2026-10-13', lessonId: 'L1', studentId: 's1', date: '2026-10-13', kind, to: null, status: 'approved', ...extra });
const day = (changes = [], attendance = []) => tt.lessonsBetween('2026-10-12', '2026-10-16', { template, changes, attendance });

test('Dates and weekdays', () => {
  assert.equal(tt.weekdayOf('2026-10-13'), 2);
  assert.equal(tt.mondayOf('2026-10-18'), '2026-10-12');
  assert.equal(tt.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(tt.label('2026-10-13'), 'Tue 13 Oct');
});

test('The weekly template expands to dated lessons', () => {
  const lessons = day();
  assert.equal(lessons.length, 2);
  assert.ok(lessons.every(o => o.date === '2026-10-13' && o.state === 'scheduled'));
});

test('Only approved changes apply; pending ones are only flagged', () => {
  const [l1] = day([change('leave', { status: 'pending' })]);
  assert.equal(l1.state, 'scheduled');
  assert.equal(l1.pending.kind, 'leave');
  assert.equal(day([change('leave', { status: 'declined' })])[0].pending, null);
});

test('Leave cancels, online switches mode and room', () => {
  assert.equal(day([change('leave')]).find(o => o.lessonId === 'L1').state, 'cancelled');
  const online = day([change('online')]).find(o => o.lessonId === 'L1');
  assert.deepEqual([online.mode, online.room, online.state], ['online', 'Online', 'scheduled']);
});

test('Reschedule leaves a placeholder and adds the lesson on the new date', () => {
  const lessons = day([change('reschedule', { to: { date: '2026-10-15', start: '15:00', end: '17:00' } })]).filter(o => o.lessonId === 'L1');
  assert.deepEqual(lessons.map(o => [o.date, o.state, o.start]), [['2026-10-13', 'moved', '16:00'], ['2026-10-15', 'scheduled', '15:00']]);
  assert.equal(lessons[1].movedFrom.date, '2026-10-13');
});

test('Extra lessons appear on their date', () => {
  const extra = { id: 'c9', occId: 'X|c9', lessonId: null, studentId: 's2', date: '2026-10-16', kind: 'extra', status: 'approved',
    to: { date: '2026-10-16', start: '17:00', end: '18:00', teacher: 'Ms Park', mode: 'online', room: 'Online' } };
  const o = day([extra]).find(x => x.extra);
  assert.deepEqual([o.date, o.room, o.studentId], ['2026-10-16', 'Online', 's2']);
});

test('Slot rules: weekend, shift hours, student overlap; group lessons are fine', () => {
  const lessons = day();
  const p = (date, start, end, studentId = 's3') => tt.slotProblems({ studentId, date, start, end }, lessons, rules);
  assert.deepEqual(p('2026-10-13', '16:00', '17:00'), []); // same room and teacher as L1/L2: group lesson
  assert.match(p('2026-10-17', '16:00', '17:00')[0], /weekdays/);
  assert.match(p('2026-10-13', '18:30', '19:30')[0], /14:00-19:00/);
  assert.match(p('2026-10-13', '17:00', '16:00')[0], /after start/);
  assert.match(p('2026-10-13', '17:30', '18:30', 's1')[0], /Overlaps/);
  assert.deepEqual(p('2026-10-13', '18:00', '19:00', 's1'), []); // touching end-to-start is not an overlap
});

test('Attendance attaches to lessons that happen and feeds the day summary', () => {
  const lessons = day([change('online')], [{ occId: 'L1|2026-10-13', status: 'late' }, { occId: 'L2|2026-10-13', status: 'present' }]);
  const s = tt.attendanceSummary(lessons);
  assert.deepEqual([s.lessons, s.online, s.present, s.late, s.unmarked, s.arrivedOnsite], [2, 1, 1, 1, 0, 1]);
  assert.equal(tt.attendanceSummary(day([change('leave')])).cancelled, 1);
});

test('Notice text names the student, slot and reason', () => {
  const text = tt.noticeText({ kind: 'online', reason: '感冒' }, { date: '2026-10-15', start: '16:00', end: '17:30', room: 'Room A' }, 'Amy Chen');
  assert.equal(text, '[Timetable] Amy Chen: Thu 15 Oct 16:00-17:30 switches to online. Reason: 感冒');
});

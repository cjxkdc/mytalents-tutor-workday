// Demo-mode implementation of the API contract (see CONTRACT.md). The real backend will expose the
// same methods over HTTP; pages only ever talk to ctx.api, so swapping implementations needs no page changes.
//
// Demo-mode caveat: both apps share one browser database because they are served from the same origin.
// That is NOT the production isolation model - in production each app talks only to the backend,
// which scopes every student request to the signed-in student.

import * as data from './mock-data.js';
import * as derive from './derive.js';
import * as db from './db.js';
import * as tt from './timetable.js';

export class ApiError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
const toApiError = e => (e instanceof ApiError ? e : new ApiError('STORAGE', e?.message || String(e)));

const ref = derive.indexReference(data);
const OUTCOMES = ['DONE', 'W', 'C', 'BLANK'];
const STAFF_ROLES = ['tutor', 'manager'];
const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const pad = n => String(n).padStart(2, '0');
// Local wall-clock time (no zone), matching how seed timestamps are written.
const nowIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
let seqCounter = 0;
const nextSeq = () => Date.now() * 1000 + (seqCounter++ % 1000);
const validTime = s => /^\d{2}:\d{2}$/.test(s || '') && +s.slice(0, 2) < 24 && +s.slice(3) < 60;
const validDate = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const isNum = v => typeof v === 'number' && Number.isFinite(v);

// ---------- change notification: same tab, other tabs, and on focus ----------
// Notifications may repeat and do not map one-to-one to writes: listeners should simply re-query.
const listeners = new Set();
const channel = 'BroadcastChannel' in self ? new BroadcastChannel('tutor-workday-demo') : null;
const emitLocal = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
if (channel) channel.onmessage = emitLocal;
addEventListener('focus', emitLocal);
function changed() { emitLocal(); channel?.postMessage('changed'); }

// ---------- seeding: version check, clear and seed in ONE transaction ----------
async function seedTx(t, force) {
  const meta = await t.get('meta', 'seed');
  if (!force && meta?.version === data.SEED_VERSION) return;
  for (const s of db.STORES) await t.clear(s);
  await t.put('meta', { id: 'seed', version: data.SEED_VERSION });
  for (const r of data.seedResults) await t.put('results', r);
  for (const s of data.seedSubmissions) await t.put('submissions', s);
  for (const [i, r] of data.seedExamRecords.entries()) await t.put('examRecords', { id: `er-seed-${i}`, ...r });
  for (const c of data.seedLessonChanges) await t.put('lessonChanges', c);
}
let seeded = null;
function ensureSeeded() {
  if (!seeded) seeded = db.transact(db.STORES, t => seedTx(t, false)).catch(e => { seeded = null; throw e; });
  return seeded;
}
async function load(store, index, key) { await ensureSeeded(); return db.getAll(store, index, key); }
async function tx(names, fn) { await ensureSeeded(); return db.transact(names, fn); }

const studentById = id => data.students.find(s => s.id === id);
const lessonById = id => data.timetable.find(t => t.id === id);
const TT_STORES = ['lessonChanges', 'attendance', 'audit'];
const MAX_RANGE_DAYS = 42;

// ---------- timetable helpers (lessons only; Q&A sessions are not part of the timetable) ----------
const lessonsFrom = (from, to, changes, attendance) => tt.lessonsBetween(from, to, { template: data.timetable, changes, attendance });
const named = o => ({ ...o, studentName: studentById(o.studentId).name });
function checkRange(from, to) {
  if (!validDate(from) || !validDate(to) || from > to) throw new ApiError('VALIDATION', 'Give a valid date range');
  if (tt.datesBetween(from, to).length > MAX_RANGE_DAYS) throw new ApiError('VALIDATION', `At most ${MAX_RANGE_DAYS} days at a time`);
}
function checkTo(to, isExtra) {
  const errors = [];
  if (!to || !validDate(to.date)) errors.push('date');
  if (!validTime(to?.start)) errors.push('start');
  if (!validTime(to?.end)) errors.push('end');
  if (isExtra) {
    if (!data.teachers.includes(to?.teacher)) errors.push('teacher');
    if (!['onsite', 'online'].includes(to?.mode)) errors.push('mode');
    else if (to.mode === 'onsite' && !data.rooms.includes(to?.room)) errors.push('room');
  }
  if (errors.length) throw new ApiError('VALIDATION', 'Check the highlighted fields', errors);
  if (to.date < data.TODAY) throw new ApiError('VALIDATION', 'The new date has already passed', ['date']);
}
// The regular lesson `occId` on its original date, as currently scheduled.
function findRegular(occId, changes, attendance) {
  const [lessonId, date] = String(occId || '').split('|');
  const t = lessonById(lessonId);
  if (!t || !validDate(date) || tt.weekdayOf(date) !== t.day) throw new ApiError('NOT_FOUND', 'Lesson not found');
  return lessonsFrom(date, date, changes, attendance).find(o => o.id === occId && o.date === date);
}
// Checks shared by student requests and tutor changes on a regular lesson. Returns the change body.
function buildChange({ occId, kind, to, reason }, changes, attendance) {
  if (!tt.STUDENT_KINDS.includes(kind)) throw new ApiError('VALIDATION', 'Choose leave, online or reschedule', ['kind']);
  if (typeof reason !== 'string' || !reason.trim()) throw new ApiError('VALIDATION', 'Give a reason', ['reason']);
  const lesson = findRegular(occId, changes, attendance);
  if (lesson.date < data.TODAY) throw new ApiError('INVALID_STATE', 'This lesson has already passed');
  if (changes.some(c => c.occId === occId && tt.isActive(c))) throw new ApiError('INVALID_STATE', 'This lesson already has a pending request or an approved change');
  if (attendance.some(a => a.occId === occId)) throw new ApiError('INVALID_STATE', 'Attendance is already recorded for this lesson');
  if (kind === 'online' && lesson.mode === 'online') throw new ApiError('INVALID_STATE', 'This lesson is already online');
  let next = null;
  if (kind === 'reschedule') {
    checkTo(to, false);
    if (to.date === lesson.date && to.start === lesson.start && to.end === lesson.end) throw new ApiError('VALIDATION', 'Pick a different time', ['date']);
    const problems = tt.slotProblems({ studentId: lesson.studentId, date: to.date, start: to.start, end: to.end, ignoreId: occId },
      lessonsFrom(to.date, to.date, changes, attendance), data.policy.timetable);
    if (problems.length) throw new ApiError('VALIDATION', problems.join('; '), problems);
    next = { date: to.date, start: to.start, end: to.end };
  }
  return { lesson, body: { occId, lessonId: lesson.lessonId, studentId: lesson.studentId, date: lesson.date, kind, to: next, reason: reason.trim() } };
}
// Re-check a pending request at decision time: the timetable may have changed since it was sent.
const recheck = (c, changes, attendance) => buildChange(c, changes.filter(x => x.id !== c.id), attendance);
const withNotice = (c, lesson) => ({ ...c, notice: { to: c.kind === 'extra' ? c.to.teacher : lesson.teacher, text: tt.noticeText(c, lesson, studentById(c.studentId).name) } });
// Students see their own request and the decision, not the staff notice.
const strip = ({ notice, ...c }) => c;
const changeView = c => ({ ...c, studentName: studentById(c.studentId).name, lesson: c.lessonId ? lessonById(c.lessonId) : null });

export function createMockApi(user) {
  const isStaff = STAFF_ROLES.includes(user?.role);
  const requireStaff = () => { if (!isStaff) throw new ApiError('FORBIDDEN', 'Staff only'); };
  const requireStudent = () => { if (user?.role !== 'student') throw new ApiError('FORBIDDEN', 'Students only'); return user.studentId; };
  const auditRec = (action, details) => ({ id: uid('au'), seq: nextSeq(), at: nowIso(), by: user.name, role: user.role, action, details });

  const api = {
    // ---------- common ----------
    me: async () => user,
    reference: async () => ({ modules: data.modules, tests: data.tests, policy: data.policy, today: data.TODAY }),
    async resetDemo() { await db.transact(db.STORES, t => seedTx(t, true)); seeded = Promise.resolve(); changed(); },

    // ---------- staff: home & students ----------
    async listStudents() { requireStaff(); return data.students; },

    async getStaffHome() {
      requireStaff();
      const [subs, corrections, changes, attendance] = await Promise.all([load('submissions'), load('corrections'), load('lessonChanges'), load('attendance')]);
      const week = lessonsFrom(data.TODAY, tt.addDays(data.TODAY, 6), changes, attendance).map(o => ({ ...named(o), day: tt.weekdayOf(o.date) }));
      return {
        today: data.TODAY,
        queued: subs.filter(s => s.status === 'queued').length,
        exceptions: subs.filter(s => s.status === 'exception').length,
        correctionsToReview: corrections.filter(c => c.status === 'submitted').length,
        timetableRequests: changes.filter(c => c.status === 'pending').length,
        week,
        todaySessions: week.filter(o => o.date === data.TODAY && tt.happening(o)),
        upcomingSacs: data.students.filter(s => s.sac).map(s => ({ studentId: s.id, studentName: s.name, ...s.sac })),
      };
    },

    // ---------- staff: marking ----------
    async listSubmissions() {
      requireStaff();
      return (await load('submissions'))
        .map(s => ({ ...s, studentName: studentById(s.studentId).name, testName: ref.testIndex[s.testId].name }))
        .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    },

    async getSubmission(id) {
      requireStaff();
      await ensureSeeded();
      const [submission, results, pages] = await Promise.all([db.get('submissions', id), db.getAll('results'), db.getAll('pages', 'submissionId', id)]);
      if (!submission) throw new ApiError('NOT_FOUND', 'Submission not found');
      return {
        submission,
        student: studentById(submission.studentId),
        test: ref.testIndex[submission.testId],
        pages: pages.sort((a, b) => a.index - b.index),
        existingAttempts: derive.attemptsOf(results, submission.studentId, submission.testId),
        nextAttempt: derive.nextAttempt(results, submission.studentId, submission.testId),
        aiSuggestions: null, // not connected yet
      };
    },

    // items: [{ qNo, outcome, score }] exactly once per question.
    // State check, overwrite check and all writes run in one transaction.
    async confirmMarking(id, { attempt, items, reason } = {}) {
      requireStaff();
      if (!Number.isInteger(attempt) || attempt < 1) throw new ApiError('VALIDATION', 'Attempt must be a whole number from 1');
      return tx(['submissions', 'results', 'corrections', 'audit'], async t => {
        const submission = await t.get('submissions', id);
        if (!submission) throw new ApiError('NOT_FOUND', 'Submission not found');
        if (submission.status !== 'queued') throw new ApiError('INVALID_STATE', `Submission is already ${submission.status}`);
        const test = ref.testIndex[submission.testId];

        const errors = [];
        const byQ = {};
        for (const it of items || []) {
          if (!test.questions.some(q => q.no === it.qNo)) errors.push({ qNo: it.qNo, message: 'Unknown question' });
          else if (byQ[it.qNo]) errors.push({ qNo: it.qNo, message: 'Question given twice' });
          else byQ[it.qNo] = it;
        }
        for (const q of test.questions) {
          const it = byQ[q.no];
          if (!it || !OUTCOMES.includes(it.outcome)) { errors.push({ qNo: q.no, message: 'Outcome required' }); continue; }
          if (!isNum(it.score) || it.score < 0 || it.score > q.marks) errors.push({ qNo: q.no, message: `Score must be 0-${q.marks}` });
          else if (it.outcome === 'BLANK' && it.score !== 0) errors.push({ qNo: q.no, message: 'Blank must score 0' });
        }
        if (errors.length) throw new ApiError('VALIDATION', 'Some questions are incomplete', errors);

        const results = await t.getAll('results', 'studentId', submission.studentId);
        const existing = results.filter(r => r.testId === test.id && r.attempt === attempt);
        if (existing.length && !reason?.trim()) {
          throw new ApiError('REASON_REQUIRED', `Attempt ${attempt} already has results. Give a reason to replace them.`);
        }

        // Replacing results: old corrections no longer match the new marks. Remove them, keep a full copy in the audit log.
        const superseded = [];
        for (const r of existing) {
          const c = await t.get('corrections', r.id);
          if (c) { superseded.push(c); await t.del('corrections', r.id); }
          await t.del('results', r.id);
        }
        const markedAt = data.TODAY;
        const version = uid('rv'); // changes on every marking, so stale corrections cannot attach to new marks
        const fresh = test.questions.map(q => ({
          id: `${submission.studentId}|${test.id}|${attempt}|${q.no}`, studentId: submission.studentId, testId: test.id, attempt,
          qNo: q.no, outcome: byQ[q.no].outcome, score: byQ[q.no].score, markedBy: user.name, markedAt, submissionId: id, version,
        }));
        for (const r of fresh) await t.put('results', r);
        await t.put('submissions', { ...submission, status: 'marked', attempt, markedBy: user.name, markedAt });
        await t.put('audit', auditRec(existing.length ? 're-mark' : 'confirm-marking', {
          submissionId: id, studentId: submission.studentId, testId: test.id, attempt,
          suggestedAttempt: submission.suggestedAttempt, reason: reason || null,
          previous: existing.map(r => ({ qNo: r.qNo, outcome: r.outcome, score: r.score, markedBy: r.markedBy })),
          supersededCorrections: superseded,
        }));
        return derive.attemptScore(fresh, test, submission.studentId, attempt);
      }).then(r => { changed(); return r; });
    },

    async markException(id, reason) {
      requireStaff();
      if (!reason?.trim()) throw new ApiError('VALIDATION', 'Reason required');
      await tx(['submissions', 'audit'], async t => {
        const submission = await t.get('submissions', id);
        if (!submission) throw new ApiError('NOT_FOUND', 'Submission not found');
        if (submission.status !== 'queued') throw new ApiError('INVALID_STATE', `Submission is already ${submission.status}`);
        await t.put('submissions', { ...submission, status: 'exception', exception: reason.trim() });
        await t.put('audit', auditRec('mark-exception', { submissionId: id, reason: reason.trim() }));
      });
      changed();
    },

    // ---------- staff: records ----------
    async getExhibits() {
      requireStaff();
      const results = await load('results');
      return {
        students: data.students,
        sheet: derive.markingSheet(results, ref),
        stats: derive.examStats(results, data.students, data.tests, data.policy),
        progress: data.students.map(s => derive.progressRow(results, s, data.modules, ref, data.policy)),
      };
    },

    async getEvidence(studentId, kpId) {
      if (!isStaff && studentId !== user.studentId) throw new ApiError('FORBIDDEN', 'Not your record');
      if (!studentById(studentId) || !ref.kpIndex[kpId]) throw new ApiError('NOT_FOUND', 'Unknown student or knowledge point');
      const results = await load('results', 'studentId', studentId);
      return derive.masteryCell(results, studentById(studentId), kpId, ref, data.policy);
    },

    async listExamRecords() {
      requireStaff();
      return (await load('examRecords')).map(r => ({ ...r, studentName: studentById(r.studentId).name })).sort((a, b) => b.date.localeCompare(a.date));
    },

    // ---------- staff: corrections ----------
    async listCorrections() {
      requireStaff();
      const [corrections, results] = await Promise.all([load('corrections'), load('results')]);
      const byId = Object.fromEntries(results.map(r => [r.id, r]));
      const rank = s => (s === 'submitted' ? 0 : 1);
      return corrections
        .filter(c => byId[c.id] && byId[c.id].version === c.resultVersion && (byId[c.id].outcome === 'W' || byId[c.id].outcome === 'C'))
        .map(c => { const r = byId[c.id]; return { ...c, studentName: studentById(c.studentId).name, testName: ref.testIndex[r.testId].name, qNo: r.qNo, type: r.outcome }; })
        .sort((a, b) => rank(a.status) - rank(b.status) || b.submittedAt.localeCompare(a.submittedAt));
    },

    // version: the correction version the tutor was looking at (from listCorrections).
    async reviewCorrection(id, { accept, note, version } = {}) {
      requireStaff();
      if (typeof accept !== 'boolean') throw new ApiError('VALIDATION', 'accept must be true or false');
      if (!accept && !note?.trim()) throw new ApiError('VALIDATION', 'Tell the student what still needs work');
      await tx(['corrections', 'results', 'audit'], async t => {
        const c = await t.get('corrections', id);
        if (!c) throw new ApiError('NOT_FOUND', 'Correction not found');
        if (c.version !== version) throw new ApiError('CONFLICT', 'This correction changed since you opened it. Refresh and review again.');
        if (c.status !== 'submitted') throw new ApiError('INVALID_STATE', `Correction is ${c.status}`);
        const r = await t.get('results', id);
        if (!r || (r.outcome !== 'W' && r.outcome !== 'C') || r.version !== c.resultVersion) {
          throw new ApiError('CONFLICT', 'The question was re-marked; this correction no longer applies');
        }
        const next = accept
          ? { ...c, status: 'confirmed', confirmedAt: nowIso(), confirmedBy: user.name, tutorNote: note?.trim() || '' }
          : { ...c, status: 'needs-work', tutorNote: note.trim() };
        await t.put('corrections', next);
        await t.put('audit', auditRec(accept ? 'confirm-correction' : 'return-correction', { correctionId: id, note: note?.trim() || null }));
      });
      changed();
    },

    async listAudit() { requireStaff(); return (await load('audit')).sort((a, b) => b.seq - a.seq); },

    // ---------- staff: timetable ----------
    // Lessons in [from, to] (default: this Monday to Sunday), pending requests and recent decisions.
    async getTimetable({ from, to } = {}) {
      requireStaff();
      from = from || tt.mondayOf(data.TODAY); to = to || tt.addDays(from, 6);
      checkRange(from, to);
      const [changes, attendance] = await Promise.all([load('lessonChanges'), load('attendance')]);
      const lessons = lessonsFrom(from, to, changes, attendance).map(named);
      const pending = changes.filter(c => c.status === 'pending').map(c => {
        let problems = [];
        try { recheck(c, changes, attendance); } catch (e) { problems = [e.message]; }
        return { ...changeView(c), problems };
      }).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
      return {
        today: data.TODAY, from, to, rules: data.policy.timetable, teachers: data.teachers, rooms: data.rooms,
        students: data.students.map(s => ({ id: s.id, name: s.name })),
        days: tt.datesBetween(from, to).map(date => {
          const ls = lessons.filter(o => o.date === date);
          return { date, weekday: tt.weekdayOf(date), lessons: ls, summary: tt.attendanceSummary(ls) };
        }),
        pending,
        recent: changes.filter(c => c.status !== 'pending').map(changeView)
          .sort((a, b) => (b.decidedAt || b.requestedAt).localeCompare(a.decidedAt || a.requestedAt)).slice(0, 20),
      };
    },

    // A tutor changes a lesson directly: { occId, kind: leave|online|reschedule, to?, reason }
    // or adds one: { kind: 'extra', studentId, to: { date, start, end, teacher, mode, room }, reason }. Takes effect at once.
    async changeLesson(input = {}) {
      requireStaff();
      const c = await tx(TT_STORES, async t => {
        const [changes, attendance] = await Promise.all([t.getAll('lessonChanges'), t.getAll('attendance')]);
        const id = uid('lc');
        let body, lesson;
        if (input.kind === 'extra') {
          if (!studentById(input.studentId)) throw new ApiError('VALIDATION', 'Choose a student', ['studentId']);
          if (typeof input.reason !== 'string' || !input.reason.trim()) throw new ApiError('VALIDATION', 'Give a reason', ['reason']);
          checkTo(input.to, true);
          const to = { date: input.to.date, start: input.to.start, end: input.to.end, teacher: input.to.teacher, mode: input.to.mode,
            room: input.to.mode === 'online' ? 'Online' : input.to.room };
          const problems = tt.slotProblems({ studentId: input.studentId, ...to }, lessonsFrom(to.date, to.date, changes, attendance), data.policy.timetable);
          if (problems.length) throw new ApiError('VALIDATION', problems.join('; '), problems);
          body = { occId: tt.extraOccId(id), lessonId: null, studentId: input.studentId, date: to.date, kind: 'extra', to, reason: input.reason.trim() };
          lesson = { ...to };
        } else {
          ({ body, lesson } = buildChange(input, changes, attendance));
        }
        const at = nowIso();
        const rec = withNotice({ id, ...body, source: 'staff', status: 'approved', requestedBy: user.name, requestedAt: at,
          decidedBy: user.name, decidedAt: at, decisionNote: '', version: uid('cv') }, lesson);
        await t.put('lessonChanges', rec);
        await t.put('audit', auditRec('timetable-change', { changeId: id, occId: rec.occId, kind: rec.kind, to: rec.to, reason: rec.reason }));
        return rec;
      });
      changed();
      return changeView(c);
    },

    // Approve or decline a student's request. Declining needs a note; approving re-checks the timetable.
    async decideLessonChange(id, { approve, note, version } = {}) {
      requireStaff();
      if (typeof approve !== 'boolean') throw new ApiError('VALIDATION', 'approve must be true or false');
      if (!approve && !note?.trim()) throw new ApiError('VALIDATION', 'Tell the student why', ['note']);
      const c = await tx(TT_STORES, async t => {
        const c = await t.get('lessonChanges', id);
        if (!c) throw new ApiError('NOT_FOUND', 'Request not found');
        if (c.version !== version) throw new ApiError('CONFLICT', 'This request changed since you opened it. Refresh and decide again.');
        if (c.status !== 'pending') throw new ApiError('INVALID_STATE', `Request is already ${c.status}`);
        let next = { ...c, status: approve ? 'approved' : 'declined', decidedBy: user.name, decidedAt: nowIso(), decisionNote: note?.trim() || '', version: uid('cv') };
        if (approve) {
          const [changes, attendance] = await Promise.all([t.getAll('lessonChanges'), t.getAll('attendance')]);
          next = withNotice(next, recheck(c, changes, attendance).lesson);
        }
        await t.put('lessonChanges', next);
        await t.put('audit', auditRec(approve ? 'approve-timetable-request' : 'decline-timetable-request', { changeId: id, note: next.decisionNote || null }));
        return next;
      });
      changed();
      return changeView(c);
    },

    // Undo an approved change: the lesson goes back to the weekly template. Blocked once attendance is recorded.
    async revokeLessonChange(id, { reason, version } = {}) {
      requireStaff();
      if (!reason?.trim()) throw new ApiError('VALIDATION', 'Give a reason', ['reason']);
      await tx(TT_STORES, async t => {
        const c = await t.get('lessonChanges', id);
        if (!c) throw new ApiError('NOT_FOUND', 'Change not found');
        if (c.version !== version) throw new ApiError('CONFLICT', 'This change was updated since you opened it. Refresh and retry.');
        if (c.status !== 'approved') throw new ApiError('INVALID_STATE', `Change is ${c.status}`);
        if (await t.get('attendance', c.occId)) throw new ApiError('INVALID_STATE', 'Attendance is already recorded for this lesson');
        await t.put('lessonChanges', { ...c, status: 'revoked', revokedBy: user.name, revokedAt: nowIso(), revokeReason: reason.trim(), version: uid('cv') });
        await t.put('audit', auditRec('revoke-timetable-change', { changeId: id, reason: reason.trim() }));
      });
      changed();
    },

    // status: present | late | absent, or null to clear. Only for lessons that take place, today or earlier.
    async markAttendance(occId, date, status) {
      requireStaff();
      if (status !== null && !tt.ATTENDANCE.includes(status)) throw new ApiError('VALIDATION', 'Choose present, late or absent');
      if (!validDate(date)) throw new ApiError('VALIDATION', 'Give a valid date');
      if (date > data.TODAY) throw new ApiError('INVALID_STATE', 'This lesson has not happened yet');
      await tx(TT_STORES, async t => {
        const [changes, attendance] = await Promise.all([t.getAll('lessonChanges'), t.getAll('attendance')]);
        const lesson = lessonsFrom(date, date, changes, attendance).find(o => o.id === occId && tt.happening(o));
        if (!lesson) throw new ApiError('NOT_FOUND', 'No lesson takes place in that slot');
        const previous = lesson.attendance?.status || null;
        if (status === null) await t.del('attendance', occId);
        else await t.put('attendance', { id: occId, occId, studentId: lesson.studentId, date, status, markedBy: user.name, markedAt: nowIso() });
        await t.put('audit', auditRec('attendance', { occId, date, status, previous }));
      });
      changed();
    },

    // ---------- student: timetable ----------
    async getMyTimetable({ from, to } = {}) {
      const sid = requireStudent();
      from = from || tt.mondayOf(data.TODAY); to = to || tt.addDays(from, 6);
      checkRange(from, to);
      const [changes, attendance] = await Promise.all([load('lessonChanges'), load('attendance')]);
      const lessons = lessonsFrom(from, to, changes, attendance).filter(o => o.studentId === sid)
        .map(o => ({ ...o, change: o.change && strip(o.change), pending: o.pending && strip(o.pending) }));
      return {
        today: data.TODAY, from, to, rules: data.policy.timetable,
        days: tt.datesBetween(from, to).map(date => ({ date, weekday: tt.weekdayOf(date), lessons: lessons.filter(o => o.date === date) })),
        requests: changes.filter(c => c.studentId === sid && c.source === 'student').map(strip)
          .map(c => ({ ...c, lesson: c.lessonId ? lessonById(c.lessonId) : null }))
          .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
      };
    },

    // { occId, kind: leave|online|reschedule, to?: { date, start, end }, reason }. Becomes pending; a tutor decides.
    async requestLessonChange(input = {}) {
      const sid = requireStudent();
      const c = await tx(TT_STORES, async t => {
        const [changes, attendance] = await Promise.all([t.getAll('lessonChanges'), t.getAll('attendance')]);
        const [lessonId] = String(input.occId || '').split('|');
        if (lessonById(lessonId)?.studentId !== sid) throw new ApiError('NOT_FOUND', 'Lesson not found');
        const { body } = buildChange(input, changes, attendance);
        const rec = { id: uid('lc'), ...body, source: 'student', status: 'pending', requestedBy: user.name, requestedAt: nowIso(), version: uid('cv') };
        await t.put('lessonChanges', rec);
        await t.put('audit', auditRec('timetable-request', { changeId: rec.id, occId: rec.occId, kind: rec.kind }));
        return rec;
      });
      changed();
      return strip(c);
    },

    async withdrawLessonChange(id, version) {
      const sid = requireStudent();
      await tx(TT_STORES, async t => {
        const c = await t.get('lessonChanges', id);
        if (!c || c.studentId !== sid) throw new ApiError('NOT_FOUND', 'Request not found');
        if (c.version !== version) throw new ApiError('CONFLICT', 'This request changed. Refresh to see its status.');
        if (c.status !== 'pending') throw new ApiError('INVALID_STATE', `Request is already ${c.status}`);
        await t.put('lessonChanges', { ...c, status: 'withdrawn', version: uid('cv') });
        await t.put('audit', auditRec('withdraw-timetable-request', { changeId: id }));
      });
      changed();
    },

    // ---------- student ----------
    async getMyHome() {
      const sid = requireStudent();
      const s = studentById(sid);
      const [results, subs, changes, attendance] = await Promise.all([load('results', 'studentId', sid), load('submissions'), load('lessonChanges'), load('attendance')]);
      const lessons = lessonsFrom(data.TODAY, tt.addDays(data.TODAY, 6), changes, attendance)
        .filter(o => o.studentId === sid).map(o => ({ ...strip(o), change: o.change && strip(o.change), day: tt.weekdayOf(o.date) }));
      const currentTest = data.tests.find(t => t.moduleId === s.currentModule);
      const attempts = currentTest ? derive.attemptsOf(results, sid, currentTest.id) : [];
      return {
        student: s, today: data.TODAY,
        todayLessons: lessons.filter(o => o.date === data.TODAY && tt.happening(o)),
        weekLessons: lessons,
        currentModule: data.modules.find(m => m.id === s.currentModule),
        currentTest: currentTest ? { id: currentTest.id, name: currentTest.name, attempts: attempts.length,
          latest: attempts.length ? derive.attemptScore(results, currentTest, sid, attempts[attempts.length - 1]) : null } : null,
        sac: s.sac ? { ...s.sac, gaps: s.sac.moduleIds.filter(m => !s.completedModules.includes(m)) } : null,
        pendingSubmissions: subs.filter(x => x.studentId === sid && x.status !== 'marked').length,
      };
    },

    async listMyTests() {
      const sid = requireStudent();
      const results = await load('results', 'studentId', sid);
      return data.tests.map(t => ({ id: t.id, name: t.name, attempts: derive.attemptsOf(results, sid, t.id), nextAttempt: derive.nextAttempt(results, sid, t.id) }));
    },

    // files: [{ blob, name, type }] already downscaled by the page.
    async submitTest({ testId, suggestedAttempt, files } = {}) {
      const sid = requireStudent();
      const lim = data.policy.upload;
      if (!ref.testIndex[testId]) throw new ApiError('VALIDATION', 'Choose a test');
      if (suggestedAttempt != null && !(Number.isInteger(suggestedAttempt) && suggestedAttempt >= 1)) throw new ApiError('VALIDATION', 'Attempt must be a whole number from 1');
      if (!Array.isArray(files) || !files.length) throw new ApiError('VALIDATION', 'Add at least one page');
      if (files.length > lim.maxPages) throw new ApiError('VALIDATION', `At most ${lim.maxPages} pages`);
      let total = 0;
      for (const f of files) {
        if (!(f?.blob instanceof Blob) || !String(f.blob.type || f.type).startsWith('image/')) throw new ApiError('VALIDATION', 'Only image pages are accepted');
        if (f.blob.size > lim.maxPageBytes) throw new ApiError('VALIDATION', `${f.name} is too large after compression`);
        total += f.blob.size;
      }
      if (total > lim.maxTotalBytes) throw new ApiError('VALIDATION', 'The pages are too large in total');
      const id = uid('sub');
      const submission = { id, studentId: sid, testId, suggestedAttempt: suggestedAttempt ?? null, submittedAt: nowIso(), source: 'student-upload',
        status: 'queued', pageCount: files.length, check: 'not-checked' };
      await tx(['submissions', 'pages', 'audit'], async t => {
        await t.put('submissions', submission);
        for (const [i, f] of files.entries()) {
          await t.put('pages', { id: `${id}-p${i + 1}`, submissionId: id, index: i, name: String(f.name || `page-${i + 1}`), type: f.blob.type || f.type, blob: f.blob });
        }
        await t.put('audit', auditRec('submit-test', { submissionId: id, testId, pages: files.length }));
      });
      changed();
      return submission;
    },

    async listMySubmissions() {
      const sid = requireStudent();
      return (await load('submissions')).filter(s => s.studentId === sid)
        .map(s => ({ ...s, testName: ref.testIndex[s.testId].name })).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    },

    async getMyMistakes() {
      const sid = requireStudent();
      const [results, corrections] = await Promise.all([load('results', 'studentId', sid), load('corrections')]);
      return derive.mistakes(results, sid, ref, corrections.filter(c => c.studentId === sid));
    },

    // resultVersion: the version of the marked question the student was looking at (from getMyMistakes).
    async submitCorrection(mistakeId, note, resultVersion) {
      const sid = requireStudent();
      if (typeof note !== 'string' || !note.trim()) throw new ApiError('VALIDATION', 'Describe your correction');
      await tx(['results', 'corrections', 'audit'], async t => {
        const r = await t.get('results', mistakeId);
        if (!r || r.studentId !== sid) throw new ApiError('NOT_FOUND', 'Mistake not found');
        if (r.version !== resultVersion) throw new ApiError('CONFLICT', 'This question was re-marked. Refresh to see the new result.');
        if (r.outcome !== 'W' && r.outcome !== 'C') throw new ApiError('INVALID_STATE', 'This question is no longer marked W or C');
        const existing = await t.get('corrections', mistakeId);
        if (existing?.status === 'submitted' || existing?.status === 'confirmed') throw new ApiError('INVALID_STATE', `Correction already ${existing.status}`);
        await t.put('corrections', { id: mistakeId, studentId: sid, status: 'submitted', note: note.trim(), submittedAt: nowIso(),
          tutorNote: existing?.tutorNote || '', resultVersion: r.version, version: uid('cv') });
        await t.put('audit', auditRec('submit-correction', { mistakeId }));
      });
      changed();
    },

    async getMyProgress() {
      const sid = requireStudent();
      const results = await load('results', 'studentId', sid);
      const s = studentById(sid);
      return {
        row: derive.progressRow(results, s, data.modules, ref, data.policy),
        stats: derive.examStats(results, [s], data.tests, data.policy)[0],
        modules: data.modules, tests: data.tests, policy: data.policy,
      };
    },

    async listMyExamRecords() {
      const sid = requireStudent();
      return (await load('examRecords')).filter(r => r.studentId === sid).sort((a, b) => b.date.localeCompare(a.date));
    },

    async addExamRecord(rec = {}) {
      const sid = requireStudent();
      const errors = [];
      if (!validDate(rec.date)) errors.push('date');
      if (typeof rec.paper !== 'string' || !rec.paper.trim()) errors.push('paper');
      for (const k of ['start', 'endFirst', 'endSecond']) if (!validTime(rec[k])) errors.push(k);
      if (!errors.some(e => ['start', 'endFirst', 'endSecond'].includes(e)) && !(rec.start < rec.endFirst && rec.endFirst <= rec.endSecond)) errors.push('times-order');
      if (!(Number.isInteger(rec.checks) && rec.checks >= 0)) errors.push('checks');
      if (!(isNum(rec.outOf) && rec.outOf > 0)) errors.push('outOf');
      if (!(isNum(rec.score) && rec.score >= 0 && (!isNum(rec.outOf) || rec.score <= rec.outOf))) errors.push('score');
      if (errors.length) throw new ApiError('VALIDATION', 'Check the highlighted fields', errors);
      // Build the record from known fields only, so callers cannot set id or studentId.
      const record = { id: uid('er'), studentId: sid, date: rec.date, paper: rec.paper.trim(), start: rec.start, endFirst: rec.endFirst,
        endSecond: rec.endSecond, checks: rec.checks, score: rec.score, outOf: rec.outOf };
      await tx(['examRecords'], t => t.put('examRecords', record));
      changed();
    },
  };

  // Every method rejects with ApiError (storage failures become code STORAGE).
  for (const [k, fn] of Object.entries(api)) {
    api[k] = async (...args) => { try { return await fn(...args); } catch (e) { throw toApiError(e); } };
  }
  api.subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  return api;
}

export const demoUsers = {
  staff: data.users.staff,
  students: data.students.map(s => ({ id: s.id, name: s.name, role: 'student', studentId: s.id, studentNo: s.studentNo })),
};

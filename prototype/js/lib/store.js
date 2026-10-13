// Single source of truth: the result long table. Exhibits 1-3, briefings and the daily report
// are all derived views, so one confirmed marking updates every sheet at once (brief step 8).
import * as mock from '../data/mock.js';

const clone = v => JSON.parse(JSON.stringify(v));

const state = {
  results: clone(mock.results),
  submissions: clone(mock.submissions),
  timetable: clone(mock.timetable),
  messages: clone(mock.messages),
  qaLog: clone(mock.qaLog),
  followUps: {}, // studentId -> { confirmed: bool, note: string }
};

const listeners = new Set();
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach(fn => fn());

export const { TODAY, course, modules, tests, students, examRecords, policy } = mock;
export const getState = () => state;

export const studentById = id => students.find(s => s.id === id);
export const testById = id => tests.find(t => t.id === id);
export const kpIndex = Object.fromEntries(
  modules.flatMap(m => m.kps.map(kp => [kp.id, { ...kp, moduleId: m.id }])),
);

// ---------- Exhibit 1: Marking Sheet ----------
export function markingSheet() {
  const groups = new Map();
  for (const r of state.results) {
    const key = `${r.studentId}|${r.testId}|${r.attempt}`;
    if (!groups.has(key)) groups.set(key, { studentId: r.studentId, testId: r.testId, attempt: r.attempt, markedAt: r.markedAt, cells: {} });
    groups.get(key).cells[r.qNo] = r;
  }
  return [...groups.values()].sort((a, b) =>
    a.studentId.localeCompare(b.studentId) || a.testId.localeCompare(b.testId) || a.attempt - b.attempt);
}

// ---------- Exhibit 3: Exam Statistics ----------
export function attemptScore(studentId, testId, attempt) {
  const test = testById(testId);
  const rows = state.results.filter(r => r.studentId === studentId && r.testId === testId && r.attempt === attempt);
  const total = test.questions.reduce((s, q) => s + q.marks, 0);
  const score = rows.reduce((s, r) => s + r.score, 0);
  const pct = Math.round((score / total) * 100);
  return { score, total, pct, band: band(pct), entered: rows.length, questions: test.questions.length };
}

export function band(pct) {
  if (pct >= policy.bands.green) return 'green';
  if (pct >= policy.bands.amber) return 'amber';
  return 'red';
}

export function examStats() {
  return students.map(s => ({
    student: s,
    tests: Object.fromEntries(tests.map(t => {
      const attempts = [...new Set(state.results.filter(r => r.studentId === s.id && r.testId === t.id).map(r => r.attempt))].sort();
      if (!attempts.length) return [t.id, null];
      const latest = attempts[attempts.length - 1];
      return [t.id, { attempts: attempts.length, latest, ...attemptScore(s.id, t.id, latest) }];
    })),
  }));
}

// ---------- Exhibit 2: Progress heat-map (proposed policy) ----------
export function evidenceFor(studentId, kpId) {
  const items = [];
  for (const r of state.results) {
    if (r.studentId !== studentId) continue;
    const question = testById(r.testId).questions.find(x => x.no === r.qNo);
    if (!question.kps.includes(kpId)) continue;
    const isPrimary = question.kps[0] === kpId;
    let counts = true;
    let why = '';
    if (r.outcome === 'C' && policy.mastery.excludeC) { counts = false; why = 'C shown separately'; }
    if (r.outcome === 'BLANK' && policy.mastery.excludeBlank) { counts = false; why = 'blank = not attempted'; }
    if (r.outcome === 'W' && !isPrimary && policy.mastery.multiKpWrong === 'primary-only') { counts = false; why = 'W not propagated to secondary KP'; }
    items.push({ ...r, counts, why });
  }
  return items.sort((a, b) => b.markedAt.localeCompare(a.markedAt) || b.attempt - a.attempt);
}

export function masteryCell(student, kpId) {
  const evidence = evidenceFor(student.id, kpId);
  const valid = evidence.filter(e => e.counts).slice(0, policy.mastery.window);
  const cCount = evidence.filter(e => e.outcome === 'C').length;
  const covered = [...student.completedModules, student.currentModule].includes(kpIndex[kpId].moduleId);
  let status;
  if (!covered && !evidence.length) status = 'not-covered';
  else if (valid.length < policy.mastery.minEvidence) status = 'insufficient';
  else {
    const w = valid.filter(e => e.outcome === 'W').length;
    if (w === 0) status = 'mastered';
    else if (w / valid.length >= 0.5) status = 'not-understood';
    else status = 'partial';
  }
  return { status, valid, evidence, cCount };
}

export function progressSummary(student) {
  const all = modules.flatMap(m => m.kps);
  const counts = {};
  for (const kp of all) {
    const { status } = masteryCell(student, kp.id);
    counts[status] = (counts[status] || 0) + 1;
  }
  const pct = k => Math.round(((counts[k] || 0) / all.length) * 100);
  return { counts, mastered: pct('mastered'), partial: pct('partial'), notUnderstood: pct('not-understood') };
}

// ---------- Step 4: student briefing ----------
export function briefing(studentId) {
  const s = studentById(studentId);
  const stats = examStats().find(x => x.student.id === studentId);
  const currentTest = tests.find(t => t.moduleId === s.currentModule);
  const currentResult = currentTest ? stats.tests[currentTest.id] : null;
  const sacGaps = s.sac ? s.sac.moduleIds.filter(m => !s.completedModules.includes(m)) : [];
  const recentErrors = state.results
    .filter(r => r.studentId === studentId && (r.outcome === 'W' || r.outcome === 'C' || r.outcome === 'BLANK'))
    .sort((a, b) => b.markedAt.localeCompare(a.markedAt))
    .slice(0, 8);
  const pendingSubs = state.submissions.filter(x => x.studentId === studentId && x.status !== 'marked');
  const openMessages = state.messages.filter(m => m.studentId === studentId && m.status !== 'resolved');
  return { student: s, currentTest, currentResult, sacGaps, recentErrors, pendingSubs, openMessages, stats };
}

export function daysUntil(date) {
  return Math.round((new Date(date) - new Date(TODAY)) / 86400000);
}

// ---------- Phase 5: follow-up nominations (rule-based, tutor confirms) ----------
export function followUpCandidates() {
  const out = [];
  for (const s of students) {
    const reasons = [];
    const stats = examStats().find(x => x.student.id === s.id);
    for (const t of tests) {
      const r = stats.tests[t.id];
      if (!r) continue;
      if (r.pct < policy.passMark) reasons.push(`${t.name} latest attempt ${r.pct}% (< ${policy.passMark}%) - Retest decision needed`);
      const rows = state.results.filter(x => x.studentId === s.id && x.testId === t.id && x.attempt === r.latest);
      const c = rows.filter(x => x.outcome === 'C').length;
      if (c >= policy.followUp.cCount) reasons.push(`${c} careless (C) marks in ${t.name}`);
    }
    if (s.sac) {
      const gaps = s.sac.moduleIds.filter(m => !s.completedModules.includes(m));
      const d = daysUntil(s.sac.date);
      if (gaps.length && d <= policy.followUp.sacWindowDays) reasons.push(`${s.sac.title} in ${d} days; modules not completed: ${gaps.join(', ')}`);
    }
    if (reasons.length) out.push({ student: s, reasons });
  }
  return out;
}

// ---------- Phase 5: daily report (facts only) ----------
export function dailyReport() {
  const markedToday = new Set(state.results.filter(r => r.markedAt === TODAY).map(r => `${r.studentId}|${r.testId}|${r.attempt}`));
  const qaConfirmed = state.qaLog.filter(q => q.confirmed);
  return {
    onsite: state.timetable.filter(t => t.status === 'checked-in' && t.mode === 'onsite').length,
    qaStudents: qaConfirmed.length,
    qaQuestions: qaConfirmed.reduce((s, q) => s + q.questions, 0),
    qaRequests: state.qaLog.reduce((s, q) => s + q.requests, 0),
    qaUnconfirmed: state.qaLog.filter(q => !q.confirmed).length,
    testsMarked: markedToday.size,
    sacCompleted: 0, // no Practice SAC records in mock data yet
    parentFeedbackDone: state.messages.filter(m => m.role === 'parent' && m.status === 'resolved').length,
    followUps: Object.entries(state.followUps).filter(([, v]) => v.confirmed).map(([id, v]) => ({ student: studentById(id), note: v.note })),
  };
}

// ---------- Mutations ----------
export function confirmMarking(submissionId, outcomes) {
  const sub = state.submissions.find(x => x.id === submissionId);
  const test = testById(sub.testId);
  // Replace any earlier rows for the same attempt so a re-mark never double counts.
  state.results = state.results.filter(r => !(r.studentId === sub.studentId && r.testId === sub.testId && r.attempt === sub.attempt));
  for (const question of test.questions) {
    const outcome = outcomes[question.no];
    state.results.push({
      studentId: sub.studentId, testId: sub.testId, attempt: sub.attempt, qNo: question.no, outcome,
      score: outcome === 'DONE' ? question.marks : 0, markedBy: 'tutor', markedAt: TODAY, source: sub.id,
    });
  }
  sub.status = 'marked';
  notify();
}

export function checkIn(studentId) {
  const row = state.timetable.find(t => t.studentId === studentId);
  if (row) row.status = 'checked-in';
  notify();
}

export function setMessageStatus(id, status) {
  const m = state.messages.find(x => x.id === id);
  if (m) m.status = status;
  notify();
}

export function confirmQa(studentId, questions) {
  const row = state.qaLog.find(q => q.studentId === studentId);
  if (row) { row.questions = questions; row.confirmed = true; }
  notify();
}

export function setFollowUp(studentId, confirmed, note = '') {
  state.followUps[studentId] = { confirmed, note };
  notify();
}

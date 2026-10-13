// Seed data for demo mode. All people and records are fictional.
// Reference data (course, tests, students, timetable, policy) is read-only here;
// mutable facts are copied into IndexedDB on first run (see mock-api.js).

export const SEED_VERSION = 5;
export const TODAY = '2026-10-13';

export const users = {
  staff: [
    { id: 'u-park', name: 'Ms Park', role: 'tutor', staffId: 'T-0142' },
    { id: 'u-chen', name: 'Mr Chen', role: 'manager', staffId: 'M-0007' },
  ],
};

export const modules = [
  { id: 'M1', name: 'Linear functions', kps: [
    { id: '1.1', name: 'Gradient & intercepts' },
    { id: '1.2', name: 'Simultaneous equations' },
    { id: '1.3', name: 'Distance & midpoint' },
  ] },
  { id: 'M2', name: 'Quadratics', kps: [
    { id: '2.1', name: 'Factorising' },
    { id: '2.2', name: 'Completing the square' },
    { id: '2.3', name: 'Discriminant' },
  ] },
  { id: 'M3', name: 'Polynomials', kps: [
    { id: '3.1', name: 'Polynomial division' },
    { id: '3.2', name: 'Factor theorem' },
    { id: '3.3', name: 'Cubic graphs' },
  ] },
  { id: 'M4', name: 'Functions & relations', kps: [
    { id: '4.1', name: 'Domain & range' },
    { id: '4.2', name: 'Inverse functions' },
    { id: '4.3', name: 'Transformations' },
  ] },
];

// kps[0] is the primary knowledge point (policy.mastery.multiKpWrong).
const q = (no, kps, marks) => ({ no, kps, marks });
export const tests = [
  { id: 'T-M1', moduleId: 'M1', type: 'module-test', name: 'Module 1 Test', version: 'v1', questions: [
    q(1, ['1.1'], 2), q(2, ['1.1'], 2), q(3, ['1.2'], 3), q(4, ['1.2', '1.1'], 3), q(5, ['1.3'], 4), q(6, ['1.3'], 4),
  ] },
  { id: 'T-M2', moduleId: 'M2', type: 'module-test', name: 'Module 2 Test', version: 'v1', questions: [
    q(1, ['2.1'], 2), q(2, ['2.1'], 2), q(3, ['2.2'], 3), q(4, ['2.2'], 3), q(5, ['2.3'], 4), q(6, ['2.3', '2.1'], 4),
  ] },
  { id: 'T-M3', moduleId: 'M3', type: 'module-test', name: 'Module 3 Test', version: 'v1', questions: [
    q(1, ['3.1'], 2), q(2, ['3.2'], 2), q(3, ['3.2'], 3), q(4, ['3.3'], 3), q(5, ['3.3'], 4), q(6, ['3.1', '3.2'], 4),
  ] },
];

export const students = [
  { id: 's01', name: 'Amy Chen', studentNo: 'S-24001', year: 11, school: 'Balwyn High (mock)', currentModule: 'M3', completedModules: ['M1', 'M2'],
    sac: { date: '2026-10-20', title: 'SAC 2 - Polynomials', moduleIds: ['M2', 'M3'] } },
  { id: 's02', name: 'Ben Li', studentNo: 'S-24002', year: 11, school: 'Box Hill High (mock)', currentModule: 'M2', completedModules: ['M1'], sac: null },
  { id: 's03', name: 'Chloe Wang', studentNo: 'S-24003', year: 11, school: 'Balwyn High (mock)', currentModule: 'M4', completedModules: ['M1', 'M2', 'M3'],
    sac: { date: '2026-10-21', title: 'SAC 2 - Functions', moduleIds: ['M3', 'M4'] } },
  { id: 's04', name: 'Daniel Zhang', studentNo: 'S-24004', year: 11, school: 'Camberwell High (mock)', currentModule: 'M2', completedModules: ['M1'], sac: null },
  { id: 's05', name: 'Emily Liu', studentNo: 'S-24005', year: 11, school: 'Box Hill High (mock)', currentModule: 'M3', completedModules: ['M1', 'M2'], sac: null },
  { id: 's06', name: 'Frank Zhou', studentNo: 'S-24006', year: 11, school: 'Camberwell High (mock)', currentModule: 'M1', completedModules: [], sac: null },
];

// Weekly lesson template (reference data). day: 1 = Monday ... 5 = Friday.
// Group lessons share a teacher and room. Changes and attendance are facts, see seedLessonChanges.
const L = (id, studentId, day, start, end, teacher, room, mode = 'onsite') => ({ id, studentId, day, start, end, teacher, room, mode });
export const timetable = [
  L('L01', 's01', 2, '16:00', '18:00', 'Ms Park', 'Room A'),
  L('L02', 's01', 4, '16:00', '17:30', 'Ms Park', 'Room A'),
  L('L03', 's02', 2, '16:00', '17:00', 'Mr Singh', 'Online', 'online'),
  L('L04', 's03', 2, '16:30', '18:00', 'Ms Park', 'Room A'),
  L('L05', 's03', 5, '16:00', '18:00', 'Ms Park', 'Room A'),
  L('L06', 's04', 2, '16:00', '18:00', 'Mr Singh', 'Room B'),
  L('L07', 's05', 2, '16:00', '17:30', 'Ms Park', 'Room A'),
  L('L08', 's05', 3, '16:00', '17:30', 'Ms Park', 'Room A'),
  L('L09', 's06', 2, '17:00', '18:00', 'Mr Singh', 'Online', 'online'),
];
export const teachers = ['Ms Park', 'Mr Singh'];
export const rooms = ['Room A', 'Room B'];

// Proposed rules - every number is a demo default awaiting centre sign-off.
export const policy = {
  status: 'proposed',
  version: '0.2-demo',
  mastery: {
    window: 3,                    // most recent N valid evidence items per knowledge point
    minEvidence: 2,               // fewer => "insufficient evidence"
    notUnderstoodWRatio: 0.5,     // share of W in the window at or above which => "not understood"
    excludeC: true,               // C is shown separately, not counted toward mastery
    excludeBlank: true,           // Blank = not attempted, never converted to W
    multiKpWrong: 'primary-only', // a W on a multi-KP question only counts against kps[0]
  },
  bands: { green: 80, amber: 60 },
  passMark: 70,                   // suggestion only; the tutor decides on a Retest
  upload: { maxPages: 6, maxPageBytes: 3_000_000, maxTotalBytes: 12_000_000, maxLongEdge: 1600 },
  timetable: { shiftStart: '14:00', shiftEnd: '19:00', weekdaysOnly: true },
};

// ---- Seed facts (copied into IndexedDB on first run) ----

// D = DONE, W = wrong, C = careless, B = blank (confirmed not attempted).
const compact = [
  ['s01', 'T-M1', 1, '2026-09-08', 'DDDCDD'],
  ['s01', 'T-M2', 1, '2026-09-29', 'DDWDCD'],
  ['s02', 'T-M1', 1, '2026-09-15', 'DWWDBD'],
  ['s02', 'T-M1', 2, '2026-09-22', 'DDWDDD'],
  ['s03', 'T-M1', 1, '2026-08-25', 'DDDDDD'],
  ['s03', 'T-M2', 1, '2026-09-08', 'DDDDCD'],
  ['s03', 'T-M3', 1, '2026-09-29', 'DCDDWD'],
  ['s04', 'T-M1', 1, '2026-10-06', 'WDWWBB'],
  ['s05', 'T-M1', 1, '2026-09-01', 'DDCDCD'],
  ['s05', 'T-M2', 1, '2026-09-22', 'DCDCCD'],
];
const CODE = { D: 'DONE', W: 'W', C: 'C', B: 'BLANK' };

export const seedResults = compact.flatMap(([studentId, testId, attempt, date, marks]) => {
  const test = tests.find(t => t.id === testId);
  return [...marks].map((ch, i) => {
    const question = test.questions[i];
    const outcome = CODE[ch];
    return {
      id: `${studentId}|${testId}|${attempt}|${question.no}`,
      studentId, testId, attempt, qNo: question.no, outcome,
      score: outcome === 'DONE' ? question.marks : 0,
      markedBy: 'seed', markedAt: date, version: 'seed',
    };
  });
});

export const seedSubmissions = [
  { id: 'sub-101', studentId: 's04', testId: 'T-M1', suggestedAttempt: 2, submittedAt: '2026-10-12T19:40', source: 'seed', status: 'queued', pageCount: 0, check: 'not-checked' },
  { id: 'sub-102', studentId: 's01', testId: 'T-M3', suggestedAttempt: 1, submittedAt: '2026-10-12T21:05', source: 'seed', status: 'queued', pageCount: 0, check: 'not-checked' },
  { id: 'sub-104', studentId: 's06', testId: 'T-M1', suggestedAttempt: 1, submittedAt: '2026-10-13T10:30', source: 'seed', status: 'exception', pageCount: 0, check: 'not-checked',
    exception: 'Attachment missing - only page 1 uploaded' },
];

export const seedExamRecords = [
  { studentId: 's03', date: '2026-09-15', paper: 'VCAA 2023 Exam 1 (mock)', start: '16:00', endFirst: '16:52', endSecond: '17:00', checks: 1, score: 31, outOf: 40 },
  { studentId: 's03', date: '2026-10-06', paper: 'VCAA 2022 Exam 1 (mock)', start: '16:00', endFirst: '16:45', endSecond: '17:00', checks: 2, score: 35, outOf: 40 },
  { studentId: 's05', date: '2026-09-01', paper: 'Module 1 Test', start: '16:10', endFirst: '16:38', endSecond: '16:41', checks: 0, score: 14, outOf: 18 },
  { studentId: 's05', date: '2026-09-22', paper: 'Module 2 Test', start: '16:05', endFirst: '16:30', endSecond: '16:32', checks: 0, score: 11, outOf: 18 },
];

// Timetable change facts. Students request; a tutor decides (or changes directly, source 'staff').
// One pending request is in Chinese on purpose: messages from families often are.
const chg = (id, lessonId, studentId, date, kind, reason, extra) => ({
  id, occId: `${lessonId}|${date}`, lessonId, studentId, date, kind, to: null, reason, version: `cv-seed-${id}`, ...extra,
});
export const seedLessonChanges = [
  chg('lc-seed-1', 'L08', 's05', '2026-10-14', 'leave', 'School excursion to the Science Museum', {
    source: 'student', status: 'approved', requestedBy: 'Emily Liu', requestedAt: '2026-10-11T19:12:00',
    decidedBy: 'Ms Park', decidedAt: '2026-10-12T14:20:00', decisionNote: '',
    notice: { to: 'Ms Park', text: '[Timetable] Emily Liu: Wed 14 Oct 16:00-17:30 (Room A) is cancelled - student on leave. Reason: School excursion to the Science Museum' } }),
  chg('lc-seed-2', 'L02', 's01', '2026-10-15', 'online', '周四有点感冒，不想传染给同学，可以改成线上吗？', {
    source: 'student', status: 'pending', requestedBy: 'Amy Chen', requestedAt: '2026-10-13T09:05:00' }),
  chg('lc-seed-3', 'L05', 's03', '2026-10-16', 'reschedule', 'Friday clashes with a school SAC revision class', {
    to: { date: '2026-10-15', start: '16:00', end: '18:00' },
    source: 'student', status: 'pending', requestedBy: 'Chloe Wang', requestedAt: '2026-10-12T20:40:00' }),
];

// Mock data modelled on the brief's Exhibits 1-3. All names and records are fictional.
// Shape mirrors the planned Google Sheets "long table" so the views can later read from Sheets instead.

export const TODAY = '2026-10-13';

export const course = { id: 'MM12', name: 'VCE Mathematical Methods Units 1&2 (mock course)' };

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

// Question metadata: configured once per test, reused for every attempt.
// kps[0] is the primary knowledge point (see policy.mastery.multiKpWrong).
const q = (no, kps, marks) => ({ no, kps, marks });
export const tests = [
  { id: 'T-M1', moduleId: 'M1', name: 'Module 1 Test', version: 'v1', questions: [
    q(1, ['1.1'], 2), q(2, ['1.1'], 2), q(3, ['1.2'], 3), q(4, ['1.2', '1.1'], 3), q(5, ['1.3'], 4), q(6, ['1.3'], 4),
  ] },
  { id: 'T-M2', moduleId: 'M2', name: 'Module 2 Test', version: 'v1', questions: [
    q(1, ['2.1'], 2), q(2, ['2.1'], 2), q(3, ['2.2'], 3), q(4, ['2.2'], 3), q(5, ['2.3'], 4), q(6, ['2.3', '2.1'], 4),
  ] },
  { id: 'T-M3', moduleId: 'M3', name: 'Module 3 Test', version: 'v1', questions: [
    q(1, ['3.1'], 2), q(2, ['3.2'], 2), q(3, ['3.2'], 3), q(4, ['3.3'], 3), q(5, ['3.3'], 4), q(6, ['3.1', '3.2'], 4),
  ] },
];

export const students = [
  { id: 's01', name: 'Amy Chen', year: 11, currentModule: 'M3', completedModules: ['M1', 'M2'],
    demo: { M3: 'in-progress' }, sac: { date: '2026-10-20', title: 'SAC 2 - Polynomials', moduleIds: ['M2', 'M3'] } },
  { id: 's02', name: 'Ben Li', year: 11, currentModule: 'M2', completedModules: ['M1'],
    demo: { M2: 'passed' }, sac: null },
  { id: 's03', name: 'Chloe Wang', year: 11, currentModule: 'M4', completedModules: ['M1', 'M2', 'M3'],
    demo: { M4: 'in-progress' }, sac: { date: '2026-10-21', title: 'SAC 2 - Functions', moduleIds: ['M3', 'M4'] } },
  { id: 's04', name: 'Daniel Zhang', year: 11, currentModule: 'M2', completedModules: ['M1'],
    demo: { M2: 'not-started' }, sac: null },
  { id: 's05', name: 'Emily Liu', year: 11, currentModule: 'M3', completedModules: ['M1', 'M2'],
    demo: { M3: 'in-progress' }, sac: null },
  { id: 's06', name: 'Frank Zhou', year: 11, currentModule: 'M1', completedModules: [],
    demo: { M1: 'in-progress' }, sac: null },
];

// Result long table, written compactly: one string char per question.
// D = DONE (correct), W = wrong, C = careless error, B = blank (confirmed not attempted).
// A question with no row at all is "not entered" - a different state from B.
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

export const results = compact.flatMap(([studentId, testId, attempt, date, marks]) => {
  const test = tests.find(t => t.id === testId);
  return [...marks].map((ch, i) => {
    const question = test.questions[i];
    const outcome = CODE[ch];
    return {
      studentId, testId, attempt, qNo: question.no, outcome,
      score: outcome === 'DONE' ? question.marks : 0,
      markedBy: 'tutor', markedAt: date, source: 'mock',
    };
  });
});

// Submissions pulled from Google Classroom (mocked). Re-submission != new attempt: attempt is set by the tutor.
export const submissions = [
  { id: 'sub-101', studentId: 's04', testId: 'T-M1', attempt: 2, submittedAt: '2026-10-12 19:40', source: 'Classroom (mock)', status: 'queued' },
  { id: 'sub-102', studentId: 's01', testId: 'T-M3', attempt: 1, submittedAt: '2026-10-12 21:05', source: 'Classroom (mock)', status: 'queued' },
  { id: 'sub-103', studentId: 's02', testId: 'T-M2', attempt: 1, submittedAt: '2026-10-13 09:12', source: 'Classroom (mock)', status: 'queued' },
  { id: 'sub-104', studentId: 's06', testId: 'T-M1', attempt: 1, submittedAt: '2026-10-13 10:30', source: 'Classroom (mock)', status: 'exception', exception: 'Attachment missing - only page 1 uploaded' },
];

export const timetable = [
  { studentId: 's01', teacher: 'Ms Park', time: '16:00-18:00', room: 'Room A', mode: 'onsite', status: 'checked-in' },
  { studentId: 's02', teacher: 'Mr Singh', time: '16:00-17:00', room: '-', mode: 'online', status: 'expected' },
  { studentId: 's03', teacher: 'Ms Park', time: '16:30-18:00', room: 'Room A', mode: 'onsite', status: 'expected' },
  { studentId: 's04', teacher: 'Mr Singh', time: '16:00-18:00', room: 'Room B', mode: 'onsite', status: 'change-requested' },
  { studentId: 's05', teacher: 'Ms Park', time: '16:00-17:30', room: 'Room A', mode: 'onsite', status: 'checked-in' },
  { studentId: 's06', teacher: 'Mr Singh', time: '17:00-18:00', room: '-', mode: 'online', status: 'expected' },
];

// Messages are pasted in by the tutor (WeCom external-contact read access is unverified).
export const messages = [
  { id: 'm1', studentId: 's04', from: 'Parent of Daniel', role: 'parent', receivedAt: '13:05',
    text: '老师您好，Daniel今天发烧了，下午的课可以改成线上吗？如果不行就请假一次，谢谢！', status: 'new' },
  { id: 'm2', studentId: 's01', from: 'Amy Chen', role: 'student', receivedAt: '13:20',
    text: "Hi, can I book a Q&A on Thursday? I'm stuck on factor theorem questions for my SAC.", status: 'new' },
  { id: 'm3', studentId: 's05', from: 'Parent of Emily', role: 'parent', receivedAt: '13:42',
    text: '想了解一下Emily最近模块测试的情况，她说总是粗心丢分。', status: 'new' },
  { id: 'm4', studentId: 's02', from: 'Ben Li', role: 'student', receivedAt: '14:01',
    text: 'is my module 2 test marked yet?', status: 'new' },
  { id: 'm5', studentId: 's03', from: 'Parent of Chloe', role: 'parent', receivedAt: '14:10',
    text: 'Chloe下周三SAC，能不能多安排一次答疑？', status: 'new' },
];

// Scenario C step 5: student self-recorded exam data.
export const examRecords = [
  { studentId: 's03', date: '2026-09-15', paper: 'VCAA 2023 Exam 1 (mock)', start: '16:00', end1: '16:52', end2: '17:00', checks: 1, score: 31, outOf: 40 },
  { studentId: 's03', date: '2026-10-06', paper: 'VCAA 2022 Exam 1 (mock)', start: '16:00', end1: '16:45', end2: '17:00', checks: 2, score: 35, outOf: 40 },
  { studentId: 's05', date: '2026-09-01', paper: 'Module 1 Test', start: '16:10', end1: '16:38', end2: '16:41', checks: 0, score: 14, outOf: 18 },
  { studentId: 's05', date: '2026-09-22', paper: 'Module 2 Test', start: '16:05', end1: '16:30', end2: '16:32', checks: 0, score: 11, outOf: 18 },
];

// Q&A sessions logged today; "confirmed" = tutor confirmed the count on the student card.
export const qaLog = [
  { studentId: 's01', requests: 3, questions: 3, confirmed: true },
  { studentId: 's05', requests: 2, questions: 2, confirmed: false },
];

// Proposed rules - every number here is a demo default awaiting centre sign-off.
export const policy = {
  status: 'proposed',
  version: '0.1-demo',
  mastery: {
    window: 3,                    // most recent N valid evidence items per knowledge point
    minEvidence: 2,               // fewer than this => "insufficient evidence"
    excludeC: true,               // C (careless) is shown separately, not counted toward mastery
    excludeBlank: true,           // BLANK is "not attempted", never converted to W
    multiKpWrong: 'primary-only', // a W on a multi-KP question only counts against kps[0]
  },
  bands: { green: 80, amber: 60 }, // Exhibit 3 colour bands, percent
  passMark: 70,                    // used only to *suggest* a Retest; the tutor decides
  followUp: { wRate: 0.34, cCount: 2, sacWindowDays: 10 },
};

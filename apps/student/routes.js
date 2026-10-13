// Route table for the student app. owner: A = framework + test/marking/feedback, B = everything else.
const STUDENT = ['student'];
const ph = spec => () => import('../../packages/ui/placeholder.js').then(m => m.placeholder(spec));

export const routes = [
  { id: 'home', label: 'Home', icon: 'home', owner: 'A', roles: STUDENT, nav: true, load: () => import('./pages/home.js') },
  { id: 'upload', label: 'Upload test', icon: 'upload', owner: 'A', roles: STUDENT, nav: true, load: () => import('./pages/upload.js') },
  { id: 'mistakes', label: 'Mistake bank', icon: 'notebook', owner: 'A', roles: STUDENT, nav: true, load: () => import('./pages/mistakes.js') },
  { id: 'progress', label: 'My progress', icon: 'chart-line', owner: 'A', roles: STUDENT, nav: true, load: () => import('./pages/progress.js') },
  { id: 'exam-log', label: 'Exam log', icon: 'stopwatch', owner: 'A', roles: STUDENT, load: () => import('./pages/exam-log.js') },
  { id: 'timetable', label: 'Timetable', icon: 'calendar', owner: 'B', roles: STUDENT, load: ph({
    title: 'Timetable', owner: 'B', points: ['Weekly lessons (on-site / online)', 'Q&A sessions you booked'] }) },
  { id: 'qa', label: 'Book Q&A', icon: 'help-circle', owner: 'B', roles: STUDENT, load: ph({
    title: 'Book a Q&A session', owner: 'B', points: ['Pick a free slot', 'Say which question and where you are stuck'] }) },
  { id: 'hints', label: 'Study hints', icon: 'bulb', owner: 'B', roles: STUDENT, load: ph({
    title: 'Study hints', owner: 'B', points: ['Only available when your tutor turns on study mode', 'Locked during Demo, tests and mock exams'] }) },
];

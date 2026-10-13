// Route table for the staff app. owner: A = framework + test/marking/feedback, B = everything else.
// B pages start as placeholders; replace `load` with the real page module when it is ready.
const STAFF = ['tutor', 'manager'];
const MANAGER = ['manager'];
const ph = spec => () => import('../../packages/ui/placeholder.js').then(m => m.placeholder(spec));

export const routes = [
  { id: 'home', label: 'Home', icon: 'home', owner: 'A', roles: STAFF, nav: true, load: () => import('./pages/home.js') },
  { id: 'timetable', label: 'Timetable', icon: 'calendar-event', owner: 'A', roles: STAFF, nav: true, load: () => import('./pages/timetable.js') },
  { id: 'marking', label: 'Marking', icon: 'checkbox', owner: 'A', roles: STAFF, nav: true, load: () => import('./pages/marking.js') },
  { id: 'records', label: 'Records', icon: 'table', owner: 'A', roles: STAFF, nav: true, load: () => import('./pages/records.js') },
  { id: 'corrections', label: 'Corrections', icon: 'pencil-check', owner: 'A', roles: STAFF, nav: true, load: () => import('./pages/corrections.js') },
  { id: 'review', label: 'Exam review', icon: 'report-analytics', owner: 'A', roles: STAFF, load: ph({
    title: 'Exam review & targeted practice', step: '9C', owner: 'A',
    points: ['Self-recorded exam data trends (first pass, second pass, checks, score)', 'AI-drafted review per exam, tutor confirms causes and next step', 'Draft targeted practice from W topics; tutor edits before assigning'] }) },

  { id: 'briefings', label: 'Briefings', icon: 'id-badge-2', owner: 'B', roles: STAFF, load: ph({
    title: 'Student briefings', step: '4', owner: 'B', prototype: 'students.js',
    points: ['Fact card per student from records', 'Upcoming SAC and module gaps', 'AI plan suggestion, tutor adjusts after talking (step 5)'] }) },
  { id: 'students', label: 'Students', icon: 'users', owner: 'B', roles: STAFF, load: ph({
    title: 'Student management', step: '9A/B', owner: 'B',
    points: ['Profiles and parent contacts', 'Current module and Demo checks (tutor decides)', 'SAC dates and scope'] }) },
  { id: 'messages', label: 'Messages', icon: 'message-circle', owner: 'B', roles: STAFF, nav: true, load: ph({
    title: 'Messages', step: '6-7', owner: 'B', prototype: 'messages.js',
    points: ['Paste a WeCom message', 'AI triage and draft reply (uses ctx.api AI wrapper)', 'Schedule-change approval and internal notice'] }) },
  { id: 'report', label: 'Daily report', icon: 'clipboard-list', owner: 'B', roles: STAFF, nav: true, load: ph({
    title: 'Daily report', step: 'Phase 5', owner: 'B', prototype: 'report.js',
    points: ['Auto-counted facts (counts come from the derive engine)', 'Rule-based follow-up nominations, tutor confirms', 'Manager sign-off'] }) },
  { id: 'parent-report', label: 'Parent reports', icon: 'mail', owner: 'B', roles: STAFF, load: ph({
    title: 'Parent weekly reports', owner: 'B', points: ['Draft from confirmed records', 'Tutor edits and sends manually'] }) },
  { id: 'policy', label: 'Policy', icon: 'scale', owner: 'B', roles: MANAGER, load: ph({
    title: 'Policy approval', owner: 'B', prototype: 'policy.js',
    points: ['Review proposed rules', 'Approve a version (proposed → approved)'] }) },
  { id: 'ai-quality', label: 'AI quality', icon: 'chart-dots', owner: 'B', roles: MANAGER, load: ph({
    title: 'AI quality', owner: 'B', points: ['Agreement between AI suggestions and tutor decisions', 'Rate of "AI said correct, tutor said wrong"'] }) },
];

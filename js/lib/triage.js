// STUB: keyword rules standing in for the LLM triage step (steps 6-7).
// The real version returns the same shape; the tutor always confirms before anything is written or sent.

const RULES = [
  { category: 'schedule-change', label: 'Leave / online / reschedule', words: ['请假', '线上', '改课', '发烧', 'leave', 'online', 'reschedule', 'sick'] },
  { category: 'qa-booking', label: 'Q&A booking', words: ['答疑', 'q&a', 'book', 'stuck'] },
  { category: 'status-query', label: 'Test / homework status', words: ['marked', '批改', '成绩', 'result'] },
  { category: 'parent-feedback', label: 'Parent progress request', words: ['了解', '情况', '粗心', 'progress', 'how is'] },
];

export function triage(message) {
  const text = message.text.toLowerCase();
  const hits = RULES.filter(r => r.words.some(w => text.includes(w)));
  const primary = hits[0] || { category: 'other', label: 'Other / needs reading' };
  const ambiguous = /如果不行|或者|\bor\b/.test(message.text);
  return {
    category: primary.category,
    label: primary.label,
    alsoMentions: hits.slice(1).map(h => h.label),
    ambiguous,
    needsTutor: true,
    source: 'stub-rules',
  };
}

import type { Attempt } from '../../../packages/contract/src/index.js';
import type { State } from './state.js';
import { requireCondition } from './errors.js';

export function assertUnique(ids: string[], label: string) {
  requireCondition(new Set(ids).size === ids.length, 'DUPLICATE_ID', `${label} contains duplicate IDs`);
}
export function validateAttempt(attempt: Attempt, state: State) {
  requireCondition(state.students[attempt.studentId], 'UNKNOWN_STUDENT', `Unknown student: ${attempt.studentId}`);
  const exam = state.exams[attempt.examId];
  requireCondition(exam, 'UNKNOWN_EXAM', `Unknown exam: ${attempt.examId}`);
  assertUnique(attempt.marks.map(m => m.questionId), 'marks');
  requireCondition(attempt.marks.length === exam.questions.length, 'INCOMPLETE_MARKS', 'Supply one explicit result for every question, including BLANK');
  requireCondition(Date.parse(attempt.markedAt) >= Date.parse(attempt.completedAt), 'INVALID_TIME_ORDER', 'markedAt must not precede completedAt');
  for (const question of exam.questions) {
    const mark = attempt.marks.find(m => m.questionId === question.id);
    requireCondition(mark, 'INCOMPLETE_MARKS', `Missing question: ${question.id}`);
    requireCondition(mark.score <= question.maxScore, 'INVALID_SCORE', `Score exceeds maximum for ${question.id}`);
    requireCondition(mark.outcome !== 'DONE' || mark.score === question.maxScore, 'INVALID_SCORE', 'DONE requires full marks');
    requireCondition(mark.outcome !== 'BLANK' || mark.score === 0, 'INVALID_SCORE', 'BLANK requires zero marks');
    requireCondition(!['W', 'C'].includes(mark.outcome) || mark.score < question.maxScore, 'INVALID_SCORE', 'W/C must be below full marks');
  }
}
export function validateReferences(state: State) {
  for (const exam of Object.values(state.exams)) {
    assertUnique(exam.questions.map(q => q.id), 'exam.questions');
    for (const question of exam.questions) {
      assertUnique(question.knowledgePointIds, 'knowledgePointIds');
      for (const id of question.knowledgePointIds) {
        requireCondition(state.knowledgePoints[id]?.moduleId === exam.moduleId, 'UNKNOWN_KNOWLEDGE_POINT', `Knowledge point ${id} must exist in exam module ${exam.moduleId}`);
      }
    }
  }
  for (const attempt of Object.values(state.attempts)) validateAttempt(attempt, state);
  for (const observation of Object.values(state.masteryObservations)) {
    requireCondition(state.students[observation.studentId] && state.knowledgePoints[observation.knowledgePointId],
      'UNKNOWN_REFERENCE', 'Mastery observation requires an existing student and knowledge point');
  }
  for (const activity of Object.values(state.activities)) requireCondition(state.students[activity.studentId], 'UNKNOWN_STUDENT', 'Activity student does not exist');
  for (const resource of Object.values(state.resources)) {
    assertUnique(resource.knowledgePointIds, 'resource.knowledgePointIds');
    for (const id of resource.knowledgePointIds) requireCondition(state.knowledgePoints[id], 'UNKNOWN_KNOWLEDGE_POINT', 'Resource knowledge point does not exist');
  }
}

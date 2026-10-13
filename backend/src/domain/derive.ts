import type { Evidence, FollowUp, ProgressRow, Projections } from '../../../packages/contract/src/index.js';
import type { State, StoredAttempt } from './state.js';

const time = (value: string) => Date.parse(value);
const compare = (a: StoredAttempt, b: StoredAttempt) => time(a.completedAt) - time(b.completedAt) || a.id.localeCompare(b.id);

/** Pure, deterministic derivation. No I/O, clocks, UI, or model calls. */
export function derive(state: State): Projections {
  const policy = state.policies[state.activePolicy]!;
  const policyVersion = policy.version;
  const result: Projections = { marking: [], progress: [], examStatistics: [], followUps: [] };
  const attempts = Object.values(state.attempts).sort(compare);
  const latest = new Map<string, StoredAttempt>();
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    const exam = state.exams[attempt.examId]!;
    const key = `${attempt.studentId}/${attempt.examId}`;
    latest.set(key, attempt);
    const attemptNumber = (counts.get(key) ?? 0) + 1;
    counts.set(key, attemptNumber);
    let score = 0;
    let maxScore = 0;
    for (const question of exam.questions) {
      const mark = attempt.marks.find(m => m.questionId === question.id)!;
      score += mark.score;
      maxScore += question.maxScore;
      result.marking.push({ attemptId: attempt.id, questionId: question.id, revision: attempt.revision,
        studentId: attempt.studentId, examId: exam.id, knowledgePointIds: question.knowledgePointIds,
        outcome: mark.outcome, score: mark.score, maxScore: question.maxScore,
        feedback: mark.feedback, studentAnswer: mark.studentAnswer,
        source: attempt.source, importId: attempt.importId, policyVersion });
    }
    const ratio = score / maxScore;
    result.examStatistics.push({ attemptId: attempt.id, studentId: attempt.studentId, examId: exam.id,
      moduleId: exam.moduleId, kind: exam.kind, attemptNumber, score, maxScore, ratio,
      band: ratio >= policy.highScoreMinRatio ? 'high' : ratio >= policy.mediumScoreMinRatio ? 'medium' : 'low',
      completedAt: attempt.completedAt, markedAt: attempt.markedAt, revision: attempt.revision, policyVersion });
  }
  const currentIds = new Set([...latest.values()].map(a => a.id));
  for (const student of Object.values(state.students).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const kp of Object.values(state.knowledgePoints).sort((a, b) => a.id.localeCompare(b.id))) {
      const rows = result.marking.filter(r => r.studentId === student.id && currentIds.has(r.attemptId) && r.knowledgePointIds.includes(kp.id));
      const evidence: Evidence[] = rows.map(r => ({ attemptId: r.attemptId, questionId: r.questionId, revision: r.revision }));
      // BLANK is known unattempted work, not evidence that the topic has never been taught.
      const attempted = rows.filter(r => r.outcome !== 'BLANK');
      const ratio = attempted.length ? attempted.reduce((sum, r) => sum + r.score / r.knowledgePointIds.length, 0) /
        attempted.reduce((sum, r) => sum + r.maxScore / r.knowledgePointIds.length, 0) : null;
      const newestEvidence = Math.max(0, ...rows.map(r => time(state.attempts[r.attemptId]!.markedAt)));
      const observation = Object.values(state.masteryObservations)
        .filter(o => o.studentId === student.id && o.knowledgePointId === kp.id)
        .sort((a, b) => time(b.assessedAt) - time(a.assessedAt) || b.id.localeCompare(a.id))[0];
      const progress: ProgressRow = { studentId: student.id, knowledgePointId: kp.id,
        mastery: null, ratio, evidence, reason: 'insufficient_evidence', policyVersion };
      if (observation && time(observation.assessedAt) >= newestEvidence) {
        progress.mastery = observation.mastery;
        progress.observationId = observation.id;
        progress.reason = 'explicit_observation';
      } else if (attempted.length >= policy.minimumEvidence && ratio !== null) {
        const onlyCareless = attempted.every(r => r.outcome === 'DONE' || r.outcome === 'C');
        progress.mastery = ratio >= policy.masteredMinRatio ? 'mastered' :
          onlyCareless || ratio >= policy.partialMinRatio ? 'partial' : 'not_understood';
        progress.reason = onlyCareless && ratio < policy.partialMinRatio ? 'careless_errors' : 'policy_inference';
      }
      result.progress.push(progress);
      const rules: { kind: FollowUp['kind']; outcome: string; instruction: string }[] = [
        { kind: 'concept_review', outcome: 'W', instruction: `复习「${kp.name}」的解题步骤，并完成同类练习。` },
        { kind: 'careless_check', outcome: 'C', instruction: `对「${kp.name}」使用检查清单，复查符号、计算和单位。` },
        { kind: 'finish_questions', outcome: 'BLANK', instruction: `完成「${kp.name}」的未作答题，再检查掌握情况。` },
      ];
      for (const rule of rules) {
        const matches = rows.filter(r => r.outcome === rule.outcome);
        if (!matches.length) continue;
        result.followUps.push({ id: `${student.id}/${kp.id}/${rule.kind}`, studentId: student.id,
          knowledgePointId: kp.id, kind: rule.kind, instruction: rule.instruction,
          evidence: matches.map(r => ({ attemptId: r.attemptId, questionId: r.questionId, revision: r.revision })),
          resourceIds: Object.values(state.resources).filter(r => r.knowledgePointIds.includes(kp.id)).map(r => r.id).sort(), policyVersion });
      }
    }
  }
  return result;
}

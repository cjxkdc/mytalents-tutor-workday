// Pure functions: facts in, derived views out. No I/O, so the real backend can reuse them as-is.
// Exhibit 1 (marking sheet), Exhibit 2 (progress heat-map), Exhibit 3 (exam statistics), mistake bank.

export function indexReference({ modules, tests }) {
  const kpIndex = {};
  for (const m of modules) for (const kp of m.kps) kpIndex[kp.id] = { ...kp, moduleId: m.id };
  const testIndex = Object.fromEntries(tests.map(t => [t.id, t]));
  return { kpIndex, testIndex };
}

const byDateDesc = (a, b) => b.markedAt.localeCompare(a.markedAt) || b.attempt - a.attempt || a.qNo - b.qNo;

export function attemptsOf(results, studentId, testId) {
  return [...new Set(results.filter(r => r.studentId === studentId && r.testId === testId).map(r => r.attempt))].sort((a, b) => a - b);
}

export function attemptScore(results, test, studentId, attempt) {
  const rows = results.filter(r => r.studentId === studentId && r.testId === test.id && r.attempt === attempt);
  const total = test.questions.reduce((s, q) => s + q.marks, 0);
  const score = rows.reduce((s, r) => s + r.score, 0);
  const pct = total ? Math.round((score / total) * 100) : 0;
  return { score, total, pct, entered: rows.length, questions: test.questions.length };
}

export function band(pct, policy) {
  if (pct >= policy.bands.green) return 'green';
  if (pct >= policy.bands.amber) return 'amber';
  return 'red';
}

// Exhibit 1
export function markingSheet(results, { testIndex }) {
  const groups = new Map();
  for (const r of results) {
    const key = `${r.studentId}|${r.testId}|${r.attempt}`;
    if (!groups.has(key)) groups.set(key, { studentId: r.studentId, testId: r.testId, attempt: r.attempt, markedAt: r.markedAt, cells: {} });
    const g = groups.get(key);
    g.cells[r.qNo] = r;
    if (r.markedAt > g.markedAt) g.markedAt = r.markedAt;
  }
  return [...groups.values()]
    .map(g => ({ ...g, ...attemptScore(results, testIndex[g.testId], g.studentId, g.attempt) }))
    .sort((a, b) => a.studentId.localeCompare(b.studentId) || a.testId.localeCompare(b.testId) || a.attempt - b.attempt);
}

// Exhibit 3: latest attempt per student x test
export function examStats(results, students, tests, policy) {
  return students.map(s => ({
    studentId: s.id,
    tests: Object.fromEntries(tests.map(t => {
      const attempts = attemptsOf(results, s.id, t.id);
      if (!attempts.length) return [t.id, null];
      const latest = attempts[attempts.length - 1];
      const sc = attemptScore(results, t, s.id, latest);
      return [t.id, { attempts: attempts.length, latest, ...sc, band: band(sc.pct, policy) }];
    })),
  }));
}

// Exhibit 2: evidence behind one heat-map cell
export function evidenceFor(results, studentId, kpId, { testIndex }, policy) {
  const items = [];
  for (const r of results) {
    if (r.studentId !== studentId) continue;
    const question = testIndex[r.testId]?.questions.find(x => x.no === r.qNo);
    if (!question || !question.kps.includes(kpId)) continue;
    const isPrimary = question.kps[0] === kpId;
    let counts = true;
    let why = '';
    if (r.outcome === 'C' && policy.mastery.excludeC) { counts = false; why = 'C shown separately'; }
    if (r.outcome === 'BLANK' && policy.mastery.excludeBlank) { counts = false; why = 'Blank = not attempted'; }
    if (r.outcome === 'W' && !isPrimary && policy.mastery.multiKpWrong === 'primary-only') { counts = false; why = 'W not applied to secondary point'; }
    items.push({ ...r, counts, why });
  }
  return items.sort(byDateDesc);
}

export function masteryCell(results, student, kpId, ref, policy) {
  const evidence = evidenceFor(results, student.id, kpId, ref, policy);
  const valid = evidence.filter(e => e.counts).slice(0, policy.mastery.window);
  const validIds = new Set(valid.map(v => v.id));
  for (const e of evidence) e.inWindow = validIds.has(e.id);
  const cCount = evidence.filter(e => e.outcome === 'C').length;
  const covered = [...student.completedModules, student.currentModule].includes(ref.kpIndex[kpId].moduleId);
  let status;
  if (!covered && !evidence.length) status = 'not-covered';
  else if (valid.length < policy.mastery.minEvidence) status = 'insufficient';
  else {
    const w = valid.filter(e => e.outcome === 'W').length;
    if (w === 0) status = 'mastered';
    else if (w / valid.length >= policy.mastery.notUnderstoodWRatio) status = 'not-understood';
    else status = 'partial';
  }
  return { status, evidence, cCount };
}

export function progressRow(results, student, modules, ref, policy) {
  const cells = {};
  const counts = {};
  for (const m of modules) for (const kp of m.kps) {
    const c = masteryCell(results, student, kp.id, ref, policy);
    cells[kp.id] = { status: c.status, cCount: c.cCount };
    counts[c.status] = (counts[c.status] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pct = k => Math.round(((counts[k] || 0) / total) * 100);
  return { studentId: student.id, cells, summary: { mastered: pct('mastered'), partial: pct('partial'), notUnderstood: pct('not-understood') } };
}

// Mistake bank: every W and C result, newest first, with correction status.
export function mistakes(results, studentId, { testIndex, kpIndex }, corrections) {
  const corr = Object.fromEntries(corrections.map(c => [c.id, c]));
  return results
    .filter(r => r.studentId === studentId && (r.outcome === 'W' || r.outcome === 'C'))
    .sort(byDateDesc)
    .map(r => {
      const test = testIndex[r.testId];
      const question = test.questions.find(x => x.no === r.qNo);
      const c = corr[r.id];
      return {
        id: r.id, resultVersion: r.version, type: r.outcome, testId: r.testId, testName: test.name, attempt: r.attempt, qNo: r.qNo,
        marks: question.marks, markedAt: r.markedAt,
        kps: question.kps.map(k => ({ id: k, name: kpIndex[k].name })),
        correction: c
          ? { status: c.status, version: c.version, note: c.note, tutorNote: c.tutorNote || '', submittedAt: c.submittedAt, confirmedAt: c.confirmedAt || null }
          : { status: 'open' },
      };
    });
}

export function nextAttempt(results, studentId, testId) {
  const a = attemptsOf(results, studentId, testId);
  return a.length ? a[a.length - 1] + 1 : 1;
}

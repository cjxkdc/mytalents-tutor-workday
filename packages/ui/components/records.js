// Shared record components used by both apps: outcome cells, heat-map, evidence table, mistake list.
import { esc, chip } from './html.js';

export const OUTCOME_LABEL = { DONE: 'DONE', W: 'W', C: 'C', BLANK: 'Blank' };
export const MASTERY_LABEL = {
  'mastered': 'Completely mastered',
  'partial': 'Partially mastered',
  'not-understood': 'Not understood',
  'not-covered': 'Not yet covered',
  'insufficient': 'Insufficient evidence',
};

export const outcomeCell = r => r
  ? `<td class="oc oc-${r.outcome}">${OUTCOME_LABEL[r.outcome]}</td>`
  : '<td class="oc oc-none" title="Not entered">-</td>';

export const legend = () => `<div class="legend">${Object.entries(MASTERY_LABEL)
  .map(([k, v]) => `<span><i class="sw ms-${k}"></i>${v}</span>`).join('')}<span><span class="cdot">C</span> careless marks recorded</span></div>`;

// rows: [{ studentId, label, cells: { kpId: { status, cCount } }, summary }]
export function heatmap(modules, rows, selected) {
  const kps = modules.flatMap(m => m.kps);
  return `${legend()}<div class="table-wrap"><table class="heat">
    <thead>
      <tr><th></th>${modules.map(m => `<th colspan="${m.kps.length}">${esc(m.id)} ${esc(m.name)}</th>`).join('')}<th>Mastered</th></tr>
      <tr><th>Student</th>${kps.map(k => `<th title="${esc(k.name)}">${esc(k.id)}</th>`).join('')}<th></th></tr>
    </thead>
    <tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td>${kps.map(k => {
      const c = r.cells[k.id];
      const sel = selected && selected.studentId === r.studentId && selected.kpId === k.id;
      return `<td class="hm ms-${c.status}${sel ? ' sel' : ''}" data-cell="${esc(r.studentId)}|${esc(k.id)}" tabindex="0" role="button"
        aria-label="${esc(r.label)} ${esc(k.id)} ${esc(k.name)}: ${MASTERY_LABEL[c.status]}${c.cCount ? `, ${c.cCount} careless` : ''}">${c.cCount ? '<span class="cdot">C</span>' : ''}</td>`;
    }).join('')}<td>${r.summary.mastered}%</td></tr>`).join('')}</tbody>
  </table></div>`;
}

export function bindHeatmap(el, onPick) {
  el.querySelectorAll('[data-cell]').forEach(td => {
    const pick = () => { const [s, k] = td.dataset.cell.split('|'); onPick(s, k); };
    td.addEventListener('click', pick);
    td.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
}

export function evidenceTable(cell, policy) {
  if (!cell.evidence.length) return '<p class="muted">No evidence recorded yet.</p>';
  const m = policy.mastery;
  const rules = [`latest ${m.window} valid items, at least ${m.minEvidence}`];
  if (m.excludeC) rules.push('C excluded');
  if (m.excludeBlank) rules.push('Blank excluded');
  if (m.multiKpWrong === 'primary-only') rules.push('W counts only on the primary knowledge point');
  return `<p class="muted">Rule: ${rules.join('; ')}.</p>
  <div class="table-wrap"><table><thead><tr><th>Date</th><th>Test</th><th>Q</th><th>Mark</th><th>Counted</th></tr></thead><tbody>
  ${cell.evidence.map(e => `<tr><td>${esc(e.markedAt)}</td><td>${esc(e.testId)} #${e.attempt}</td><td>${e.qNo}</td>${outcomeCell(e)}
    <td>${e.counts ? (e.inWindow ? 'Yes' : 'Outside window') : esc(e.why)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

const CORR = {
  'open': ['Not corrected', ''],
  'submitted': ['Waiting for tutor', 'info'],
  'needs-work': ['Needs more work', 'warn'],
  'confirmed': ['Correction confirmed', 'good'],
};
export const correctionChip = status => chip(...(CORR[status] || [status, '']));

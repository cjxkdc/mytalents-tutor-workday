export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const chip = (text, tone = 'neutral') => `<span class="chip chip-${tone}">${esc(text)}</span>`;

export const OUTCOME_LABEL = { DONE: 'DONE', W: 'W', C: 'C', BLANK: 'Blank' };
export const outcomeCell = r => r
  ? `<td class="oc oc-${r.outcome}" title="${esc(r.outcome)}">${OUTCOME_LABEL[r.outcome]}</td>`
  : '<td class="oc oc-none" title="Not entered">-</td>';

export const MASTERY_LABEL = {
  'mastered': 'Completely mastered',
  'partial': 'Partially mastered',
  'not-understood': 'Not understood',
  'not-covered': 'Not yet covered',
  'insufficient': 'Insufficient evidence',
};

export const banner = (text, tone = 'info') => `<div class="banner banner-${tone}">${text}</div>`;
export const proposedBanner = () => banner('<strong>Proposed policy</strong> - demo rules, requires centre sign-off. See <a href="#/policy">Policy</a>.', 'warn');

export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

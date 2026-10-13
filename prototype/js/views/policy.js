// Every rule the system applies, in one place, marked as proposed until the centre approves it.
import * as store from '../lib/store.js';
import { esc, chip, proposedBanner } from '../lib/ui.js';

export function render(el) {
  const p = store.policy;
  const rows = [
    ['Mastery window', `${p.mastery.window} most recent valid items per knowledge point`, 'Exhibit 2'],
    ['Minimum evidence', `${p.mastery.minEvidence} items, otherwise "insufficient evidence"`, 'Exhibit 2'],
    ['Careless (C)', p.mastery.excludeC ? 'Shown separately, not counted toward mastery' : 'Counted', 'Exhibit 2'],
    ['Blank', p.mastery.excludeBlank ? 'Not attempted - never converted to W' : 'Counted as W', 'Exhibits 1-2'],
    ['W on multi-KP question', p.mastery.multiKpWrong === 'primary-only' ? 'Counts only against the primary knowledge point' : 'All listed points', 'Exhibit 2'],
    ['Score bands', `green ≥ ${p.bands.green}%, amber ≥ ${p.bands.amber}%`, 'Exhibit 3'],
    ['Retest suggestion', `latest attempt < ${p.passMark}% - suggestion only, tutor decides`, 'Follow-up'],
    ['Careless follow-up', `≥ ${p.followUp.cCount} C marks in one test`, 'Follow-up'],
    ['SAC gap window', `SAC within ${p.followUp.sacWindowDays} days with incomplete modules`, 'Follow-up'],
  ];
  el.innerHTML = `
    <h1>Policy ${chip(p.status, 'warn')} <span class="muted">v${esc(p.version)}</span></h1>
    ${proposedBanner()}
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>Rule</th><th>Current value</th><th>Used in</th></tr></thead>
      <tbody>${rows.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody>
    </table></div></section>
    <section class="card">
      <h2>Never automated</h2>
      <ul class="plain">
        <li>Passing a Demo / moving to the Module Test</li>
        <li>Scheduling a Retest or other next steps</li>
        <li>Final scores and W / C labels</li>
        <li>Messages sent to parents</li>
        <li>Approving schedule changes</li>
        <li>Manager sign-off</li>
      </ul>
    </section>`;
}

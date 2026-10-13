// Placeholder for a page that has not been built yet. Shows owner and scope so the shell is complete.
import { esc, chip } from './components/html.js';

export function placeholder({ title, step, owner, points = [], prototype }) {
  return {
    render(el) {
      el.innerHTML = `
        <div class="page-head">
          <h1>${esc(title)}</h1>
          <p class="lede">${step ? `Brief step ${esc(step)} · ` : ''}Owner ${chip(owner, owner === 'A' ? 'info' : 'warn')}</p>
        </div>
        <section class="card"><div class="card-body">
          <div class="placeholder">
            <p><strong>Not built yet.</strong> Planned scope:</p>
            <ul>${points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
            ${prototype ? `<p>Earlier prototype for reference: <a href="/prototype/index.html" target="_blank" rel="noopener">prototype</a> (<code>prototype/js/views/${esc(prototype)}</code>).</p>` : ''}
            <p class="muted">Build it as a page module exporting <code>render(el, params, ctx)</code> - see packages/contract/CONTRACT.md.</p>
          </div>
        </div></section>`;
    },
  };
}

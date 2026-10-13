// My progress: personal heat-map row with evidence, and test results. Owner A.
import { esc, errorBanner, proposedPolicy, requestGate } from '../../../packages/ui/components/html.js';
import { heatmap, bindHeatmap, evidenceTable, MASTERY_LABEL } from '../../../packages/ui/components/records.js';

export function render(el, params, ctx) {
  let pick = null;
  el.innerHTML = `
    <div class="page-head"><h1>My progress</h1><p class="lede">Built from your marked tests. Select a square to see which questions it is based on.</p></div>
    <div id="kpis" class="kpis"></div>
    <section class="card"><div class="card-head"><h2>Knowledge points</h2></div><div class="card-body" id="heat"><div class="loading">Loading…</div></div></section>
    <section class="card"><div class="card-head"><h2>Tests</h2></div><div class="card-body" id="tests"></div></section>`;
  const heat = el.querySelector('#heat');

  const gate = requestGate(ctx.signal);
  async function load() {
    const current = gate();
    const kpId = pick; // capture so a newer click cannot mix with this request's evidence
    try {
      const p = await ctx.api.getMyProgress();
      let drill = '';
      if (kpId) {
        const cell = await ctx.api.getEvidence(ctx.user.studentId, kpId);
        const kp = p.modules.flatMap(m => m.kps).find(k => k.id === kpId);
        drill = `<div style="margin-top:16px"><h3>${esc(kp.id)} ${esc(kp.name)} → ${MASTERY_LABEL[cell.status]}</h3>${evidenceTable(cell, p.policy)}</div>`;
      }
      if (!current()) return;
      const s = p.row.summary;
      el.querySelector('#kpis').innerHTML = `<div class="kpi"><b>${s.mastered}%</b>mastered</div><div class="kpi"><b>${s.partial}%</b>partly mastered</div><div class="kpi"><b>${s.notUnderstood}%</b>not understood yet</div>`;
      heat.innerHTML = proposedPolicy() + heatmap(p.modules, [{ ...p.row, label: 'Me' }], kpId ? { studentId: ctx.user.studentId, kpId } : null) + drill;
      bindHeatmap(heat, (_, k) => { pick = k; load(); });
      el.querySelector('#tests').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Test</th><th>Latest</th><th>Attempts</th></tr></thead><tbody>
        ${p.tests.map(t => { const c = p.stats.tests[t.id]; return `<tr><td>${esc(t.name)}</td>${c
          ? `<td class="band-${c.band}">${c.score}/${c.total} (${c.pct}%)</td><td>${c.attempts}</td>` : '<td class="muted">Not sat</td><td>-</td>'}</tr>`; }).join('')}
        </tbody></table></div>`;
    } catch (e) { if (current()) heat.innerHTML = errorBanner(e); }
  }
  load();
  ctx.subscribe(load);
}

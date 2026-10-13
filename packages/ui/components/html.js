export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const initials = name => name.replace(/^(Ms|Mr|Mrs|Dr)\.?\s+/i, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

export const icon = (name, label) => `<i class="ti ti-${name}"${label ? ` aria-label="${esc(label)}"` : ' aria-hidden="true"'}></i>`;

export const chip = (text, tone = '') => `<span class="chip${tone ? ' chip-' + tone : ''}">${esc(text)}</span>`;

export const banner = (html, tone = 'info') => `<div class="banner banner-${tone}">${html}</div>`;

export const errorBanner = e => banner(`<strong>${esc(e.code || 'Error')}:</strong> ${esc(e.message || e)}`, 'bad');

export const proposedPolicy = () => banner('<strong>Proposed rules</strong> - demo values, require centre sign-off.', 'warn');

export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// One gate per load function: each call starts a request and returns isCurrent(), which is true only
// while this is the newest request and the page has not been left. Stops older responses painting over newer ones.
export function requestGate(signal) {
  let n = 0;
  return () => { const my = ++n; return () => my === n && !signal.aborted; };
}

export const fmtDate = iso => new Date(iso.length > 10 ? iso : iso + 'T00:00:00')
  .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

export const fmtDateTime = iso => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const daysBetween = (fromIso, toIso) => Math.round((new Date(toIso + 'T00:00:00') - new Date(fromIso + 'T00:00:00')) / 86400000);

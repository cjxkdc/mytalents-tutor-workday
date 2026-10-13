// Shared chrome primitives. Each app decides its own nav items and identity picker.
import { esc, initials } from './components/html.js';
import { backendHealth } from '../contract/backend.js';

export function mountChrome(root, { brandHref, brandMark, brandName, brandSub, nav, identity, demoNote, onReset }) {
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="${brandHref}"><span class="brand-mark" aria-hidden="true">${esc(brandMark)}</span>
        <span class="brand-name">${esc(brandName)}<small>${esc(brandSub)}</small></span></a>
      <nav class="topnav" aria-label="Main"></nav>
      <div class="who">
        <label class="sr-only" for="who-select">Signed in as (demo)</label>
        <select id="who-select">${identity.options.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select>
        <span class="avatar" aria-hidden="true"></span>
      </div>
    </header>
    <div class="demo-strip">${esc(demoNote)} <button type="button" id="reset-demo">Reset demo data</button>
      <span class="backend-status" id="backend-status" role="status">Backend: checking…</span></div>
    <div class="band"></div>`;

  const navEl = root.querySelector('.topnav');
  const select = root.querySelector('#who-select');
  const avatar = root.querySelector('.avatar');

  function setIdentity(id) {
    select.value = id;
    const o = identity.options.find(x => x.id === id);
    avatar.textContent = initials(o?.label || '?');
  }
  select.addEventListener('change', () => { setIdentity(select.value); identity.onChange(select.value); });
  root.querySelector('#reset-demo').addEventListener('click', onReset);

  // Backend reachability (M0). Pages keep using the demo API until they are switched to the backend.
  const statusEl = root.querySelector('#backend-status');
  async function checkBackend() {
    const h = await backendHealth();
    statusEl.className = `backend-status ${h.ok ? 'up' : 'down'}`;
    statusEl.textContent = h.ok ? `Backend: connected (${h.repository || 'unknown'} storage)` : 'Backend: not running - pages use demo data';
    statusEl.title = h.url;
  }
  checkBackend();
  addEventListener('focus', checkBackend);

  return {
    setIdentity,
    setNav(items, activeId) {
      navEl.innerHTML = items.map(i => `<a href="#/${i.id}" class="${i.id === activeId ? 'active' : ''}"${i.id === activeId ? ' aria-current="page"' : ''}>${esc(i.label)}</a>`).join('');
    },
  };
}

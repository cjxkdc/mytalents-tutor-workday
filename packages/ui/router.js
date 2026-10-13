// Hash router with a page lifecycle (see packages/contract/CONTRACT.md "Page modules").
// On every navigation or identity change: abort the old page's signal, drop its data subscriptions,
// run its cleanup, then mount the new page. A page that finishes loading after it was left
// must check ctx.signal.aborted and do nothing.

export function createRouter({ mount, routes, defaultRoute, getContext, onRoute }) {
  let current = null;

  const parse = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const navigate = path => { location.hash = '#/' + path.replace(/^\/+/, ''); };

  function teardown() {
    if (!current) return;
    current.controller.abort();
    current.unsubs.forEach(u => u());
    try { current.cleanup?.(); } catch (e) { console.error(e); }
    current = null;
  }

  async function show() {
    teardown();
    const [id, ...params] = parse();
    const route = routes.find(r => r.id === id) || routes.find(r => r.id === defaultRoute);
    const base = getContext();
    onRoute?.(route, base.user);

    if (route.roles && !route.roles.includes(base.user.role)) {
      mount.innerHTML = `<div class="page-head"><h1>Not available</h1><p class="lede">This page is for ${route.roles.join(' / ')} only.</p></div>`;
      return;
    }

    const controller = new AbortController();
    const unsubs = [];
    const me = { controller, unsubs, cleanup: null };
    current = me;
    const ctx = {
      ...base,
      signal: controller.signal,
      navigate,
      // Data-change subscription that is removed automatically when the page is left.
      subscribe(fn) { const u = base.api.subscribe(fn); unsubs.push(u); return u; },
    };

    mount.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const mod = await route.load();
      if (controller.signal.aborted) return;
      let out = mod.render(mount, params, ctx);
      if (out && typeof out.then === 'function') out = await out;
      if (typeof out === 'function') {
        if (controller.signal.aborted) out(); else me.cleanup = out;
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error(e);
      mount.innerHTML = `<div class="banner banner-bad">This page failed to load: ${String(e.message || e).replace(/</g, '&lt;')}</div>`;
    }
    mount.focus({ preventScroll: true });
  }

  addEventListener('hashchange', show);
  return { show, navigate, refresh: show };
}

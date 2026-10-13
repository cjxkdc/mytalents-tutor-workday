// Where the portals find the backend API. Pages still use the demo API (ctx.api); this only checks /health
// so the top strip can say whether the backend is reachable. Override once with ?backend=http://host:port
// (remembered in this browser); ?backend=default forgets it.
const KEY = 'backend.url';
const DEFAULT_URL = 'http://127.0.0.1:3100';

export function backendUrl() {
  const fromQuery = new URLSearchParams(location.search).get('backend');
  try {
    if (fromQuery === 'default') localStorage.removeItem(KEY);
    else if (fromQuery) localStorage.setItem(KEY, fromQuery);
    return (fromQuery && fromQuery !== 'default' ? fromQuery : localStorage.getItem(KEY)) || DEFAULT_URL;
  } catch {
    return fromQuery && fromQuery !== 'default' ? fromQuery : DEFAULT_URL;
  }
}

/** { ok: true, url, repository } when /health answers within the timeout, otherwise { ok: false, url }. */
export async function backendHealth(timeoutMs = 1500) {
  const url = backendUrl();
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!res.ok) return { ok: false, url };
    const body = await res.json();
    return { ok: body?.status === 'ok', url, repository: body?.repository || null };
  } catch {
    return { ok: false, url };
  }
}

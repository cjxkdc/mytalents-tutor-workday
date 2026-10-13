// One command for local development (M0): the portals on http://localhost:8765 and the backend API on :3100.
//   pnpm dev:all            (or: node scripts/dev-all.mjs)
// The portals need nothing installed. The backend needs `pnpm install` once; without it only the portals start.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const WEB_PORT = Number(process.env.WEB_PORT || 8765);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
// Never serve secrets, local data or dependencies, even on localhost.
const hidden = rel => rel.split(sep).some(part => part.startsWith('.') || part === 'node_modules') || rel.startsWith(join('data', 'private'));

const web = createServer((req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  const file = normalize(join(root, path));
  const rel = file.slice(root.length);
  if (!file.startsWith(root) || hidden(rel)) { res.writeHead(404).end('Not found'); return; }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) { res.writeHead(301, { Location: path + '/' }).end(); return; }
    return send(join(file, 'index.html'), res);
  }
  send(file, res);
});
function send(file, res) {
  if (!existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}
web.on('error', e => { console.error(`[web] ${e.message}`); process.exit(1); });
web.listen(WEB_PORT, '127.0.0.1', () => {
  console.log(`[web] portals on http://localhost:${WEB_PORT}  (staff: /apps/staff/, student: /apps/student/)`);
});

let api = null;
if (existsSync(join(root, 'node_modules', 'tsx'))) {
  // Same command as `pnpm dev`.
  api = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', '--watch', 'backend/src/server.ts'], { cwd: root, stdio: 'inherit' });
  api.on('exit', code => console.log(`[api] backend stopped (exit ${code}). The portals keep running.`));
} else {
  console.log('[api] backend not started: run `pnpm install` first (needs Node 24+ and pnpm). The portals still work in demo mode.');
}

const stop = () => { api?.kill(); web.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

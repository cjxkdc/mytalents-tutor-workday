// Front-end checks without dependencies (plain Node 24): every portal/shared JS file must parse as an ES module,
// then the pure-function tests in packages/contract/test run. Used by `pnpm check:web` and CI.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skip = new Set(['node_modules', 'src', 'test']); // packages/contract/src is the backend's TypeScript contract

function jsFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return skip.has(name) ? [] : jsFiles(p);
    return name.endsWith('.js') ? [p] : [];
  });
}

const files = ['apps', 'packages'].flatMap(d => jsFiles(join(root, d)));
const bad = files.filter(f => {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) process.stderr.write(`${relative(root, f)}\n${r.stderr}\n`);
  return r.status !== 0;
});
console.log(`syntax: ${files.length - bad.length}/${files.length} files OK`);
if (bad.length) process.exit(1);

const tests = spawnSync(process.execPath, ['--test', 'packages/contract/test/*.test.js'], { cwd: root, stdio: 'inherit' });
process.exit(tests.status ?? 1);

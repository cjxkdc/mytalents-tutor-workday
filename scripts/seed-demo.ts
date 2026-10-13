import { readFile } from 'node:fs/promises';
const port = process.env.PORT ?? '3100';
const response = await fetch(`http://127.0.0.1:${port}/api/v1/imports`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-User': 'demo-manager' },
  body: await readFile(new URL('../examples/import.synthetic.json', import.meta.url), 'utf8'),
});
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;

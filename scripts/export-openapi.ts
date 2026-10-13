import { mkdir, writeFile } from 'node:fs/promises';
import { openApi } from '../backend/src/http/openapi.js';
await mkdir('docs', { recursive: true });
await writeFile('docs/openapi.json', JSON.stringify(openApi(), null, 2) + '\n');
console.log('Updated docs/openapi.json');

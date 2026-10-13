import { mkdir, writeFile } from 'node:fs/promises';
import { openApi } from '../backend/src/http/openapi.js';
await mkdir('packages/contract', { recursive: true });
await writeFile('packages/contract/openapi.json', JSON.stringify(openApi(), null, 2) + '\n');
console.log('Updated packages/contract/openapi.json');

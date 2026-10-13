import { resolve } from 'node:path';
import { readConfig } from './config.js';
import { DemoAuthenticator, TokenAuthenticator } from './auth/authenticator.js';
import { FileRepository, MemoryRepository } from './repositories/repository.js';
import { SheetsRepository } from './repositories/sheets.js';
import { HttpAiProvider, UnconfiguredAi } from './integrations/ai.js';
import { createApp } from './http/app.js';

const config = readConfig();
const auth = config.AUTH_MODE === 'token' ? new TokenAuthenticator(config.API_KEYS_JSON!) : new DemoAuthenticator();
const ai = config.AI_GATEWAY_URL ? new HttpAiProvider(config.AI_GATEWAY_URL, config.AI_GATEWAY_TOKEN ?? '') : new UnconfiguredAi();
const repository = config.REPOSITORY === 'sheets' ? new SheetsRepository(config.GOOGLE_SPREADSHEET_ID!) :
  config.REPOSITORY === 'memory' ? new MemoryRepository() : await FileRepository.create(resolve(config.DATA_FILE));
const { app, scans } = createApp({ repository, auth, ai, corsOrigins: config.corsOrigins });
try {
  await scans.recoverInterrupted();
  await app.listen({ host: config.HOST, port: config.PORT });
  console.info(`MyTalents backend listening at http://${config.HOST}:${config.PORT} (${repository.kind}, ${config.AUTH_MODE})`);
} catch (error) {
  await app.close();
  throw error;
}
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  if (closing) return;
  closing = true;
  await app.close();
});

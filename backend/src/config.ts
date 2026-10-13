import { z } from 'zod';
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = z.object({
    HOST: z.string().default('127.0.0.1'), PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    AUTH_MODE: z.enum(['demo', 'token']).default('demo'),
    REPOSITORY: z.enum(['local', 'memory', 'sheets']).default('local'),
    DATA_FILE: z.string().default('data/private/workday.json'),
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
    API_KEYS_JSON: z.string().optional(), GOOGLE_SPREADSHEET_ID: z.string().optional(),
    AI_GATEWAY_URL: z.string().optional(), AI_GATEWAY_TOKEN: z.string().optional(),
    NODE_ENV: z.string().optional(),
  }).parse(env);
  if (config.AUTH_MODE === 'demo' && (!['127.0.0.1', '::1'].includes(config.HOST) || config.NODE_ENV === 'production' || config.REPOSITORY === 'sheets')) {
    throw new Error('Demo authentication is allowed only for loopback synthetic data, never production or Sheets');
  }
  if (config.AUTH_MODE === 'token' && !config.API_KEYS_JSON) throw new Error('API_KEYS_JSON is required');
  if (config.REPOSITORY === 'sheets' && !config.GOOGLE_SPREADSHEET_ID) throw new Error('GOOGLE_SPREADSHEET_ID is required');
  const corsOrigins = config.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('CORS_ORIGINS must contain exact origins');
  }
  return { ...config, corsOrigins };
}

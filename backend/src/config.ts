import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 모노레포 루트의 .env 로드 (backend/src/config.ts → ../../ = 루트)
try {
  const envPath = resolve(__dirname, '../../.env');
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
} catch { /* .env 없으면 무시 (CI/배포 환경은 OS 환경변수 사용) */ }

export const config = {
  port:    Number(process.env['PORT'] ?? 3001),
  dbUrl:   process.env['DATABASE_URL'] ?? '',
  jwtSecret: process.env['JWT_SECRET'] ?? '',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
};

export function validateRuntimeConfig(candidate = config, runtimeEnv: NodeJS.ProcessEnv = process.env): string[] {
  if (candidate.nodeEnv !== 'production') return [];
  const errors: string[] = [];
  if (!candidate.dbUrl.startsWith('postgresql://') && !candidate.dbUrl.startsWith('postgres://')) {
    errors.push('DATABASE_URL must use PostgreSQL');
  }
  if (candidate.jwtSecret.length < 32) errors.push('JWT_SECRET must contain at least 32 characters');
  if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535');
  }
  for (const key of ['BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PW', 'CORS_ORIGIN']) {
    if (key in runtimeEnv) errors.push(`${key} must not be present in production runtime ENV`);
  }
  return errors;
}

export function assertRuntimeConfig(): void {
  const errors = validateRuntimeConfig();
  if (errors.length) throw new Error(`Invalid production configuration: ${errors.join('; ')}`);
}

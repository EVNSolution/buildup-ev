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

import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@buildup-ev/shared/load-calc': path.resolve(__dirname, '../shared/load-calc/core.ts'),
      '@buildup-ev/shared/pricing': path.resolve(__dirname, '../shared/pricing/core.ts'),
      '@buildup-ev/shared/types': path.resolve(__dirname, '../shared/types/index.ts'),
    },
  },
  test: {
    environment: 'node',
    env: { JWT_SECRET: 'test-secret-vitest-do-not-use-in-prod' },
  },
});

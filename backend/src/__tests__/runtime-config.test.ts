import { describe, expect, it } from 'vitest';
import { config, validateRuntimeConfig } from '../config.js';

describe('production runtime configuration', () => {
  const valid = {
    ...config,
    nodeEnv: 'production',
    dbUrl: 'postgresql://buildup:secret@localhost:5432/buildup_ev',
    jwtSecret: 'a'.repeat(32),
    port: 3101,
  };

  it('accepts the minimum production contract', () => {
    expect(validateRuntimeConfig(valid, {})).toEqual([]);
  });

  it('rejects a weak secret, non-PostgreSQL database and invalid port', () => {
    const errors = validateRuntimeConfig({
      ...valid,
      dbUrl: 'sqlite:dev.db',
      jwtSecret: 'short',
      port: 70000,
    }, {});
    expect(errors).toEqual([
      'DATABASE_URL must use PostgreSQL',
      'JWT_SECRET must contain at least 32 characters',
      'PORT must be an integer between 1 and 65535',
    ]);
  });

  it('does not impose production-only checks on local development', () => {
    expect(validateRuntimeConfig({ ...valid, nodeEnv: 'development', dbUrl: '', jwtSecret: '' })).toEqual([]);
  });

  it('rejects one-time bootstrap values in the production process', () => {
    expect(validateRuntimeConfig(valid, { BOOTSTRAP_ADMIN_PW: 'do-not-keep' })).toEqual([
      'BOOTSTRAP_ADMIN_PW must not be present in production runtime ENV',
    ]);
  });
});

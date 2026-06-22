import jwt from 'jsonwebtoken';

const TEST_SECRET = process.env['JWT_SECRET'] ?? 'test-secret-vitest-do-not-use-in-prod';

/** Returns a Cookie header string containing a signed JWT for test requests. */
export function authCookie(email: string, role: string, org_code: string): string {
  const token = jwt.sign({ email, role, org_code }, TEST_SECRET, { expiresIn: '1h' });
  return `access_token=${token}`;
}

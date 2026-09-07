import jwt from 'jsonwebtoken';

const TEST_SECRET = process.env['JWT_SECRET'] ?? 'test-secret-vitest-do-not-use-in-prod';

/** Returns a Cookie header string containing a signed JWT for test requests. */
export function authCookie(email: string, role: string, org_code: string): string {
  const token = jwt.sign({ email, role, org_code }, TEST_SECRET, { expiresIn: '1h' });
  return `access_token=${token}`;
}

/**
 * **인증이 가능한 환경인가** — 아니면 그 시험은 건너뛴다.
 *
 * 통합 시험 몇 개는 seed 계정(`sales1@evnsolution.com` 등)으로 로그인한다. 그 계정이 없는
 * DB 에서는 인증 자체가 막혀 **전부 403** 이 되는데, 그건 제품이 잘못된 것이 아니라
 * **DB 가 준비되지 않은 것**이다.
 *
 * ⚠️ 예전에는 그냥 실패했다. 그래서 로컬 스위트가 늘 열몇 개 빨간 채였고,
 *    **빨간불이 아무 뜻도 없게 됐다** — 진짜 회귀가 그 사이에 섞여도 아무도 몰랐다.
 *
 * ⚠️ **돌 수 있으면 무조건 돌린다.** 「건너뜀」은 인증이 확실히 불가능할 때만이다.
 *    아래 두 경우는 각 시험이 스스로 다루므로 그대로 돌린다 —
 *      · 시험용 인증 우회가 켜져 있다(계정이 없어도 통과한다)
 *      · DB 가 아예 없다(시험이 503 을 정상으로 받아들인다)
 *    그래서 이 함수가 false 를 주는 상황은 **어차피 실패했을 환경**뿐이고,
 *    CI 에서 돌던 검사를 조용히 없앨 수 없다.
 */
export async function authFixtureReady(...emails: string[]): Promise<boolean> {
  if (process.env['ALLOW_TEST_AUTH_BYPASS'] === 'true') return true;
  const { prisma } = await import('../lib/prisma.js');
  if (!prisma) return true;
  return (await prisma.user.count({ where: { email: { in: emails } } })) === emails.length;
}

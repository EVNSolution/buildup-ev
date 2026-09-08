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

/**
 * **시험이 쓰는 계정을 스스로 마련한다.**
 *
 * ⚠️ `db/seed/user.csv` 는 머리글만 있는 빈 파일이다 — 실계정은 커밋하지 않는다(그게 맞다).
 *    그래서 시드를 아무리 돌려도 `sales1@evnsolution.com` 같은 계정은 로컬에 생기지 않고,
 *    통합시험은 **남의 DB 에만 있는 계정**에 기대고 있었다.
 *
 *    인증은 시험용 우회로 통과하지만 **소유권 검사는 행이 없으면 막힌다**(영업은 자기 견적만).
 *    그래서 새로 받은 사람의 로컬에서는 늘 몇 개가 빨갛고, 빨간불이 일상이 되면
 *    **진짜 회귀가 그 사이에 섞여도 아무도 모른다.**
 *
 * ⚠️ **있는 계정은 건드리지 않는다.** 같은 주소가 실제로 쓰이고 있을 수 있으므로
 *    없을 때만 만든다 — 이름·역할·소속을 덮어써서 남의 계정을 바꾸지 않는다.
 */
export async function ensureFixtureUsers(
  ...users: { email: string; role: 'SALES' | 'ADMIN' | 'MAKER'; org_code: string }[]
): Promise<boolean> {
  const { prisma } = await import('../lib/prisma.js');
  if (!prisma) return false;
  for (const u of users) {
    const found = await prisma.user.findUnique({ where: { email: u.email }, select: { email: true } });
    if (found) continue;
    await prisma.user.create({
      data: {
        email: u.email, role: u.role, org_code: u.org_code,
        name: '시험용', extra_roles: [], active: true, status: 'active',
        // 로그인은 하지 않는다 — 시험은 쿠키를 직접 만들어 쓴다
        password_hash: 'x',
      },
    });
  }
  return true;
}

/**
 * 마스터 관리자 계정 부트스트랩.
 * 사용: npm run --workspace=backend bootstrap
 * - BOOTSTRAP_ADMIN_EMAIL / ADMIN / ORG_HQ 생성
 * - BOOTSTRAP_ADMIN_PW 환경변수가 있으면 그 값을 초기 비밀번호로 사용, 없으면 무작위 생성
 * - 이미 password_hash가 있으면 건너뜀
 * - 평문 비밀번호는 콘솔에 1회만 출력 후 저장하지 않음
 */
import '../src/config.js';
import { PrismaClient } from '@prisma/client';
import { hashPassword, generateTempPassword } from '../src/lib/password.js';

const ADMIN_ORG   = 'ORG_HQ';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env['BOOTSTRAP_ADMIN_EMAIL']?.trim();
  if (!adminEmail) throw new Error('BOOTSTRAP_ADMIN_EMAIL env not set');

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (existing?.password_hash) {
    console.log('[bootstrap] Admin already has a password — skipping.');
    console.log('[bootstrap] To reset: clear password_hash for BOOTSTRAP_ADMIN_EMAIL, then re-run.');
    return;
  }

  const plainPw = process.env['BOOTSTRAP_ADMIN_PW'] || generateTempPassword();
  const hash    = await hashPassword(plainPw);

  await prisma.user.upsert({
    where:  { email: adminEmail },
    update: { password_hash: hash, must_change_pw: true, status: 'active', active: true, is_master: true },
    create: {
      email:          adminEmail,
      org_code:       ADMIN_ORG,
      role:           'ADMIN',
      name:           '마스터관리자',
      status:         'active',
      must_change_pw: true,
      active:         true,
      is_master:      true, // DEV: master surface switcher
      password_hash:  hash,
    },
  });

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║              관리자 계정 부트스트랩 완료              ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  이메일:     ${adminEmail.padEnd(38)}║`);
  console.log(`║  임시비번:   ${plainPw.padEnd(38)}║`);
  console.log('║  첫 로그인 후 반드시 비밀번호를 변경하세요.           ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

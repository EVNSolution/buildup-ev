import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * **실제로 나가는지** 본다 — 소스를 읽어 맞다고 믿는 대신 경로를 끝까지 태운다.
 *
 * 이 건이 조용히 새는 방식이 딱 그랬다. 배선은 「그럴듯해 보였고」, 함수는 존재했고,
 * 테스트도 초록이었다. 정작 스캔본으로 계약완료가 된 건은 알림이 나가지 않았다.
 *
 * ⚠️ **메일은 진짜로 보내지 않는다.** `nodemailer` 를 갈아 끼워 호출만 받아 낸다 —
 *    로컬 `.env` 에 실제 SMTP 계정이 들어 있어서, 안 막으면 사람에게 메일이 간다.
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));

process.env['MAIL_SMTP_USER'] ||= 'test@example.com';
process.env['MAIL_SMTP_PASS'] ||= 'test-pass';
// 수신자 계산까지 실제로 돌려야 하므로 우회 env 는 반드시 비운다
delete process.env['NOTIFY_ADMIN_TO'];

const { prisma } = await import('../lib/prisma.js');
const { setQuoteStatus } = await import('../services/quote-status.js');

const MASTER = 'vitest-master@example.invalid';
let quoteId = 0;
let customerId = 0;
const live = !!prisma;

beforeAll(async () => {
  if (!prisma) return;
  // 알림 토글을 아무도 켜 두지 않은 상태 — 실제 사고 당시와 같은 조건
  await prisma.user.upsert({
    where: { email: MASTER },
    update: { is_master: true, active: true, status: 'active' },
    create: {
      email: MASTER, name: '테스트마스터', role: 'ADMIN', extra_roles: [],
      is_master: true, active: true, status: 'active', org_code: 'ORG_HQ', password_hash: 'x',
    },
  });
  const c = await prisma.customer.create({ data: { name: '테스트고객_알림검증' } });
  customerId = c.id;
  const q = await prisma.quote.create({
    data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'confirmed',
            customer_id: c.id, final_price: 50_000_000 },
    select: { id: true },
  });
  quoteId = q.id;
});

afterAll(async () => {
  if (!prisma) return;
  // 시험용으로 만든 것만 지운다 — 남의 데이터는 건드리지 않는다
  await prisma.quoteChangeLog.deleteMany({ where: { quote_id: quoteId } });
  await prisma.quote.deleteMany({ where: { id: quoteId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { email: MASTER } });
});

describe.runIf(live)('계약완료가 되면 실제로 배정 알림이 나간다', () => {
  it('🔴 아무도 토글을 켜 두지 않아도 마스터에게 나간다', async () => {
    sendMail.mockClear();
    const changed = await setQuoteStatus(quoteId, 'contracted', 'vitest');
    expect(changed).toBe(true);

    // 알림은 기다리지 않는다(fire-and-forget) — 붙잡을 틈을 준다
    await vi.waitFor(() => expect(sendMail).toHaveBeenCalled(), { timeout: 5000 });

    const mail = sendMail.mock.calls[0]![0] as { to: string; subject: string; text: string };
    expect(mail.to.split(','), '마스터가 수신자에 없다').toContain(MASTER);
    expect(mail.subject).toContain('제작 배정 요청');
    expect(mail.text).toContain('제작 배정');
    // 눌러서 갈 곳이 견적 목록이어야 한다
    expect(mail.text).toContain('/admin');
  });

  it('같은 상태로 다시 바꾸면 또 보내지 않는다', async () => {
    sendMail.mockClear();
    const changed = await setQuoteStatus(quoteId, 'contracted', 'vitest');
    expect(changed).toBe(false);
    await new Promise(r => setTimeout(r, 300));
    expect(sendMail).not.toHaveBeenCalled();
  });
});

/**
 * **로컬 확인용 더미** — 「입력 필요」에 설 건(계약 체결 완료)을 만든다.
 *
 * ⚠️ 로컬에서 손으로만 돌린다(배포·시드에 들어가지 않는다). 운영 DB 에는 절대 돌리지 말 것.
 *    `npx tsx src/scripts/pnl-dummy.ts [개수]`
 */
// ⚠️ config 를 가장 먼저 — prisma 가 빈 환경으로 먼저 만들어지면 「DB 연결 없음」으로 죽는다
import '../config.js';
import { prisma } from '../lib/prisma.js';

const NAMES = ['더미물류', '더미상사', '주식회사 더미로지스', '더미냉동', '더미유통'];

async function main() {
  if (!prisma) throw new Error('DB 연결 필요');
  if ((process.env['NODE_ENV'] ?? 'development') === 'production') throw new Error('운영에서는 돌리지 않는다');
  const n = Math.min(Math.max(Number(process.argv[2] ?? 1), 1), 10);

  // 값이 제대로 잡히게 **실제 견적 하나를 본떠** 만든다(옵션 선택이 있어야 특장가격이 나온다)
  const seed = await prisma.quote.findFirst({
    where: { status: { in: ['ordered', 'completed', 'assigned'] }, selections: { not: {} } },
    orderBy: { id: 'desc' },
    select: { model_code: true, selections: true, inputs: true, final_price: true, sales_user_id: true, org_id: true },
  });
  if (!seed) throw new Error('본뜰 견적을 못 찾았다 — 옵션이 있는 견적이 하나는 있어야 한다');

  for (let i = 0; i < n; i++) {
    const name = `${NAMES[i % NAMES.length]}_더미${Date.now() % 10000}`;
    const customer = await prisma.customer.create({ data: { name, phone: `010-0000-${String(1000 + i)}` } });
    const quote = await prisma.quote.create({
      data: {
        model_code: seed.model_code, selections: seed.selections as object, inputs: seed.inputs as object,
        status: 'ordered', customer_id: customer.id, final_price: seed.final_price,
        sales_user_id: seed.sales_user_id, org_id: seed.org_id,
        assign_requested_at: new Date(),
      },
      select: { id: true },
    });
    // 체결일을 하루씩 벌려 둔다 — 「오래된 것이 맨 위」를 눈으로 확인할 수 있게
    const signedAt = new Date(Date.now() - (i + 1) * 86_400_000);
    // 「입력 필요」는 **체결된 계약 줄**을 본다 — 짝수는 전자서명, 홀수는 서면계약으로 섞는다
    await prisma.purchaseContract.create({
      data: {
        quote_id: quote.id, signing_method: i % 2 === 0 ? 'EMAIL' : 'PAPER',
        status: 'COMPLETED', completed_at: signedAt, customer_snapshot: { name },
      },
    });
    const acceptedAt = signedAt;
    await prisma.order.create({
      data: {
        quote_id: quote.id, maker_org_id: 'ORG_BRAIN',
        assigned_at: acceptedAt, accepted_at: acceptedAt,
        delivery_due: new Date(Date.now() + 20 * 86_400_000),
      },
    });
    console.log(`  · 견적 #${quote.id} · ${name} · 체결 ${signedAt.toISOString().slice(0, 10)}`);
  }
  console.log(`더미 ${n}건을 「입력 필요」에 세웠다.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

/**
 * 기존 주문에 새 단계 행을 만든다 — 17단계 4갈래(`order_step`).
 *
 * ⚠️ **`order.status`(옛 6단계)를 읽지 않는다.**
 *    그 값은 확정된 적이 없다("지금 시스템 파이프라인은 확실한 게 아님" — 2026-08-14 회의).
 *    확정되지 않은 값에서 「여기까지 왔다」를 유추하면, 실제로는 안 한 일이 완료로 찍히고
 *    그 뒤로는 아무도 그게 거짓인지 알 수 없게 된다. 단계 기록은 증빙과 짝을 이루는
 *    사실 기록이라 추측을 섞으면 안 된다.
 *
 * 그래서 **다른 곳에서 확실히 확인되는 것만** 완료로 표시한다:
 *
 *   po_issued    ← 주문 행이 있고 특장사가 배정돼 있다 = 발주가 나갔다
 *                  (완료 시각 = assigned_at)
 *   po_accepted  ← 견적이 ordered 이거나 수락 기록(accepted_at)이 있다 = 특장사가 받았다
 *                  (납기 = delivery_due, 있으면)
 *
 * 나머지 15단계는 **전부 pending** 이다. 진행 중인 주문이라도 시스템이 그 사실을 갖고
 * 있지 않으므로, 담당자가 화면에서 실제 상태를 채운다. 덜 채워진 것은 눈에 보이지만
 * 잘못 채워진 것은 안 보인다.
 *
 * 사용: npm run migrate:steps           (미리보기)
 *      npm run migrate:steps -- --write (반영)
 *      npm run migrate:steps -- --reset (로컬 전용: 단계 행을 지우고 다시 만든다)
 */
import { PrismaClient } from '@prisma/client';
import { STEPS } from '@buildup-ev/shared/process';

const prisma = new PrismaClient();
const write = process.argv.includes('--write');
const reset = process.argv.includes('--reset');

if (reset && !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env['DATABASE_URL'] ?? '')) {
  console.error('✋ --reset 은 로컬에서만 씁니다. 운영에서 단계 기록을 지우면 되돌릴 수 없습니다.');
  process.exit(1);
}

async function main() {
  const orders = await prisma.order.findMany({
    select: {
      id: true, maker_org_id: true, assigned_at: true, created_at: true,
      accepted_at: true, delivery_due: true,
      quote: { select: { status: true } },
    },
    orderBy: { id: 'asc' },
  });

  if (reset && write) {
    const n = await prisma.orderStep.deleteMany({});
    console.log(`\n↩︎  단계 행 ${n.count}개 삭제(로컬)\n`);
  }

  console.log(`주문 ${orders.length}건${write ? ' — 반영합니다' : ' — 미리보기(반영하지 않음)'}`);
  console.log(`⚠️  order.status(옛 6단계)는 확정된 값이 아니라 읽지 않습니다.\n`);

  let rowsTotal = 0;
  let doneTotal = 0;

  for (const o of orders) {
    // 확인되는 사실만 — 추측하지 않는다
    const issued = !!o.maker_org_id;
    const accepted = o.quote?.status === 'ordered' || o.quote?.status === 'completed' || !!o.accepted_at;
    const issuedAt = o.assigned_at ?? o.created_at;

    const done = new Set<string>();
    if (issued) done.add('po_issued');
    if (issued && accepted) done.add('po_accepted');

    const rows = STEPS.map(s => ({
      order_id: o.id,
      code: s.code,
      track: s.track,
      status: done.has(s.code) ? 'done' : 'pending',
      planned_at: s.code === 'po_accepted' && done.has('po_accepted') ? o.delivery_due : null,
      entered_at: issuedAt,
      done_at: done.has(s.code) ? (s.code === 'po_accepted' ? (o.accepted_at ?? issuedAt) : issuedAt) : null,
      done_by: done.has(s.code) ? 'system(이관)' : null,
      note: done.has(s.code) ? '이관 — 주문 기록에서 확인된 사실(증빙 파일 없음)' : null,
    }));

    rowsTotal += rows.length;
    doneTotal += done.size;

    const why = [
      issued ? '배정됨' : null,
      accepted ? `수락됨(${o.quote?.status})` : null,
    ].filter(Boolean).join(' · ') || '확인된 사실 없음';
    console.log(`  주문 #${String(o.id).padEnd(3)} 완료 ${done.size}/${STEPS.length}  · ${why}`);

    if (write) {
      // 이미 있는 행은 건드리지 않는다 — 사람이 그 뒤에 채운 값을 덮으면 안 된다
      await prisma.orderStep.createMany({ data: rows, skipDuplicates: true });
    }
  }

  console.log(`\n  단계 행 ${rowsTotal}개 (확인된 완료 ${doneTotal} / 담당자가 채울 것 ${rowsTotal - doneTotal})`);
  if (!write) console.log(`\n  반영하려면:  npm run migrate:steps -- --write\n`);
  else console.log(`\n  반영했습니다. 나머지 단계는 담당자가 화면에서 실제 상태를 채웁니다.\n`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

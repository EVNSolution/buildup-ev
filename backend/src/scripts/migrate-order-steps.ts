/**
 * 기존 주문을 새 단계 체계로 옮긴다 — `order.status`(옛 6단계 직선) → `order_step`(17단계 4갈래).
 *
 * ⚠️ **옛 단계와 새 단계는 1:1이 아니다.**
 *    옛 흐름은 「제작착수→구조변경→튜닝신청→안전검사→튜닝승인→인도완료」 한 줄이었고,
 *    새 구조는 차량·특장·튜닝이 따로 돌다 합류한다. 게다가 튜닝승인과 안전검사의 순서도
 *    회의에서 뒤집혔다. 그래서 **기계적으로 욱여넣지 않고**, 옛 단계까지 왔다면 지나왔을
 *    새 단계들만 완료로 표시한다.
 *
 * ⚠️ **증빙 없이 완료로 찍는다.** 옛 주문들은 시스템이 사진·서류를 요구하기 전에 진행됐다.
 *    「했지만 서류가 시스템에 없다」가 사실이므로 done 으로 두고, note 에 그렇게 적는다.
 *    skipped(해당 없음)로 두면 하지 않은 일처럼 읽혀 더 틀리다.
 *
 * ⚠️ `order.status` 는 지우지 않는다. 기존 칸반·통계가 아직 읽는다.
 *
 * 사용: npm run migrate:steps           (미리보기 — 무엇을 바꿀지만 출력)
 *      npm run migrate:steps -- --write (실제 반영)
 */
import { PrismaClient } from '@prisma/client';
import { STEPS, STEP_BY_CODE } from '@buildup-ev/shared/process';

const prisma = new PrismaClient();
const write = process.argv.includes('--write');

/**
 * 옛 단계까지 왔다면 지나왔을 새 단계 — **누적**이다(아래로 갈수록 위를 포함).
 * 옛 흐름에 없던 단계(임시번호판 반납·보험 확인 등)도 그 시점엔 어차피 지나간 일이라 포함한다.
 */
const PASSED_BY_OLD_STAGE: Record<string, string[]> = {
  제작착수: ['po_issued', 'po_accepted'],
  구조변경: ['car_arrived', 'build_done', 'mounted'],
  튜닝신청: ['temp_plate_returned', 'insurance_checked', 'plate_received', 'plate_mounted',
             'tuning_drafted', 'tuning_sign_sent'],
  안전검사: ['tuning_signed', 'tuning_approved', 'inspection_booked'],
  튜닝승인: ['inspection_done'],
  인도완료: ['docs_complete', 'delivered'],
};
const OLD_ORDER = ['제작착수', '구조변경', '튜닝신청', '안전검사', '튜닝승인', '인도완료'];

/** 옛 단계까지의 누적 — 그 단계와 그 앞 단계들이 함축하는 새 단계 전부. */
function passedSteps(oldStatus: string): string[] {
  const idx = OLD_ORDER.indexOf(oldStatus);
  if (idx < 0) return [];
  return OLD_ORDER.slice(0, idx + 1).flatMap(s => PASSED_BY_OLD_STAGE[s] ?? []);
}

async function main() {
  const orders = await prisma.order.findMany({
    select: { id: true, status: true, assigned_at: true, created_at: true, delivery_due: true },
    orderBy: { id: 'asc' },
  });

  console.log(`\n주문 ${orders.length}건${write ? ' — 반영합니다' : ' — 미리보기(반영하지 않음)'}\n`);

  let created = 0;
  let done = 0;
  for (const o of orders) {
    const passed = new Set(passedSteps(o.status));
    const base = o.assigned_at ?? o.created_at;

    const rows = STEPS.map(s => {
      const isDone = passed.has(s.code);
      return {
        order_id: o.id,
        code: s.code,
        track: s.track,
        status: isDone ? 'done' : 'pending',
        // 납기는 이미 받아 둔 것이 있으면 그대로 옮긴다
        planned_at: s.code === 'po_accepted' ? o.delivery_due : null,
        entered_at: base,
        done_at: isDone ? base : null,
        done_by: isDone ? 'system(이관)' : null,
        note: isDone ? `단계 체계 개편 전 진행 — 옛 단계 「${o.status}」, 증빙 없음` : null,
      };
    });

    created += rows.length;
    done += rows.filter(r => r.status === 'done').length;

    const unfinished = STEPS.filter(s => !passed.has(s.code)).map(s => STEP_BY_CODE[s.code]!.label);
    console.log(`  주문 #${o.id}  옛 「${o.status}」 → 완료 ${passed.size}/${STEPS.length}`
      + (unfinished.length ? `  · 남음: ${unfinished.slice(0, 4).join(', ')}${unfinished.length > 4 ? ` 외 ${unfinished.length - 4}` : ''}` : '  · 전부 완료'));

    if (write) {
      // 이미 옮긴 주문은 건드리지 않는다 — 사람이 그 뒤에 채운 값을 덮으면 안 된다
      await prisma.orderStep.createMany({ data: rows, skipDuplicates: true });
    }
  }

  console.log(`\n  단계 행 ${created}개 (완료 ${done} / 대기 ${created - done})`);
  if (!write) console.log(`\n  실제로 반영하려면:  npm run migrate:steps -- --write\n`);
  else console.log(`\n  반영했습니다. order.status 는 그대로 두었습니다(기존 칸반·통계가 읽습니다).\n`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
